"""TriageBatchEnv — the OpenReward Environment for triage-batch v2.

A waiting room of 5 patients (CSV rows). Agent classifies each into one of
the five KTAS levels via a level-specific assignment tool. Plus wait() for
deterioration alerts and write_note() for the chart.

API verified against openreward==0.1.106.
"""

from __future__ import annotations

import json
from typing import Any

from openreward.environments import (
    Environment,
    JSONObject,
    Server,
    Split,
    TextBlock,
    ToolOutput,
    tool,
)
from pydantic import BaseModel

from . import dataset, scoring
from .scoring import AssignmentResult, evaluation_summary
from .world_state import KTAS_NAMES, KtasLevel, Patient, WorldState

# Delimiter the harness scans for in submit-handoff text to lift structured
# meta out of the terminator. Below this line the text is JSON.
META_DELIMITER = "\n--META--\n"

# ---- Tool param schemas ---------------------------------------------------


class WaitParams(BaseModel):
    minutes: int


class WriteNoteParams(BaseModel):
    patient_id: str
    note: str


class AssignParams(BaseModel):
    patient_id: str


# ---- Helpers --------------------------------------------------------------


def _build_world(task_spec: dict[str, Any]) -> WorldState:
    """Build the world from the task spec.

    The spec can mix two patient sources:
      - row_indices: list of CSV row indices (scored against KTAS_expert)
      - manual_patients: list of user-entered payloads (scored against
        expected_ktas if provided, else unscored)

    If both are empty and `n` is non-zero, falls back to
    select_diverse_batch(seed, n).
    """
    row_indices: list[int] = list(task_spec.get("row_indices") or [])
    manual_payloads: list[dict] = list(task_spec.get("manual_patients") or [])

    # Auto-select dataset rows from seed+n when no explicit indices are
    # provided AND n > 0. This is independent of manual_patients — manual
    # entries are additive (Option C: test batch + extra patient).
    if not row_indices:
        seed = int(task_spec.get("seed", 0))
        n = int(task_spec.get("n", 0))
        if n > 0:
            row_indices = dataset.select_diverse_batch(seed=seed, n=n)

    patients: dict[str, Patient] = {}
    charts: dict[str, list[str]] = {}
    assigned: dict[str, KtasLevel | None] = {}

    # Insert dataset patients first, preserving the order from row_indices.
    for idx in row_indices:
        p = dataset.load_row(idx)
        patients[p.id] = p
        charts[p.id] = [
            f"Chief complaint: {p.chief_complaint}",
            f"History: {p.history}",
        ]
        assigned[p.id] = None

    # Then manual patients, with monotonic ids.
    for i, payload in enumerate(manual_payloads):
        if not isinstance(payload, dict):
            continue
        p = dataset.synthesize_manual_patient(payload, i)
        patients[p.id] = p
        charts[p.id] = [
            f"Chief complaint: {p.chief_complaint}",
            f"History: {p.history}",
            "(manual entry — no dataset trajectory)",
        ]
        assigned[p.id] = None

    return WorldState(
        sim_time_min=0,
        patients=patients,
        assigned=assigned,
        charts=charts,
        seed=int(task_spec.get("seed", 0)),
    )


def _vitals_block(p: Patient) -> str:
    v = p.vitals
    nrs = f"NRS pain {p.nrs_pain}/10" if p.nrs_pain is not None else "pain not reported"
    return (
        f"  age {p.age}, {p.sex}, mental: {p.mental_state}, {nrs}\n"
        f"  HR {v.hr}, BP {v.sbp}/{v.dbp}, RR {v.rr}, "
        f"SpO2 {v.spo2}%, Temp {v.temp_c:.1f}°C"
    )


# ---- The env --------------------------------------------------------------


