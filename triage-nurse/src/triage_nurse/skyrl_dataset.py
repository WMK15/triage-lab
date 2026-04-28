"""Dataset preparation for SkyRL training.

SkyRL consumes prompt datasets as Parquet/JSON rows. Each row carries a
chat-style prompt plus environment extras that are passed to the SkyRL-Gym
environment at rollout time.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from . import dataset

SYSTEM_PROMPT = (
    "You are an ED triage nurse. Classify every waiting patient into a KTAS "
    "triage level from 1 to 5. KTAS 1 is most urgent and KTAS 5 is least urgent. "
    "Return JSON only with this shape: "
    '{"assignments":[{"patient_id":"...","ktas":1}]}. '
    "Include each patient exactly once and triage the sickest first."
)


def _patient_lines(task_spec: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    for idx in task_spec["row_indices"]:
        patient = dataset.load_row(idx)
        vitals = patient.vitals
        pain = f"NRS pain {patient.nrs_pain}/10" if patient.nrs_pain is not None else "pain not reported"
        lines.extend(
            [
                f'patient_id="{patient.id}"',
                f"Chief complaint: {patient.chief_complaint}",
                f"History: {patient.history}",
                f"Age/sex: {patient.age} {patient.sex}; mental state: {patient.mental_state}; {pain}",
                (
                    f"Vitals: HR {vitals.hr}, BP {vitals.sbp}/{vitals.dbp}, "
                    f"RR {vitals.rr}, SpO2 {vitals.spo2}%, temp {vitals.temp_c:.1f} C"
                ),
                "",
            ]
        )
    return lines


def prompt_for_task(task_spec: dict[str, Any]) -> list[dict[str, str]]:
    """Return a SkyRL-compatible chat prompt for one triage batch."""
    user_prompt = "\n".join(
        [
            "Assign KTAS levels for this waiting-room batch.",
            "",
            "Patients:",
            *_patient_lines(task_spec),
            "Output JSON only. Do not explain.",
        ]
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def rows_for_split(split: str, limit: int | None = None) -> list[dict[str, Any]]:
    """Build SkyRL dataset rows for one deterministic split."""
    specs = dataset.list_task_specs(split=split, n=5)
    if limit is not None:
        specs = specs[:limit]

    rows: list[dict[str, Any]] = []
    for spec in specs:
        rows.append(
            {
                "data_source": "triage_nurse",
                "prompt": prompt_for_task(spec),
                "env_class": "triagebatchenv",
                "task_spec": spec,
                "reward_spec": {
                    "method": "ktas_batch_composite",
                    "ground_truth_ktas": spec["ground_truth_ktas"],
                },
                "extra_info": {
                    "task_id": spec["id"],
                    "split": split,
                },
            }
        )
    return rows


def write_skyrl_datasets(
    output_dir: Path,
    train_limit: int | None = None,
    validation_limit: int | None = None,
) -> tuple[Path, Path]:
    """Write train/validation Parquet files and return their paths."""
    import pandas as pd

    output_dir.mkdir(parents=True, exist_ok=True)
    train_path = output_dir / "train.parquet"
    validation_path = output_dir / "validation.parquet"

    pd.DataFrame(rows_for_split("train", train_limit)).to_parquet(train_path, index=False)
    pd.DataFrame(rows_for_split("test", validation_limit)).to_parquet(validation_path, index=False)

    return train_path, validation_path
