"""Deterministic scoring contract.

Builds outcome dicts directly (rather than relying on a full env episode) so
these tests don't need the env, the LLM, or any seeded patient state. The
judge is exercised separately and only when an LLM key is configured.
"""
from __future__ import annotations

from triage_nurse.scoring import (
    HardOutcomes,
    ScoreBreakdown,
    _hard_to_scalar,
    composite_with_judge,
    score_episode,
)
from triage_nurse.world_state import WorldState


def _outcome(
    *,
    survived: bool = True,
    correct: bool = True,
    diagnosis: str = "NSTEMI",
    truth: str = "Non-ST-elevation myocardial infarction (NSTEMI)",
    time_min: float = 60.0,
    adverse: int = 0,
    required: list[str] | None = None,
    ordered: list[str] | None = None,
) -> dict:
    if required is None:
        required = ["ECG", "troponin"]
    if ordered is None:
        ordered = list(required) if correct else []
    return {
        "true_diagnosis": truth,
        "agent_diagnosis": diagnosis if correct else "GERD",
        "agent_disposition": "admit" if correct else "discharge",
        "correct_disposition": correct,
        "confirmatory_tests_required": required,
        "confirmatory_tests_ordered": ordered,
        "intervention_delays_min": [],
        "adverse_events": adverse,
        "survived": survived,
        "time_to_disposition_min": time_min,
    }


def test_score_perfect() -> None:
    """All survived, correct dx, fast dispo, no adverse → composite >= 0.85."""
    outcomes = {
        "p1": _outcome(time_min=45.0),
        "p2": _outcome(diagnosis="ACS", truth="NSTEMI", time_min=70.0),
        "p3": _outcome(time_min=30.0),
    }
    state = WorldState()
    result = score_episode(state, summary=[], outcomes=outcomes)
    assert isinstance(result, ScoreBreakdown)
    assert result.hard.survival_rate == 1.0
    assert result.hard.diagnostic_accuracy == 1.0
    assert result.hard.adverse_events == 0
    assert result.hard.resource_appropriateness == 1.0
    assert result.composite >= 0.85, f"expected >= 0.85, got {result.composite}"


def test_score_disaster() -> None:
    """Deaths, wrong dx, slow dispo, adverse events → composite <= 0.30."""
    outcomes = {
        "p1": _outcome(survived=False, correct=False, time_min=300.0, adverse=2),
        "p2": _outcome(survived=False, correct=False, time_min=280.0, adverse=3),
        "p3": _outcome(survived=True, correct=False, time_min=320.0, adverse=1),
    }
    state = WorldState()
    result = score_episode(state, summary=[], outcomes=outcomes)
    assert result.hard.survival_rate < 0.5
    assert result.hard.diagnostic_accuracy == 0.0
    assert result.hard.adverse_events >= 5
    assert result.composite <= 0.30, f"expected <= 0.30, got {result.composite}"


def test_composite_with_judge_blends() -> None:
    """High hard scalar but low judge dims → middling composite (~0.7*0.95 + 0.3*0.1 = 0.695)."""
    high_hard = HardOutcomes(
        survival_rate=1.0,
        diagnostic_accuracy=1.0,
        avg_time_to_disposition_min=30.0,
        adverse_events=0,
        resource_appropriateness=1.0,
    )
    low_judge = {
        "defensibility": 0.1,
        "communication": 0.1,
        "relationship_management": 0.1,
        "handoff_quality": 0.1,
    }
    blended = composite_with_judge(high_hard, low_judge)
    # Hard alone would be ~0.95+; judge pulls it down to ~0.7.
    hard_alone = _hard_to_scalar(high_hard)
    assert hard_alone > 0.85
    assert 0.55 <= blended <= 0.80, f"expected middling 0.55-0.80, got {blended}"
    # Sanity: with no judge, composite_with_judge falls back to pure hard.
    assert composite_with_judge(high_hard, {}) == hard_alone


def test_hard_to_scalar_clamped() -> None:
    """Edge values stay in [0, 1] regardless of input extremes."""
    # Best case
    best = HardOutcomes(
        survival_rate=1.0,
        diagnostic_accuracy=1.0,
        avg_time_to_disposition_min=0.0,
        adverse_events=0,
        resource_appropriateness=1.0,
    )
    assert _hard_to_scalar(best) == 1.0

    # Worst case
    worst = HardOutcomes(
        survival_rate=0.0,
        diagnostic_accuracy=0.0,
        avg_time_to_disposition_min=10000.0,  # way over the 240 target
        adverse_events=99,
        resource_appropriateness=0.0,
    )
    s = _hard_to_scalar(worst)
    assert 0.0 <= s <= 1.0
    # adverse_events inverted only contributes 0.20/(1+99) ≈ 0.002; everything
    # else zeroes; expect a tiny floor.
    assert s < 0.05

    # Out-of-range inputs (shouldn't happen but the function must clamp).
    weird = HardOutcomes(
        survival_rate=2.0,  # over 1
        diagnostic_accuracy=-0.5,  # below 0
        avg_time_to_disposition_min=-10.0,
        adverse_events=0,
        resource_appropriateness=1.5,
    )
    s2 = _hard_to_scalar(weird)
    assert 0.0 <= s2 <= 1.0


def test_score_episode_no_outcomes_uses_state_fallback() -> None:
    """Without an outcomes dict, score_episode degrades gracefully on empty
    state (no patients → vacuously-perfect rates, neutral time)."""
    state = WorldState()
    result = score_episode(state, summary=["did a thing"])
    assert isinstance(result, ScoreBreakdown)
    assert 0.0 <= result.composite <= 1.0


def test_score_episode_partial_outcomes_tolerated() -> None:
    """Outcomes dict with sparse / missing fields still scores without raising."""
    outcomes: dict[str, dict] = {
        "p1": {
            "true_diagnosis": "NSTEMI",
            "survived": True,
            "time_to_disposition_min": 50,
        },
        "p2": {},  # totally empty
    }
    state = WorldState()
    result = score_episode(state, summary=[], outcomes=outcomes)
    assert 0.0 <= result.composite <= 1.0
    assert result.hard.survival_rate <= 1.0
