"""Single end-of-episode LLM judge.

Owned by sub-agent D. Reads a rolling SUMMARY built incrementally during the
episode (one line per tool call), NOT the full message history — long-horizon
trajectories don't fit a context window. Returns dimensional rubric scores.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from . import llm

logger = logging.getLogger(__name__)

# Last N summary lines to include — keeps prompt short, captures the closing
# decisions which are the load-bearing part for the rubric.
_SUMMARY_TAIL_LINES = 200

_DIMENSIONS = (
    "defensibility",
    "communication",
    "relationship_management",
    "handoff_quality",
)

JUDGE_RUBRIC = """You are an attending physician reviewing an ED resident's shift.
Read the SUMMARY (one line per action the resident took) and the OUTCOMES.
Score four dimensions, each 0.0-1.0 (1.0 = textbook excellent, 0.0 = unsafe).

DIMENSIONS:
- defensibility: Were decisions defensible by current ED standards? Did the resident gather sufficient evidence before committing?
- communication: Clear, professional speech with nurses, consultants, families? Avoided abrupt or dismissive tone?
- relationship_management: Used consultant time wisely (not reflexive)? Maintained nurse rapport? De-escalated family distress?
- handoff_quality: Final dispositions clear and complete? Patients with deferred-info dependencies properly tracked?

Return ONLY a JSON object: {"defensibility": 0.85, "communication": 0.7, ...}"""


def _fallback_scores() -> dict[str, float]:
    """All-0.5 neutral scores returned on any parse failure."""
    return {dim: 0.5 for dim in _DIMENSIONS}


def _extract_json_object(text: str) -> dict[str, Any] | None:
    """Pull the first JSON object out of a string. Tolerates fences / prose.

    LLMs sometimes wrap JSON in ``` fences or prose; this finds the first
    balanced brace pair and tries to load it.
    """
    if not text:
        return None
    # Strip code fences if present.
    fence_match = re.search(r"```(?:json)?\s*(.+?)\s*```", text, re.DOTALL)
    if fence_match:
        candidate = fence_match.group(1)
    else:
        candidate = text
    # Find first { ... } balanced span.
    start = candidate.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(candidate)):
        ch = candidate[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                blob = candidate[start : i + 1]
                try:
                    obj = json.loads(blob)
                    return obj if isinstance(obj, dict) else None
                except json.JSONDecodeError:
                    return None
    return None


def _coerce_scores(raw: dict[str, Any]) -> dict[str, float]:
    """Pull and clamp the four dimensions out of a parsed JSON object.

    Missing dimensions default to 0.5. Values outside [0, 1] are clamped.
    """
    out: dict[str, float] = {}
    for dim in _DIMENSIONS:
        v = raw.get(dim, 0.5)
        try:
            f = float(v)
        except (TypeError, ValueError):
            f = 0.5
        if f < 0.0:
            f = 0.0
        elif f > 1.0:
            f = 1.0
        out[dim] = f
    return out


def _build_messages(summary: list[str], outcomes: dict) -> list[dict]:
    tail = summary[-_SUMMARY_TAIL_LINES:] if summary else []
    summary_block = "\n".join(tail) if tail else "(no actions recorded)"
    try:
        outcomes_block = json.dumps(outcomes, indent=2, default=str)
    except (TypeError, ValueError):
        outcomes_block = str(outcomes)
    user = (
        "SUMMARY (last actions, one per line):\n"
        f"{summary_block}\n\n"
        "OUTCOMES (per-patient final state):\n"
        f"{outcomes_block}\n\n"
        "Return ONLY the JSON object as specified."
    )
    return [
        {"role": "system", "content": JUDGE_RUBRIC},
        {"role": "user", "content": user},
    ]


def _extract_text(resp: Any) -> str:
    """Best-effort text extraction from an OpenAI Chat Completions response."""
    try:
        return resp.choices[0].message.content or ""
    except (AttributeError, IndexError, TypeError):
        return ""


async def judge(
    summary: list[str], outcomes: dict, model: str = "gpt-5-mini"
) -> dict[str, float]:
    """Return dimensional scores: defensibility, communication,
    relationship_management, handoff_quality. Each is 0..1.

    Calls the sync `llm.openai_chat` wrapper via `asyncio.to_thread` so the
    cost tracker still sees every call. Truncates summary to the last 200
    lines (heuristic) so the prompt stays bounded on long episodes. On any
    parse failure, returns all-0.5 with a warning logged.
    """
    messages = _build_messages(summary, outcomes)
    try:
        resp = await asyncio.to_thread(
            llm.openai_chat, model=model, messages=messages
        )
    except Exception as exc:  # noqa: BLE001 — surface as warning, fall back
        logger.warning("judge llm call failed: %s", exc)
        return _fallback_scores()

    text = _extract_text(resp)
    parsed = _extract_json_object(text)
    if parsed is None:
        logger.warning("judge could not parse JSON from response: %r", text[:200])
        return _fallback_scores()
    return _coerce_scores(parsed)
