"""Smoke test: every module imports, OpenReward primitives are present, and
TriageBatchEnv registers cleanly under Server."""

from __future__ import annotations


def test_package_imports() -> None:
    from triage_nurse import (  # noqa: F401
        config,
        cost_tracker,
        dataset,
        harness,
        llm,
        scoring,
        triage_env,
        world_state,
    )


def test_openreward_primitives_present() -> None:
    from openreward.environments import (  # noqa: F401
        Environment,
        JSONObject,
        Server,
        Split,
        TextBlock,
        ToolOutput,
        tool,
    )


def test_env_registers_under_server() -> None:
    from openreward.environments import Server

    from triage_nurse.triage_env import TriageBatchEnv

    Server([TriageBatchEnv])  # must not raise


def test_list_tasks_returns_at_least_one() -> None:
    from triage_nurse.triage_env import TriageBatchEnv

    tasks = TriageBatchEnv.list_tasks("test")
    assert len(tasks) >= 1
    t = tasks[0]
    assert "id" in t
    assert "row_indices" in t
    assert len(t["row_indices"]) == 5
    assert len(t["ground_truth_ktas"]) == 5
    for k in t["ground_truth_ktas"]:
        assert k in (1, 2, 3, 4, 5)


def test_list_tasks_supports_train_and_test_splits() -> None:
    from triage_nurse.triage_env import TriageBatchEnv

    train_tasks = TriageBatchEnv.list_tasks("train")
    test_tasks = TriageBatchEnv.list_tasks("test")
    assert len(train_tasks) > len(test_tasks)
    assert train_tasks[0]["split"] == "train"
    assert test_tasks[0]["split"] == "test"


def test_construct_env_from_task() -> None:
    from triage_nurse.triage_env import TriageBatchEnv

    tasks = TriageBatchEnv.list_tasks("test")
    env = TriageBatchEnv(task_spec=tasks[0])
    assert len(env.world.patients) == 5
    assert all(v is None for v in env.world.assigned.values())
    prompt = env.get_prompt()
    text = prompt[0].text
    assert "assign_immediate" in text
    assert "assign_not_urgent" in text
    assert "patient_id=" in text  # canonical id formatting
