"""Smoke test: every module imports, OpenReward primitives are present, and
the env class registers cleanly under Server even with NotImplementedError
tools."""
from __future__ import annotations


def test_package_imports() -> None:
    from triage_nurse import (  # noqa: F401
        actor_logic,
        config,
        cost_tracker,
        harness,  # noqa: F401
        judge,
        llm,
        patient_logic,
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
    """The class is registrable even though tools raise NotImplementedError."""
    from openreward.environments import Server

    from triage_nurse.triage_env import TriageEnv

    # Construction of Server should not raise.
    Server([TriageEnv])


def test_example_case_loads() -> None:
    import json
    from pathlib import Path

    case_path = (
        Path(__file__).parent.parent / "cases" / "example_acute_mi.json"
    )
    case = json.loads(case_path.read_text())
    assert case["narrative_role"] == "silent_deterioration"
    assert case["true_diagnosis"].startswith("Non-ST-elevation")
    assert len(case["trajectory"]) >= 3
    assert "ECG (12-lead)" in case["confirmatory_tests"]
