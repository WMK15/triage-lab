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
    truth_level: KtasLevel
    reward: float
    order: int  # 1-based: which assignment was this in the episode


class ScoreBreakdown(BaseModel):
    per_assignment: list[AssignmentResult]
    base_reward: float           # mean of per_assignment rewards
    ordering_bonus: float        # +0.1, 0, or -0.1
    composite: float             # clamp01(base + bonus)


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
    """+0.1 if the FIRST assignment was the highest-acuity patient in the batch
    (i.e. truth = min over the batch); -0.1 if it was the lowest-acuity
    (truth = max). 0 otherwise."""
    if not per_assignment:
        return 0.0
    truths = [a.truth_level for a in per_assignment]
    if len(set(truths)) == 1:
        return 0.0  # everyone same level — no ordering signal
    first = next((a for a in per_assignment if a.order == 1), None)
    if first is None:
        return 0.0
    if first.truth_level == min(truths):
        return 0.1
    if first.truth_level == max(truths):
        return -0.1
    return 0.0


def _clamp01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def score_batch(per_assignment: list[AssignmentResult]) -> ScoreBreakdown:
    if not per_assignment:
        return ScoreBreakdown(
            per_assignment=[], base_reward=0.0, ordering_bonus=0.0, composite=0.0
        )
    base = sum(a.reward for a in per_assignment) / len(per_assignment)
    bonus = _ordering_bonus(per_assignment)
    composite = _clamp01(base + bonus)
    return ScoreBreakdown(
        per_assignment=per_assignment,
        base_reward=base,
        ordering_bonus=bonus,
        composite=composite,
    )
