"""Scoring contract: asymmetric distance + ordering bonus."""
from __future__ import annotations

import pytest

from triage_nurse import scoring
from triage_nurse.scoring import AssignmentResult


@pytest.mark.parametrize(
    "agent,truth,expected",
    [
        # Exact match
        (1, 1, 1.0),
        (3, 3, 1.0),
        (5, 5, 1.0),
        # Over-triage (agent assigns more severe than truth → numerically lower)
        (1, 2, 0.6),  # off by 1 over
        (2, 3, 0.6),
        (1, 3, 0.2),  # off by 2 over
        (1, 5, 0.0),  # off by 4 over
        # Under-triage (agent assigns less severe than truth → numerically higher)
        (2, 1, 0.3),  # off by 1 under, 0.6 * 0.5
        (3, 2, 0.3),
        (3, 1, 0.1),  # off by 2 under, 0.2 * 0.5
        (5, 1, 0.0),  # off by 4 under
    ],
)
def test_assignment_reward_table(agent: int, truth: int, expected: float) -> None:
    actual = scoring.assignment_reward(agent, truth)
    assert abs(actual - expected) < 1e-6, f"agent={agent} truth={truth}: {actual} != {expected}"


def test_under_triage_punished_harder_than_over() -> None:
    over = scoring.assignment_reward(2, 3)  # over by 1
    under = scoring.assignment_reward(3, 2)  # under by 1
    assert over > under
    assert over == under * 2  # exactly 0.5x


def _result(pid: str, agent: int, truth: int, order: int) -> AssignmentResult:
    return AssignmentResult(
        patient_id=pid,
        agent_level=agent,
        truth_level=truth,
        reward=scoring.assignment_reward(agent, truth),
        order=order,
    )


def test_score_batch_perfect_match() -> None:
    rs = [
        _result("p1", 1, 1, 1),  # most severe first
        _result("p2", 2, 2, 2),
        _result("p3", 3, 3, 3),
        _result("p4", 4, 4, 4),
        _result("p5", 5, 5, 5),
    ]
    bd = scoring.score_batch(rs)
    assert bd.base_reward == 1.0
    assert bd.ordering_bonus == 0.1  # KTAS 1 first → bonus
    assert bd.composite == 1.0  # 1.0 + 0.1, clamped


def test_score_batch_disaster_under_triage() -> None:
    rs = [
        _result("p1", 5, 1, 1),  # KTAS 5 (least severe) assigned to KTAS-1 truth first
        _result("p2", 5, 2, 2),
        _result("p3", 5, 3, 3),
        _result("p4", 5, 4, 4),
        _result("p5", 5, 5, 5),
    ]
    bd = scoring.score_batch(rs)
    assert bd.base_reward < 0.3
    # First was KTAS-1 truth (most severe) — bonus +0.1, but composite is
    # still low because the assignments are awful.
    assert bd.ordering_bonus == 0.1
    assert bd.composite < 0.4


def test_score_batch_ordering_penalty_for_lowest_acuity_first() -> None:
    rs = [
        _result("p5", 5, 5, 1),  # least severe assigned first
        _result("p4", 4, 4, 2),
        _result("p3", 3, 3, 3),
        _result("p2", 2, 2, 4),
        _result("p1", 1, 1, 5),
    ]
    bd = scoring.score_batch(rs)
    assert bd.base_reward == 1.0
    assert bd.ordering_bonus == -0.1
    assert bd.composite == 0.9


def test_score_batch_no_ordering_bonus_when_all_same_level() -> None:
    rs = [_result(f"p{i}", 3, 3, i + 1) for i in range(5)]
    bd = scoring.score_batch(rs)
    assert bd.ordering_bonus == 0.0


def test_assign_immediate_to_everyone_attack() -> None:
    """Reward-gaming smoke: agent assigns KTAS 1 to a typical batch.

    Should net less than half the perfect score because most patients
    are over-triaged by 2-4 levels.
    """
    truths = [1, 2, 3, 4, 5]
    rs = [_result(f"p{t}", 1, t, i + 1) for i, t in enumerate(truths)]
    bd = scoring.score_batch(rs)
    assert bd.composite < 0.6


def test_clamp_keeps_composite_in_range() -> None:
    rs = [_result("p1", 1, 1, 1), _result("p5", 5, 5, 2)]
    bd = scoring.score_batch(rs)
    assert 0.0 <= bd.composite <= 1.0
