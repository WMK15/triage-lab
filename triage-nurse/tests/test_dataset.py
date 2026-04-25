"""Dataset loader contract: rows decode, batches are diverse, deterministic."""

from __future__ import annotations

import pytest

from triage_nurse import dataset


def test_load_row_returns_patient() -> None:
    indices = dataset.select_diverse_batch(seed=0, n=5)
    p = dataset.load_row(indices[0])
    assert p.id
    assert p.id == dataset.load_row(indices[0]).id
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


def test_split_row_indices_partition_the_dataset() -> None:
    train = set(dataset.split_row_indices("train"))
    test = set(dataset.split_row_indices("test"))
    assert train
    assert test
    assert train.isdisjoint(test)
    combined = train | test
    valid = set()
    for level in (1, 2, 3, 4, 5):
        valid.update(dataset._build_valid_indices()[level])  # type: ignore[attr-defined]
    assert combined == valid


def test_train_split_is_larger_than_test_split() -> None:
    train = dataset.split_row_indices("train")
    test = dataset.split_row_indices("test")
    assert len(train) > len(test)
    assert len(train) >= 900


def test_select_diverse_batch_respects_split() -> None:
    train_batch = dataset.select_diverse_batch(seed=1, n=5, split="train")
    test_batch = dataset.select_diverse_batch(seed=1, n=5, split="test")
    train_rows = set(dataset.split_row_indices("train"))
    test_rows = set(dataset.split_row_indices("test"))
    assert set(train_batch).issubset(train_rows)
    assert set(test_batch).issubset(test_rows)


def test_list_task_specs_are_split_aware() -> None:
    train_task = dataset.list_task_specs("train", n=5)[0]
    test_task = dataset.list_task_specs("test", n=5)[0]
    assert train_task["split"] == "train"
    assert test_task["split"] == "test"
    assert train_task["id"].startswith("train-batch-")
    assert test_task["id"].startswith("test-batch-")


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
