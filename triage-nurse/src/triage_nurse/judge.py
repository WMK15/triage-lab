"""Single end-of-episode LLM judge.

Owned by sub-agent D. Reads a rolling SUMMARY built incrementally during the
episode (one line per tool call), NOT the full message history — long-horizon
trajectories don't fit a context window. Returns dimensional rubric scores.
"""
from __future__ import annotations


async def judge(
    summary: list[str], outcomes: dict, model: str = "gpt-5-mini"
) -> dict[str, float]:
    """Return dimensional scores: defensibility, communication,
    relationship_management, handoff_quality. Each is 0..1."""
    raise NotImplementedError
