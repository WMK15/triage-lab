"""Cost tracker contract: records add up, cap fires, reset clears."""
from __future__ import annotations

import pytest

from triage_nurse import cost_tracker


@pytest.fixture(autouse=True)
def _reset_tracker():
    cost_tracker.reset()
    yield
    cost_tracker.reset()


def test_record_accumulates() -> None:
    cost_tracker.record("openai", "gpt-5-mini", 1000, 500)
    assert cost_tracker.total_usd() > 0
    assert cost_tracker.total_gbp() > 0


def test_unknown_model_uses_default_price() -> None:
    cost_tracker.record("custom", "made-up-model", 1000, 500)
    assert cost_tracker.total_usd() > 0


def test_cap_raises_on_excess(monkeypatch: pytest.MonkeyPatch) -> None:
    # Lower the cap so the test runs cheaply.
    monkeypatch.setattr(cost_tracker.settings, "TRIAGE_NURSE_MAX_EPISODE_GBP", 0.001)
    with pytest.raises(cost_tracker.CostCapExceeded):
        cost_tracker.record("openai", "claude-opus-4-7", 1_000_000, 1_000_000)


def test_reset_clears() -> None:
    cost_tracker.record("openai", "gpt-5-mini", 1000, 500)
    assert cost_tracker.total_usd() > 0
    cost_tracker.reset()
    assert cost_tracker.total_usd() == 0
    assert cost_tracker.summary()["calls"] == 0


def test_summary_structure() -> None:
    cost_tracker.record("openai", "gpt-5-mini", 1000, 500)
    s = cost_tracker.summary()
    assert "total_usd" in s
    assert "total_gbp" in s
    assert "calls" in s
    assert "by_model" in s
    assert "gpt-5-mini" in s["by_model"]
