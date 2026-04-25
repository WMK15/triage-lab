"""Pure deterministic scoring for triage-batch v2.

Reward shape (per the spec):

  per-assignment: gap = |agent - truth|;
                  base = max(0, 1.0 - 0.4 * gap);
                  if agent > truth (under-triage): base *= 0.5

  composite: mean(per-assignment rewards) +/- 0.1 ordering bonus
             when the FIRST patient assigned was the highest-acuity (lowest
             KTAS truth, +0.1) or lowest-acuity (highest truth, -0.1).
             Clamped to [0, 1].

No judge. Ground truth is exact match against KTAS_expert from the dataset.
"""
from __future__ import annotations

from pydantic import BaseModel

from .world_state import KtasLevel


class AssignmentResult(BaseModel):
    patient_id: str
    agent_level: KtasLevel
    # Optional: dataset patients have it from KTAS_expert; manual patients
    # have it set when user provided expected_ktas, otherwise None (unscored).
    truth_level: KtasLevel | None = None
    reward: float | None = None  # None for unscored
    order: int  # 1-based: which assignment was this in the episode

    @property
    def scored(self) -> bool:
        return self.truth_level is not None


class ScoreBreakdown(BaseModel):
    per_assignment: list[AssignmentResult]
    base_reward: float | None        # mean of scored entries; None if zero scored
    ordering_bonus: float            # +0.1, 0, or -0.1 (over scored entries only)
    composite: float | None          # clamp01(base + bonus); None if all unscored


def assignment_reward(agent_level: int, truth_level: int) -> float:
    """The asymmetric KTAS distance reward.

    Recall the KTAS scale: 1=most severe, 5=least severe. Under-triage means
    the agent assigned a *higher* number than truth (less severe than truth)
    — this is what kills patients in the literature, so we penalise harder.
    """
    gap = abs(agent_level - truth_level)
    base = max(0.0, 1.0 - 0.4 * gap)
    if agent_level > truth_level:  # under-triage
        return base * 0.5
    return base


def _ordering_bonus(per_assignment: list[AssignmentResult]) -> float:
    """+0.1 if the FIRST scored assignment was the highest-acuity patient
    in the batch (truth=min); -0.1 if it was the lowest-acuity (truth=max).
    Manual / unscored entries are ignored — they don't contribute to or
    influence the bonus."""
    scored = [a for a in per_assignment if a.scored]
    if not scored:
        return 0.0
    truths = [a.truth_level for a in scored]
    if len(set(truths)) == 1:
        return 0.0  # everyone same level — no ordering signal
    first_scored = min(scored, key=lambda a: a.order)
    if first_scored.truth_level == min(truths):
        return 0.1
    if first_scored.truth_level == max(truths):
        return -0.1
    return 0.0


def _clamp01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def score_batch(per_assignment: list[AssignmentResult]) -> ScoreBreakdown:
    """Compute the batch composite over the *scored* entries only.

    Pure-manual runs (every entry unscored) return base/composite=None.
    Mixed batches average over the scored entries; the unscored
    classifications are recorded but don't move the score.
    """
    scored = [a for a in per_assignment if a.scored and a.reward is not None]
    if not scored:
        return ScoreBreakdown(
            per_assignment=per_assignment,
            base_reward=None,
            ordering_bonus=0.0,
            composite=None,
        )
    base = sum(a.reward for a in scored if a.reward is not None) / len(scored)
    bonus = _ordering_bonus(per_assignment)
    composite = _clamp01(base + bonus)
    return ScoreBreakdown(
        per_assignment=per_assignment,
        base_reward=base,
        ordering_bonus=bonus,
        composite=composite,
    )


# ---------------------------------------------------------------------------
# Evaluation summary — pre-computed truth-vs-agent stats for the UI.
# ---------------------------------------------------------------------------


class EvaluationSummary(BaseModel):
    scored_count: int
    exact_matches: int
    over_triage: int           # agent assigned MORE severe than truth (numerically lower)
    under_triage: int          # agent assigned LESS severe than truth (numerically higher)
    exact_rate: float          # exact_matches / scored_count
    mistriage_rate: float      # 1 - exact_rate
    under_triage_rate: float   # under_triage / scored_count
    off_by_one_count: int
    off_by_two_or_more_count: int
    confusion: dict[str, dict[str, int]]


def evaluation_summary(
    per_assignment: list[AssignmentResult],
) -> EvaluationSummary | None:
    """Return aggregated truth-vs-agent stats for the UI. None if no scored
    entries — the front-end then renders the trajectory without an Evaluation
    card."""
    scored = [a for a in per_assignment if a.scored and a.truth_level is not None]
    if not scored:
        return None
    n = len(scored)
    exact = sum(1 for a in scored if a.agent_level == a.truth_level)
    over = sum(
        1 for a in scored if a.truth_level is not None and a.agent_level < a.truth_level
    )
    under = sum(
        1 for a in scored if a.truth_level is not None and a.agent_level > a.truth_level
    )
    off_one = sum(
        1
        for a in scored
        if a.truth_level is not None and abs(a.agent_level - a.truth_level) == 1
    )
    off_two_plus = sum(
        1
        for a in scored
        if a.truth_level is not None and abs(a.agent_level - a.truth_level) >= 2
    )
    confusion: dict[str, dict[str, int]] = {str(k): {} for k in (1, 2, 3, 4, 5)}
    for a in scored:
        ak = str(a.agent_level)
        tk = str(a.truth_level)
        confusion[ak][tk] = confusion[ak].get(tk, 0) + 1
    return EvaluationSummary(
        scored_count=n,
        exact_matches=exact,
        over_triage=over,
        under_triage=under,
        exact_rate=exact / n,
        mistriage_rate=1.0 - (exact / n),
        under_triage_rate=under / n,
        off_by_one_count=off_one,
        off_by_two_or_more_count=off_two_plus,
        confusion=confusion,
    )
