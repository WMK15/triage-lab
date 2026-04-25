"""Dataset loader contract: rows decode, batches are diverse, deterministic."""
from __future__ import annotations

import pytest

from triage_nurse import dataset


def test_load_row_returns_patient() -> None:
    indices = dataset.select_diverse_batch(seed=0, n=5)
    p = dataset.load_row(indices[0])
    assert p.id == f"row-{indices[0]}"
    assert p.sex in ("F", "M")
    assert 0 <= p.age <= 130
    assert p.chief_complaint
    assert p.ground_truth_ktas in (1, 2, 3, 4, 5)
    assert p.vitals.hr > 0
    assert p.vitals.sbp > 0
    assert len(p.trajectory) >= 2


def test_select_diverse_batch_deterministic() -> None:
    a = dataset.select_diverse_batch(seed=42, n=5)
    b = dataset.select_diverse_batch(seed=42, n=5)
    assert a == b


def test_select_diverse_batch_includes_severe_and_mild() -> None:
    indices = dataset.select_diverse_batch(seed=42, n=5)
    levels = [dataset.load_row(i).ground_truth_ktas for i in indices]
    assert min(levels) <= 2, f"expected at least one KTAS 1-2, got {levels}"
    assert max(levels) >= 4, f"expected at least one KTAS 4-5, got {levels}"


def test_select_diverse_batch_size_n5_covers_all_levels() -> None:
    indices = dataset.select_diverse_batch(seed=42, n=5)
    assert len(indices) == 5
    levels = sorted({dataset.load_row(i).ground_truth_ktas for i in indices})
    # At n=5 and a 1267-row dataset with all five levels populated, the
    # diverse picker should cover all levels.
    assert levels == [1, 2, 3, 4, 5]


def test_trajectory_severity_matches_ktas() -> None:
    """KTAS 1-2 patients get a third trajectory step; KTAS 3-5 don't."""
    for seed in (0, 1, 7, 42):
        for idx in dataset.select_diverse_batch(seed=seed, n=5):
            p = dataset.load_row(idx)
            if p.ground_truth_ktas <= 2:
                assert len(p.trajectory) == 3
            else:
                assert len(p.trajectory) == 2


def test_load_row_raises_on_out_of_range() -> None:
    with pytest.raises(IndexError):
        dataset.load_row(99999)
