"""SkyRL-Gym triage adapter contract."""

from __future__ import annotations

import json

import pytest

pytest.importorskip("skyrl_gym")

from triage_nurse import dataset
from triage_nurse.skyrl_gym_env import TriageBatchSkyRLEnv


def _env() -> TriageBatchSkyRLEnv:
    spec = dataset.list_task_specs("train", n=5)[0]
    return TriageBatchSkyRLEnv(extras={"task_spec": spec})


def test_truth_assignments_score_full_reward() -> None:
    env = _env()
    assignments = [
        {
            "patient_id": patient_id,
            "ktas": env.world.patients[patient_id].ground_truth_ktas,
        }
        for patient_id in env.patient_ids
    ]

    output = env.step(json.dumps({"assignments": assignments}))

    assert output["done"] is True
    assert output["reward"] == 1.0
    assert output["metadata"]["assignments"][0]["scored"] is True


def test_missing_assignments_are_penalized() -> None:
    env = _env()
    patient_id = env.patient_ids[0]
    truth = env.world.patients[patient_id].ground_truth_ktas

    output = env.step(json.dumps({"assignments": [{"patient_id": patient_id, "ktas": truth}]}))

    assert output["done"] is True
    assert output["reward"] < 1.0
    assert env.get_metrics()["missing_assignments"] == 4
