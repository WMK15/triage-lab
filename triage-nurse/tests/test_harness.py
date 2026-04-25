"""Harness contract — no real episode is run; we only assert pure-function
behaviour and that the public surface imports cleanly."""
from __future__ import annotations


def test_imports() -> None:
    from triage_nurse.harness import _make_episode_id, main, run_task  # noqa: F401


def test_make_episode_id_unique() -> None:
    from triage_nurse.harness import _make_episode_id

    a = _make_episode_id("task-a", "gpt-5-mini")
    b = _make_episode_id("task-a", "gpt-5-mini")
    assert a != b


def test_make_episode_id_safe() -> None:
    from triage_nurse.harness import _make_episode_id

    eid = _make_episode_id("task-x", "anthropic/claude-sonnet-4-6")
    # The "/" in the model name must be replaced so the id is filesystem-safe.
    assert "/" not in eid
    assert "anthropic-claude-sonnet-4-6" in eid
    assert eid.startswith("task-x__")
