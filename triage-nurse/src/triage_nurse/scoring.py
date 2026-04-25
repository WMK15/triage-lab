"""Deterministic scoring of an episode's outcomes.

Owned by sub-agent D. Pure function — reads world state at end of episode plus
the tool-call summary, returns a structured breakdown. The judge (separate
LLM call) contributes the practice-quality dimensions; this module only does
the hard outcomes (survival, diagnostic accuracy, time-to-disposition,
adverse events, resource appropriateness).

The env builds a small `outcomes` dict per-patient as it runs; see
`PatientOutcome` below for the contract. The dict-based shape (rather than a
nested pydantic model) keeps the env-side construction loose and tolerant of
missing fields — every reader here defaults sensibly.
"""
from __future__ import annotations

from typing import Any, TypedDict

from pydantic import BaseModel

from .world_state import WorldState

# Time-to-disposition is normalised against this 4h target. Under is good.
TARGET_DISPOSITION_MIN = 240.0

# Hard-outcome blend weights. Sum = 1.0.
_W_SURVIVAL = 0.30
_W_DIAGNOSTIC = 0.25
_W_TIME = 0.15
_W_ADVERSE = 0.20
_W_RESOURCE = 0.10

# Composite weights when judge dims are present.
_HARD_PORTION = 0.7
_JUDGE_PORTION = 0.3


class PatientOutcome(TypedDict, total=False):
    """Per-patient outcome dict the env builds during the episode.

    All fields optional — `score_episode` defaults missing values to safe
    neutrals so an in-progress / partial episode still scores.
    """

    true_diagnosis: str
    agent_disposition: str
    agent_diagnosis: str
    correct_disposition: bool
    confirmatory_tests_ordered: list[str]
    confirmatory_tests_required: list[str]
    intervention_delays_min: list[int]
    adverse_events: int
    survived: bool
    time_to_disposition_min: float


class HardOutcomes(BaseModel):
    survival_rate: float
    diagnostic_accuracy: float
    avg_time_to_disposition_min: float
    adverse_events: int
    resource_appropriateness: float


class ScoreBreakdown(BaseModel):
    hard: HardOutcomes
    composite: float  # 0..1; 70% hard + 30% judge if judge is available


def _clamp01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def _diagnosis_match(agent: str | None, truth: str | None) -> bool:
    """Loose textual match — case-insensitive substring either direction.

    The agent may write a free-form diagnosis (e.g. "ACS" or "MI") that maps
    to the truth ("Non-ST-elevation myocardial infarction (NSTEMI)"). We
    accept either an exact case-insensitive equality, an acronym hit, or a
    substring overlap.
    """
    if not agent or not truth:
        return False
    a = agent.strip().lower()
    t = truth.strip().lower()
    if not a or not t:
        return False
    if a == t:
        return True
    if a in t or t in a:
        return True
    # Try ACS-style acronyms: pull capitalised letters from the truth string
    # and compare to the agent's text after stripping non-alpha.
    truth_acronym = "".join(c for c in truth if c.isupper())
    agent_acronym = "".join(c for c in agent if c.isalnum()).upper()
    if truth_acronym and agent_acronym and truth_acronym == agent_acronym:
        return True
    # Common ACS umbrella check.
    if "nstemi" in t or "stemi" in t or "myocardial" in t or "infarction" in t:
        if "acs" in a or "mi" == a or "acute coronary" in a:
            return True
    return False


def _resource_score(po: dict[str, Any]) -> float:
    """Fraction of required confirmatory tests that were ordered, in [0, 1].

    If no tests were required, treat as 1.0 (nothing to miss). Extra tests
    beyond the required set are not penalised here — overordering is captured
    indirectly by the time-to-disposition and judge dimensions.
    """
    required = po.get("confirmatory_tests_required") or []
    if not required:
        return 1.0
    ordered = po.get("confirmatory_tests_ordered") or []
    ordered_set = {t.strip().lower() for t in ordered if isinstance(t, str)}
    hit = 0
    for t in required:
        if not isinstance(t, str):
            continue
        key = t.strip().lower()
        # Substring either way: agent might say "troponin" for "Repeat
        # troponin at 60 min" — accept the partial match here, the judge
        # picks up the timing nuance.
        if key in ordered_set:
            hit += 1
            continue
        if any(key in o or o in key for o in ordered_set):
            hit += 1
    return _clamp01(hit / len(required))


