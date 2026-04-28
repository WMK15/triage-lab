"""SkyRL dataset adapter contract."""

from __future__ import annotations

from triage_nurse.skyrl_dataset import rows_for_split


def test_rows_for_split_emit_skyrl_prompt_rows() -> None:
    rows = rows_for_split("train", limit=1)

    assert len(rows) == 1
    row = rows[0]
    assert row["env_class"] == "triagebatchenv"
    assert row["data_source"] == "triage_nurse"
    assert row["task_spec"]["split"] == "train"
    assert row["reward_spec"]["method"] == "ktas_batch_composite"
    assert len(row["reward_spec"]["ground_truth_ktas"]) == 5

    prompt = row["prompt"]
    assert prompt[0]["role"] == "system"
    assert prompt[1]["role"] == "user"
    assert "Output JSON only" in prompt[1]["content"]
    assert "patient_id=" in prompt[1]["content"]


def test_validation_rows_use_held_out_split() -> None:
    rows = rows_for_split("test", limit=1)

    assert len(rows) == 1
    assert rows[0]["task_spec"]["split"] == "test"
    assert rows[0]["extra_info"]["split"] == "test"