class TriageBatchEnv(Environment):
    """Waiting-room triage classification env."""

    def __init__(
        self,
        task_spec: JSONObject = {},  # noqa: B006 — OpenReward signature
        secrets: dict[str, str] = {},  # noqa: B006 — OpenReward signature
    ) -> None:
        super().__init__(task_spec)
        spec = task_spec if isinstance(task_spec, dict) else {}
        self.task_spec_dict: dict[str, Any] = spec
        self.world = _build_world(spec)
        self.summary: list[str] = []
        # Per-assignment results captured in order so scoring can compute the
        # ordering bonus.
        self._assignments: list[AssignmentResult] = []
        # Note we ban re-assigning a patient, so this is also `len(assigned non-None)`.
        self._n_total: int = len(self.world.patients)
        self.shift_length_min: int = int(spec.get("shift_length_min", 60))

    # ---- ORS hooks ----

    @classmethod
    def list_tasks(cls, split: str) -> list[JSONObject]:
        return dataset.list_task_specs(split=split, n=5)

    @classmethod
    def list_splits(cls):
        return [Split(name="test", type="test"), Split(name="train", type="train")]

    def get_prompt(self) -> list[TextBlock]:
        lines: list[str] = []
        n_total = self._n_total
        lines.append(
            f"You are an ED triage nurse. {n_total} patient"
            + ("s" if n_total != 1 else "")
            + " "
            + ("are" if n_total != 1 else "is")
            + " waiting. Classify each into one of the five "
            "Manchester / KTAS triage levels by calling the matching tool with "
            "the patient_id. Triage the sickest first — ordering matters."
        )
        lines.append("")
        lines.append("Levels (each is its own tool):")
        lines.append("  - assign_immediate     KTAS 1, life-threatening, needs resuscitation now")
        lines.append("  - assign_very_urgent   KTAS 2, high risk of rapid deterioration")
        lines.append("  - assign_urgent        KTAS 3, significant pathology, stable")
        lines.append("  - assign_standard      KTAS 4, stable, non-emergent")
        lines.append("  - assign_not_urgent    KTAS 5, could be managed in primary care")
        lines.append("")
        lines.append("Other tools:")
        lines.append(
            "  - wait(minutes): let time pass; you'll see if any patient "
            "deteriorates while waiting."
        )
        lines.append(
            "  - write_note(patient_id, note): record an observation. Does not advance time."
        )
        lines.append("")
        lines.append(
            "Use patient_id verbatim from the list below. Each patient must be "
            f"assigned exactly one level. Episode ends when all {n_total} "
            "are done."
        )
        lines.append("")
        lines.append("Patients in the waiting room:")
        for pid, p in self.world.patients.items():
            lines.append("")
            lines.append(f'[patient_id="{pid}"] {p.chief_complaint}')
            lines.append(_vitals_block(p))
        lines.append("")
        lines.append(
            "Note: literature finds that human nurses on this same dataset "
            "mistriaged 14.7% of cases, and 70% of those errors were "
            "under-triage (assigning a lower-severity level than truth). "
            "Vitals over narrative when they conflict."
        )
        return [TextBlock(type="text", text="\n".join(lines))]

    async def teardown(self) -> None:
        return None

    # ---- helpers ----

    def _summary(self, line: str) -> None:
        self.summary.append(f"t+{self.world.sim_time_min:>3}m | {line}")

    def _all_assigned(self) -> bool:
        return all(v is not None for v in self.world.assigned.values())

    def _assign(self, patient_id: str, level: KtasLevel) -> ToolOutput:
        if patient_id not in self.world.patients:
            self._summary(f"assign unknown patient_id={patient_id!r}")
            return ToolOutput(
                blocks=[
                    TextBlock(
                        type="text",
                        text=(f"No patient {patient_id!r}. Valid IDs: {list(self.world.patients)}"),
                    )
                ],
                reward=-0.05,
                finished=False,
            )
        if self.world.assigned[patient_id] is not None:
            self._summary(
                f"assign already-assigned patient_id={patient_id} prior={self.world.assigned[patient_id]}"
            )
            return ToolOutput(
                blocks=[
                    TextBlock(
                        type="text",
                        text=(
                            f"{patient_id} is already assigned KTAS "
                            f"{self.world.assigned[patient_id]}. "
                            f"Each patient must be assigned exactly once."
                        ),
                    )
                ],
                reward=-0.05,
                finished=False,
            )

        self.world.assigned[patient_id] = level
        patient = self.world.patients[patient_id]
        truth = patient.ground_truth_ktas
        # When the patient has no truth (manual entry without expected_ktas),
        # the assignment is recorded but unscored — reward stays at 0.0 and
        # contributes nothing to the composite.
        if truth is None:
            reward: float | None = None
            per_tool_reward = 0.0
            scored = False
        else:
            reward = scoring.assignment_reward(level, truth)
            per_tool_reward = reward
            scored = True
        order = sum(1 for v in self.world.assigned.values() if v is not None)
        self._assignments.append(
            AssignmentResult(
                patient_id=patient_id,
                agent_level=level,
                truth_level=truth,
                reward=reward,
                order=order,
            )
        )
        self._summary(
            f"assign {patient_id} -> KTAS {level} "
            + (
                f"(truth={truth}, reward={reward:.2f}, scored, order={order})"
                if scored and reward is not None
                else f"(unscored manual, order={order})"
            )
        )

        if self._all_assigned():
            breakdown = scoring.score_batch(self._assignments)
            eval_summary = evaluation_summary(self._assignments)
            scored_count = sum(1 for a in self._assignments if a.scored)
            manual_count = len(self._assignments) - scored_count

            composite = breakdown.composite
            base = breakdown.base_reward
            text_lines = [f"All {self._n_total} patients assigned."]
            if composite is not None and base is not None:
                text_lines.append(f"Composite: {composite:.3f}")
                text_lines.append(f"  Base (mean over scored): {base:.3f}")
                text_lines.append(
                    f"  Ordering bonus: {breakdown.ordering_bonus:+.2f}"
                )
            else:
                text_lines.append(
                    "Composite: (none — pure-manual run, no ground truth)"
                )
            text_lines.append("")
            text_lines.append(
                f"Scored: {scored_count} | Manual / unscored: {manual_count}"
            )
            for a in breakdown.per_assignment:
                if a.truth_level is None:
                    text_lines.append(
                        f"  {a.patient_id}: agent KTAS {a.agent_level} "
                        f"(unscored — no truth)"
                    )
                else:
                    tag = (
                        "match"
                        if a.agent_level == a.truth_level
                        else (
                            "over"
                            if a.agent_level < a.truth_level
                            else "UNDER"
                        )
                    )
                    reward_str = (
                        f"{a.reward:.2f}" if a.reward is not None else "n/a"
                    )
                    text_lines.append(
                        f"  {a.patient_id}: agent KTAS {a.agent_level} "
                        f"vs truth {a.truth_level} ({tag}, reward {reward_str})"
                    )

            # Embed structured meta below a delimiter so the harness can lift
            # it into result.json. Above the delimiter is human-readable.
            meta = {
                "scored_count": scored_count,
                "manual_count": manual_count,
                "composite_score": composite,
                "base_reward": base,
                "ordering_bonus": breakdown.ordering_bonus,
                "per_patient_assignments": [
                    {
                        "patient_id": a.patient_id,
                        "agent_level": a.agent_level,
                        "truth_level": a.truth_level,
                        "reward": a.reward,
                        "order": a.order,
                        "scored": a.scored,
                        "source": (
                            "manual"
                            if a.patient_id.startswith("manual-")
                            else "dataset"
                        ),
                        "chief_complaint": self.world.patients[
                            a.patient_id
                        ].chief_complaint,
                    }
                    for a in breakdown.per_assignment
                ],
                "evaluation_summary": (
                    eval_summary.model_dump() if eval_summary is not None else None
                ),
            }
            text_with_meta = (
                "\n".join(text_lines)
                + META_DELIMITER
                + json.dumps(meta, indent=2)
            )

            # The terminator's reward is the composite (or 0 for pure manual).
            terminal_reward = float(composite) if composite is not None else 0.0
            return ToolOutput(
                blocks=[TextBlock(type="text", text=text_with_meta)],
                reward=terminal_reward,
                finished=True,
            )

        # Mid-episode: one patient down, more to go.
        remaining = self._n_total - sum(1 for v in self.world.assigned.values() if v is not None)
        return ToolOutput(
            blocks=[
                TextBlock(
                    type="text",
                    text=(
                        f"Assigned {patient_id} -> KTAS {level} "
                        f"({KTAS_NAMES[level]}). {remaining} patient(s) remaining."
                        + ("" if scored else " (unscored — manual entry)")
                    ),
                )
            ],
            reward=per_tool_reward,
            finished=False,
        )

    # ---- @tool methods ----

    @tool
    def wait(self, params: WaitParams) -> ToolOutput:
        """Advance simulated time. Returns deterioration alerts for any
        patient whose trajectory crossed an intervention threshold during
        the wait."""
        minutes = max(0, int(params.minutes))
        before = self.world.sim_time_min
        after = min(before + minutes, self.shift_length_min)
        self.world.sim_time_min = after

        alerts: list[str] = []
        for pid, p in self.world.patients.items():
            if self.world.assigned[pid] is not None:
                continue  # already classified, no alerts
            for step in p.trajectory:
                if before < step.time_offset_min <= after and step.requires_intervention:
                    alerts.append(f"{pid}: {step.state}")

        self._summary(f"wait {minutes}m -> t+{after}m, {len(alerts)} alert(s)")
        if alerts:
            text = "Time advanced.\n" + "\n".join(f"  • {a}" for a in alerts)
        else:
            text = "Time advanced. Quiet — no deterioration alerts."
        return ToolOutput(
            blocks=[TextBlock(type="text", text=text)],
            reward=0.0,
            finished=False,
        )

    @tool
    def write_note(self, params: WriteNoteParams) -> ToolOutput:
        """Append a note to a patient's chart. Useful for marking
        observations to recall later. Does not advance time."""
        if params.patient_id not in self.world.charts:
            return ToolOutput(
                blocks=[
                    TextBlock(
                        type="text",
                        text=f"No patient {params.patient_id!r}.",
                    )
                ],
                reward=-0.05,
                finished=False,
            )
        stamped = f"[t+{self.world.sim_time_min}m] {params.note}"
        self.world.charts[params.patient_id].append(stamped)
        self._summary(f"note {params.patient_id}: {params.note[:60]}")
        return ToolOutput(
            blocks=[TextBlock(type="text", text=f"Noted: {stamped}")],
            reward=0.0,
            finished=False,
        )

    @tool
    def assign_immediate(self, params: AssignParams) -> ToolOutput:
        """KTAS 1 — Resuscitation. Use for life-threatening conditions
        requiring immediate intervention: cardiac arrest, severe trauma,
        anaphylaxis with airway compromise, GCS < 9."""
        return self._assign(params.patient_id, 1)

    @tool
    def assign_very_urgent(self, params: AssignParams) -> ToolOutput:
        """KTAS 2 — Emergent. Use for conditions with high risk of rapid
        deterioration: chest pain with ECG changes, stroke symptoms, sepsis
        signs, severe respiratory distress."""
        return self._assign(params.patient_id, 2)

    @tool
    def assign_urgent(self, params: AssignParams) -> ToolOutput:
        """KTAS 3 — Urgent. Significant pathology requiring evaluation but
        stable: moderate pain, focal infection, mild dehydration."""
        return self._assign(params.patient_id, 3)

    @tool
    def assign_standard(self, params: AssignParams) -> ToolOutput:
        """KTAS 4 — Less urgent. Stable, non-emergent: minor injury,
        chronic pain flare, simple infection."""
        return self._assign(params.patient_id, 4)

    @tool
    def assign_not_urgent(self, params: AssignParams) -> ToolOutput:
        """KTAS 5 — Non-urgent. Could be managed in primary care:
        medication refills, wound check, minor symptoms with normal vitals."""
        return self._assign(params.patient_id, 5)


if __name__ == "__main__":
    Server([TriageBatchEnv]).run()
