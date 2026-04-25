"""TriageEnv — the OpenReward Environment subclass.

All world state lives on `self`. The seven primitive `@tool` methods
(speak, examine, order, read, write, wait, reflect) plus `submit_handoff`
mutate `self.*` and call into the helper modules:
  - patient_logic.advance / severity_at / required_interventions_due  (sub-agent A)
  - actor_logic.nurse_speak / consultant_call / family_respond        (sub-agent B)
  - scoring.score_episode + judge.judge                                (sub-agent D)

Cases live in cases/case_*.json; the demo task spec is cases/demo_shift.json.
The env loads each referenced case at __init__ time, overriding
`arrived_at_min` from the task spec.

API verified against openreward==0.1.106 on 2026-04-25.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any, Literal

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

from . import actor_logic, judge, patient_logic, scoring
from .world_state import (
    Consultant,
    EventQueue,
    FamilyMember,
    Nurse,
    Patient,
    WorldState,
)

# ---- Tool param schemas ---------------------------------------------------
# Discrete enums use Literal so they propagate as JSON Schema enum constraints
# and the model is forced to obey (verified in the spike).


class SpeakParams(BaseModel):
    actor_id: str
    utterance: str


class ExamineParams(BaseModel):
    patient_id: str


class OrderParams(BaseModel):
    patient_id: str
    test_name: str


class ReadParams(BaseModel):
    patient_id: str


class WriteParams(BaseModel):
    patient_id: str
    note: str


class WaitParams(BaseModel):
    minutes: int


class ReflectParams(BaseModel):
    thought: str


class SubmitHandoffParams(BaseModel):
    patient_id: str
    disposition: Literal["admit", "discharge", "observe", "transfer", "deceased"]
    notes: str


# ---- Constants and lookups ------------------------------------------------

CASES_DIR = Path(__file__).parent.parent.parent / "cases"

_NURSE_IDS = ("nurse_jane", "nurse_marcus", "charge_nurse")
_CONSULTANT_SPECIALTIES: tuple[
    Literal["cardiology", "neurology", "surgery", "psych", "pediatrics"], ...
] = ("cardiology", "neurology", "surgery", "psych", "pediatrics")

# Disposition rubric: which dispositions are acceptable for each narrative role.
# "routine" patients should not be admitted unnecessarily; "crisis" patients
# must not be discharged. "observe" is a permissive middle ground.
_ACCEPTABLE_DISPOSITIONS: dict[str, set[str]] = {
    "routine": {"discharge", "observe"},
    "silent_deterioration": {"admit", "transfer", "observe"},
    "social_complication": {"admit", "transfer", "observe"},
    "crisis": {"admit", "transfer", "deceased"},
}


# ---- Helpers --------------------------------------------------------------


def _load_case(case_id: str) -> dict[str, Any]:
    """Load a case_*.json by id (the file's stem is `case_<slug>`; case `id`
    field is the canonical key — we scan the dir for a matching id)."""
    for path in CASES_DIR.glob("case_*.json"):
        data = json.loads(path.read_text())
        if data.get("id") == case_id:
            return data
    # Fall back to example case if it matches.
    example = CASES_DIR / "example_acute_mi.json"
    if example.exists():
        data = json.loads(example.read_text())
        if data.get("id") == case_id:
            return data
    raise FileNotFoundError(f"case {case_id!r} not found in {CASES_DIR}")


def _patient_from_case(raw: dict[str, Any], arrived_at_min: int) -> Patient:
    """Map case-template JSON shape onto Patient model.

    The case file uses `vitals_initial`; Patient expects `vitals`. We also
    drop the `arrived_at_min` from the case (if any) and use the value from
    the demo shift task spec.
    """
    payload = dict(raw)
    if "vitals_initial" in payload:
        payload["vitals"] = payload.pop("vitals_initial")
    payload["arrived_at_min"] = arrived_at_min
    return Patient.model_validate(payload)


def _build_world(task_spec: dict[str, Any]) -> WorldState:
    """Build the initial world from the demo shift task spec."""
    patients: dict[str, Patient] = {}
    families: dict[str, FamilyMember] = {}
    for entry in task_spec.get("patients", []):
        case_id = entry["id"]
        arrived = int(entry.get("arrived_at_min", 0))
        raw = _load_case(case_id)
        patient = _patient_from_case(raw, arrived)
        patients[patient.id] = patient
        # Lazy: every patient gets one family member, generic relation. Distress
        # rises if the agent ignores them (handled via speak()).
        families[patient.id] = FamilyMember(
            patient_id=patient.id, relation="next of kin", distress=0.3
        )

    nurses = {
        "nurse_jane": Nurse(id="nurse_jane", name="Nurse Jane"),
        "nurse_marcus": Nurse(id="nurse_marcus", name="Nurse Marcus"),
        "charge_nurse": Nurse(id="charge_nurse", name="Charge Nurse"),
    }
    consultants = {
        spec: Consultant(id=spec, specialty=spec, name=f"Dr. {spec.title()}")
        for spec in _CONSULTANT_SPECIALTIES
    }

    return WorldState(
        sim_time_min=0,
        patients=patients,
        nurses=nurses,
        consultants=consultants,
        families=families,
        event_queue=EventQueue(),
        seed=int(task_spec.get("seed", 0)),
    )


def _normalise_test_name(name: str) -> str:
    return name.strip().lower()


def _matches_confirmatory(ordered: str, required_list: list[str]) -> bool:
    """Loose match: substring either direction, case-insensitive."""
    o = _normalise_test_name(ordered)
    for req in required_list:
        r = _normalise_test_name(req)
        if o in r or r in o:
            return True
    return False


# ---- The Environment class ------------------------------------------------


class TriageEnv(Environment):
    """ED triage simulation env."""

    def __init__(
        self,
        task_spec: JSONObject = {},  # noqa: B006 — OpenReward signature
        secrets: dict[str, str] = {},  # noqa: B006 — OpenReward signature
    ) -> None:
        super().__init__(task_spec)
        # Tolerate task_spec being a Pydantic-ish wrapper or a plain dict.
        spec = task_spec if isinstance(task_spec, dict) else {}
        self.task_spec_dict: dict[str, Any] = spec
        self.world: WorldState = _build_world(spec)
        self.summary: list[str] = []
        # Per-patient bookkeeping for scoring.
        self.outcomes: dict[str, dict[str, Any]] = {
            pid: {
                "true_diagnosis": p.true_diagnosis,
                "narrative_role": p.narrative_role,
                "agent_disposition": None,
                "agent_diagnosis": None,
                "correct_disposition": False,
                "confirmatory_tests_ordered": [],
                "confirmatory_tests_required": list(p.confirmatory_tests),
                "intervention_delays_min": [],
                "adverse_events": 0,
                "survived": True,
                "time_to_disposition_min": 0.0,
            }
            for pid, p in self.world.patients.items()
        }
        self.charts: dict[str, list[str]] = {
            pid: [
                f"Chief complaint: {p.presenting_complaint}",
                f"History: {p.history}",
            ]
            for pid, p in self.world.patients.items()
        }
        self.tests_ordered: dict[str, list[str]] = {pid: [] for pid in self.world.patients}
        self.notes: list[str] = []  # /reflect notepad
        self.dispositioned: set[str] = set()
        self.shift_length_min: int = int(spec.get("shift_length_min", 360))

    # ---- ORS hooks --------------------------------------------------------

    @classmethod
    def list_tasks(cls, split: str) -> list[JSONObject]:
        """Returns tasks for the given split. For now all splits expose the
        single demo shift task from cases/demo_shift.json."""
        path = CASES_DIR / "demo_shift.json"
        if not path.exists():
            return []
        spec = json.loads(path.read_text())
        # OpenReward expects task specs to expose a top-level presenting complaint.
        # The shift task is multi-patient, so provide a concise summary string.
        if "presenting_complaint" not in spec:
            arrivals = []
            for entry in spec.get("patients", []):
                try:
                    raw_case = _load_case(entry["id"])
                    arrivals.append(raw_case.get("presenting_complaint", entry["id"]))
                except FileNotFoundError:
                    arrivals.append(entry["id"])
            spec["presenting_complaint"] = "; ".join(arrivals[:3])
        return [spec]

    @classmethod
    def list_splits(cls):
        return [Split(name="test", type="test")]

    def get_prompt(self) -> list[TextBlock]:
        lines: list[str] = []
        lines.append(
            "You are an ED physician working a 6-hour day shift (06:00-12:00). "
            "Patients arrive throughout the shift. Your job: triage, "
            "investigate, manage, and disposition every patient before the "
            "shift ends. You have nurses, consultants, and family members to "
            "interact with."
        )
        lines.append("")
        lines.append("Tools available:")
        lines.append(
            "  - speak(actor_id, utterance): address a nurse, consultant, "
            "or family. Actor IDs include 'nurse_jane', 'nurse_marcus', "
            "'charge_nurse', the consultant specialties "
            "(cardiology, neurology, surgery, psych, pediatrics), or "
            "'family_<patient_id>'."
        )
        lines.append("  - examine(patient_id): take vitals and observe the patient now.")
        lines.append("  - order(patient_id, test_name): order a test or imaging study.")
        lines.append(
            "  - read(patient_id): read the patient's chart "
            "(history + accumulated notes + results)."
        )
        lines.append(
            "  - write(patient_id, note): write to the chart. Useful for "
            "bookmarking observations to recall later."
        )
        lines.append(
            "  - wait(minutes): advance simulated time. Returns events that "
            "fired during the wait (arrivals, deteriorations, alerts)."
        )
        lines.append("  - reflect(thought): private notepad — does NOT advance time.")
        lines.append(
            "  - submit_handoff(patient_id, disposition, notes): finalise a "
            "patient. Disposition is one of: admit, discharge, observe, "
            "transfer, deceased. Episode ends when every patient has been "
            "dispositioned."
        )
        lines.append("")
        selected_case = os.getenv("TRIAGE_SELECTED_CASE", "").strip()
        operator_note = os.getenv("TRIAGE_OPERATOR_NOTE", "").strip()
        if selected_case:
            lines.append(
                f"Frontend intake hint: the operator believes case '{selected_case}' is the closest anchor for this shift."
            )
        if operator_note:
            lines.append(f"Operator note from frontend: {operator_note}")
        if selected_case or operator_note:
            lines.append("")
        lines.append("Expected arrivals on this shift:")
        for _pid, p in sorted(self.world.patients.items(), key=lambda kv: kv[1].arrived_at_min):
            lines.append(
                f"  - {p.name} ({p.id}) — arriving at +{p.arrived_at_min} min"
                f" — {p.presenting_complaint}"
            )
        lines.append("")
        lines.append(
            "Notes: patients evolve over time. Observations made by nurses "
            "early in the shift can become decisive later — write them down "
            "or you will forget. Consultant cooperation is finite — a "
            "reflexive early call costs you a later one when you really need "
            "it. Stoic and minimizing patients under-report symptoms; check "
            "vitals, not stories."
        )

        return [TextBlock(type="text", text="\n".join(lines))]

    async def teardown(self) -> None:
        # Cleanup hook — not for scoring (which lives in submit_handoff).
        return None

    # ---- Internal helpers used by tools -----------------------------------

    def _patient_or_none(self, patient_id: str) -> Patient | None:
        return self.world.patients.get(patient_id)

    def _patient_arrived(self, patient: Patient) -> bool:
        return self.world.sim_time_min >= patient.arrived_at_min

    def _refresh_patient(self, patient_id: str) -> None:
        """Apply patient_logic.advance for the cumulative time since arrival."""
        patient = self.world.patients[patient_id]
        elapsed = max(0, self.world.sim_time_min - patient.arrived_at_min)
        new_p = patient_logic.advance(patient, elapsed, seed=self.world.seed)
        self.world.patients[patient_id] = new_p

    def _summary(self, line: str) -> None:
        self.summary.append(f"t+{self.world.sim_time_min:>4}m | {line}")

    def _all_dispositioned(self) -> bool:
        return self.dispositioned == set(self.world.patients)

    # ---- @tool methods ----------------------------------------------------

    @tool
    def speak(self, params: SpeakParams) -> ToolOutput:
        """Address an actor (nurse, consultant, family). actor_id must match
        one of the registered actors."""
        aid = params.actor_id

        # Nurse
        if aid in self.world.nurses:
            reply, new_nurse = actor_logic.nurse_speak(self.world.nurses[aid], params.utterance)
            self.world.nurses[aid] = new_nurse
            self._summary(f"speak nurse {aid}: {params.utterance[:60]}")
            return ToolOutput(
                blocks=[TextBlock(type="text", text=f"{new_nurse.name}: {reply}")],
                reward=0.0,
                finished=False,
            )

        # Consultant (by specialty)
        if aid in self.world.consultants:
            reply, new_c = actor_logic.consultant_call(
                self.world.consultants[aid],
                params.utterance,
                sim_time_min=self.world.sim_time_min,
            )
            self.world.consultants[aid] = new_c
            self._summary(
                f"speak consultant {aid}: {params.utterance[:60]} -> coop={new_c.cooperation:.2f}"
            )
            return ToolOutput(
                blocks=[TextBlock(type="text", text=f"Dr. {aid.title()}: {reply}")],
                reward=0.0,
                finished=False,
            )

        # Family
        if aid.startswith("family_"):
            patient_id = aid[len("family_") :]
            if patient_id in self.world.families:
                reply, new_f = actor_logic.family_respond(
                    self.world.families[patient_id], params.utterance
                )
                self.world.families[patient_id] = new_f
                self._summary(
                    f"speak family for {patient_id}: {params.utterance[:60]}"
                    f" -> distress={new_f.distress:.2f}"
                )
                return ToolOutput(
                    blocks=[
                        TextBlock(
                            type="text",
                            text=f"Family of {self.world.patients[patient_id].name}: {reply}",
                        )
                    ],
                    reward=0.0,
                    finished=False,
                )

        # Unknown actor
        self._summary(f"speak unknown actor {aid}")
        return ToolOutput(
            blocks=[
                TextBlock(
                    type="text",
                    text=(
                        f"No actor named {aid!r}. Try one of: "
                        f"{sorted(list(self.world.nurses) + list(self.world.consultants))}, "
                        f"or family_<patient_id>."
                    ),
                )
            ],
            reward=-0.02,
            finished=False,
        )

    @tool
    def examine(self, params: ExamineParams) -> ToolOutput:
        """Examine a patient — vitals + observable trajectory state."""
        patient = self._patient_or_none(params.patient_id)
        if patient is None:
            self._summary(f"examine unknown {params.patient_id}")
            return ToolOutput(
                blocks=[
                    TextBlock(
                        type="text",
                        text=f"No patient {params.patient_id!r} on this shift.",
                    )
                ],
                reward=-0.05,
                finished=False,
            )
        if not self._patient_arrived(patient):
            self._summary(f"examine pre-arrival {params.patient_id}")
            return ToolOutput(
                blocks=[
                    TextBlock(
                        type="text",
                        text=f"{patient.name} hasn't arrived yet (ETA +{patient.arrived_at_min} min).",
                    )
                ],
                reward=-0.05,
                finished=False,
            )

        self._refresh_patient(params.patient_id)
        patient = self.world.patients[params.patient_id]
        sev = patient_logic.severity_at(patient, self.world.sim_time_min)
        v = patient.vitals
        # Observable narrative state from the trajectory step nearest now.
        elapsed = max(0, self.world.sim_time_min - patient.arrived_at_min)
        step_text = ""
        for s in patient.trajectory:
            if s.time_offset_min <= elapsed:
                step_text = s.state

        text = (
            f"{patient.name} (age {patient.age}, persona={patient.persona}):\n"
            f"  HR {v.hr}, BP {v.sbp}/{v.dbp}, RR {v.rr}, "
            f"SpO2 {v.spo2}%, Temp {v.temp_c:.1f}°C, severity={sev}\n"
            f"  Observation: {step_text or 'on arrival, no notable changes yet.'}"
        )
        self._summary(f"examine {patient.id} sev={sev}")
        return ToolOutput(
            blocks=[TextBlock(type="text", text=text)],
            reward=0.0,
            finished=False,
        )

    @tool
    def order(self, params: OrderParams) -> ToolOutput:
        """Order a test. Returns a result. Confirmatory tests for the patient's
        true diagnosis return supportive findings; non-confirmatory tests
        return within-normal-limits or pending."""
        patient = self._patient_or_none(params.patient_id)
        if patient is None:
            self._summary(f"order unknown patient {params.patient_id}")
            return ToolOutput(
                blocks=[
                    TextBlock(
                        type="text",
                        text=f"No patient {params.patient_id!r} on this shift.",
                    )
                ],
                reward=-0.05,
                finished=False,
            )
        if not self._patient_arrived(patient):
            self._summary(f"order pre-arrival {params.patient_id}")
            return ToolOutput(
                blocks=[
                    TextBlock(
                        type="text",
                        text=f"Cannot order tests on {patient.name} — not yet arrived.",
                    )
                ],
                reward=-0.05,
                finished=False,
            )

        self.tests_ordered[patient.id].append(params.test_name)
        self.outcomes[patient.id]["confirmatory_tests_ordered"].append(params.test_name)

        if _matches_confirmatory(params.test_name, patient.confirmatory_tests):
            # Supportive finding for the true diagnosis.
            result = (
                f"{params.test_name}: ABNORMAL — supportive of "
                f"{patient.true_diagnosis}. (Detail consistent with the case.)"
            )
        else:
            result = f"{params.test_name}: within normal limits / non-contributory."

        self._summary(f"order {patient.id}: {params.test_name}")
        return ToolOutput(
            blocks=[TextBlock(type="text", text=result)],
            reward=0.0,
            finished=False,
        )

    @tool
    def read(self, params: ReadParams) -> ToolOutput:
        """Read the patient's chart — history + accumulated notes."""
        patient = self._patient_or_none(params.patient_id)
        if patient is None:
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
        chart = self.charts[params.patient_id]
        text = f"{patient.name} chart:\n  " + "\n  ".join(chart)
        self._summary(f"read {patient.id}")
        return ToolOutput(
            blocks=[TextBlock(type="text", text=text)],
            reward=0.0,
            finished=False,
        )

    @tool
    def write(self, params: WriteParams) -> ToolOutput:
        """Append a note to the patient's chart."""
        if params.patient_id not in self.charts:
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
        self.charts[params.patient_id].append(stamped)
        self._summary(f"write {params.patient_id}: {params.note[:60]}")
        return ToolOutput(
            blocks=[TextBlock(type="text", text=f"Noted in chart: {stamped}")],
            reward=0.0,
            finished=False,
        )

    @tool
    def wait(self, params: WaitParams) -> ToolOutput:
        """Advance simulated time. Returns events that fired during the wait."""
        minutes = max(0, int(params.minutes))
        before = self.world.sim_time_min
        after = min(before + minutes, self.shift_length_min)
        self.world.sim_time_min = after

        events: list[str] = []
        # Patients arriving in (before, after]
        for pid, p in self.world.patients.items():
            if before < p.arrived_at_min <= after:
                events.append(f"ARRIVAL: {p.name} ({pid}) — {p.presenting_complaint}")

        # Refresh patients and surface new requires_intervention thresholds
        for pid, p in self.world.patients.items():
            if p.arrived_at_min <= after:
                # Detect a *new* intervention threshold crossed during this wait.
                pre_due = patient_logic.required_interventions_due(p, before)
                self._refresh_patient(pid)
                post_due = patient_logic.required_interventions_due(self.world.patients[pid], after)
                # Anything in post but not in pre was newly crossed.
                newly = [s for s in post_due if s not in pre_due]
                for s in newly:
                    events.append(f"DETERIORATION: {p.name} ({pid}) — {s[:120]}")

        # Shift-end signal
        if after >= self.shift_length_min and before < self.shift_length_min:
            events.append(
                "SHIFT END: clock has reached the end of the 6-hour shift. "
                "Disposition any remaining patients."
            )

        self._summary(f"wait {minutes}m -> t+{after}m, {len(events)} event(s)")
        if events:
            text = "Time advanced.\n" + "\n".join(f"  • {e}" for e in events)
        else:
            text = "Time advanced. Quiet — no new arrivals or alerts."
        return ToolOutput(
            blocks=[TextBlock(type="text", text=text)],
            reward=0.0,
            finished=False,
        )

    @tool
    def reflect(self, params: ReflectParams) -> ToolOutput:
        """Free notepad. Does NOT advance time, no state change."""
        self.notes.append(params.thought)
        self._summary(f"reflect: {params.thought[:80]}")
        return ToolOutput(
            blocks=[TextBlock(type="text", text="Noted (private).")],
            reward=0.0,
            finished=False,
        )

    @tool
    def submit_handoff(self, params: SubmitHandoffParams) -> ToolOutput:
        """Submit final disposition for a patient. Episode ends when every
        patient has been dispositioned (and final scoring runs)."""
        patient = self._patient_or_none(params.patient_id)
        if patient is None:
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
        if params.patient_id in self.dispositioned:
            return ToolOutput(
                blocks=[
                    TextBlock(
                        type="text",
                        text=f"{patient.name} already dispositioned.",
                    )
                ],
                reward=-0.02,
                finished=False,
            )

        self.dispositioned.add(params.patient_id)
        po = self.outcomes[params.patient_id]
        po["agent_disposition"] = params.disposition
        po["agent_diagnosis"] = params.notes  # parsed loosely by scoring
        po["time_to_disposition_min"] = float(self.world.sim_time_min)
        acceptable = _ACCEPTABLE_DISPOSITIONS.get(patient.narrative_role, set())
        po["correct_disposition"] = params.disposition in acceptable
        # Did we miss required interventions before submitting? Each missed
        # one bumps adverse_events.
        missed = patient_logic.required_interventions_due(patient, self.world.sim_time_min)
        # Heuristic: any required intervention that fired more than 30 minutes
        # ago without a corresponding ordered test counts as a delay.
        po["adverse_events"] = sum(
            1
            for m in missed
            if not any(
                _matches_confirmatory(t, patient.confirmatory_tests)
                for t in self.tests_ordered[patient.id]
            )
            and ("intervention" in m.lower() or "intubation" in m.lower())
        )
        # Survival heuristic: critical role with discharge -> not survived.
        if patient.narrative_role == "crisis" and params.disposition == "discharge":
            po["survived"] = False

        self._summary(
            f"submit {patient.id}: {params.disposition} (correct={po['correct_disposition']})"
        )

        # Per-patient reward signal so the agent gets feedback before episode end.
        per_patient_reward = 0.05 if po["correct_disposition"] else -0.05

        if not self._all_dispositioned():
            return ToolOutput(
                blocks=[
                    TextBlock(
                        type="text",
                        text=(
                            f"{patient.name} dispositioned to {params.disposition}. "
                            f"{len(self.world.patients) - len(self.dispositioned)} "
                            "patients remaining."
                        ),
                    )
                ],
                reward=per_patient_reward,
                finished=False,
            )

        # All patients dispositioned — run final scoring + judge inside the tool.
        try:
            judge_dims = asyncio.run(judge.judge(self.summary, self.outcomes))
        except Exception as exc:  # noqa: BLE001 — judge failures fall back
            judge_dims = {
                "defensibility": 0.5,
                "communication": 0.5,
                "relationship_management": 0.5,
                "handoff_quality": 0.5,
            }
            self._summary(f"judge failed, using neutral fallback: {exc}")

        breakdown = scoring.score_episode(self.world, self.summary, outcomes=self.outcomes)
        composite = scoring.composite_with_judge(breakdown.hard, judge_dims)

        text_lines = [
            f"All patients dispositioned. Final composite: {composite:.3f}",
            f"  Hard outcomes: survival {breakdown.hard.survival_rate:.2f}, "
            f"diagnostic {breakdown.hard.diagnostic_accuracy:.2f}, "
            f"avg time-to-dispo {breakdown.hard.avg_time_to_disposition_min:.0f}m, "
            f"adverse events {breakdown.hard.adverse_events}, "
            f"resource appropriateness {breakdown.hard.resource_appropriateness:.2f}",
            "  Judge: " + ", ".join(f"{k}={v:.2f}" for k, v in judge_dims.items()),
        ]
        return ToolOutput(
            blocks=[TextBlock(type="text", text="\n".join(text_lines))],
            reward=float(composite),
            finished=True,
        )


if __name__ == "__main__":
    Server([TriageEnv]).run()