def _outcomes_from_state(state: WorldState) -> dict[str, dict[str, Any]]:
    """Fallback outcomes dict when the env did not build one.

    Survival, adverse events, and ordered tests are unknown without the env's
    bookkeeping, so this is a degenerate case used only when scoring partial
    or aborted episodes. Each patient gets a neutral 0.5-ish placeholder.
    """
    out: dict[str, dict[str, Any]] = {}
    for pid, patient in state.patients.items():
        out[pid] = {
            "true_diagnosis": patient.true_diagnosis,
            "agent_disposition": None,
            "agent_diagnosis": None,
            "correct_disposition": False,
            "confirmatory_tests_ordered": [],
            "confirmatory_tests_required": list(patient.confirmatory_tests),
            "intervention_delays_min": [],
            "adverse_events": 0,
            "survived": True,
            "time_to_disposition_min": float(state.sim_time_min),
        }
    return out


def _hard_from_outcomes(outcomes: dict[str, dict[str, Any]]) -> HardOutcomes:
    if not outcomes:
        # No patients → vacuously perfect on rates, neutral on time.
        return HardOutcomes(
            survival_rate=1.0,
            diagnostic_accuracy=1.0,
            avg_time_to_disposition_min=0.0,
            adverse_events=0,
            resource_appropriateness=1.0,
        )

    n = len(outcomes)
    survived = 0
    correct_dx = 0
    total_time = 0.0
    total_adverse = 0
    resource_acc = 0.0
    for po in outcomes.values():
        if po.get("survived", True):
            survived += 1
        # Diagnostic accuracy: prefer agent_diagnosis match; else fall back
        # to correct_disposition flag the env may have computed.
        if _diagnosis_match(
            po.get("agent_diagnosis"), po.get("true_diagnosis")
        ):
            correct_dx += 1
        elif po.get("correct_disposition"):
            # Half-credit if the disposition was right but the diagnosis was
            # missing or didn't match — the patient ended up in the right
            # place but the reasoning isn't auditable. Use 0.5 by adding a
            # half-count via separate accumulator.
            correct_dx += 0  # explicit: full match required for full credit
        total_time += float(po.get("time_to_disposition_min", 0) or 0)
        total_adverse += int(po.get("adverse_events", 0) or 0)
        resource_acc += _resource_score(po)

    return HardOutcomes(
        survival_rate=_clamp01(survived / n),
        diagnostic_accuracy=_clamp01(correct_dx / n),
        avg_time_to_disposition_min=total_time / n,
        adverse_events=total_adverse,
        resource_appropriateness=_clamp01(resource_acc / n),
    )


def _hard_to_scalar(h: HardOutcomes) -> float:
    """Weighted blend; clamp 0..1.

    weights: survival 0.30, diag accuracy 0.25, time-to-dispo 0.15,
             adverse events (inverted) 0.20, resource appropriateness 0.10.
    Time-to-dispo: normalize against 240min (4h) — under is good.
    """
    # Time score: 1.0 at 0 min, 0.0 at >= 240 min, linear in between.
    time_score = _clamp01(
        1.0 - (h.avg_time_to_disposition_min / TARGET_DISPOSITION_MIN)
    )
    # Adverse events: inverted exponential-ish decay. 0 events → 1.0,
    # 1 → 0.5, 2 → 0.25, 3+ → small. Smooth, no thresholds.
    adverse_score = 1.0 / (1.0 + max(0, h.adverse_events))

    blended = (
        _W_SURVIVAL * h.survival_rate
        + _W_DIAGNOSTIC * h.diagnostic_accuracy
        + _W_TIME * time_score
        + _W_ADVERSE * adverse_score
        + _W_RESOURCE * h.resource_appropriateness
    )
    return _clamp01(blended)


def composite_with_judge(
    hard: HardOutcomes, judge_dims: dict[str, float]
) -> float:
    """0.7 * _hard_to_scalar(hard) + 0.3 * mean(judge_dims.values()). Clamp 0..1."""
    hard_scalar = _hard_to_scalar(hard)
    if not judge_dims:
        return hard_scalar
    vals = [float(v) for v in judge_dims.values()]
    judge_scalar = sum(vals) / len(vals)
    return _clamp01(_HARD_PORTION * hard_scalar + _JUDGE_PORTION * judge_scalar)


def score_episode(
    state: WorldState,
    summary: list[str],
    outcomes: dict[str, dict[str, Any]] | None = None,
) -> ScoreBreakdown:
    """Compute hard outcomes + composite from the env's per-patient outcomes.

    `summary` is accepted for symmetry with the judge — this function does
    not currently use it (the judge consumes summaries; deterministic scoring
    runs off the structured outcomes dict the env emits).

    Without judge, composite = _hard_to_scalar(hard) — full weight to hard.
    """
    del summary  # accepted but unused; symmetry with judge signature.
    if outcomes is None:
        outcomes = _outcomes_from_state(state)
    hard = _hard_from_outcomes(outcomes)
    composite = _hard_to_scalar(hard)
    return ScoreBreakdown(hard=hard, composite=composite)
