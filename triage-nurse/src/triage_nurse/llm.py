"""Thin wrappers around the OpenAI and Anthropic SDKs that record cost on every
call. Also exposes a tool-format translator: OpenReward returns Responses-API
shape (`{type, name, description, parameters}`); the Chat Completions endpoint
wants `{type, function: {...}}`.

Verified against openai==2.32.0 and openreward==0.1.106 on 2026-04-25.
"""
from __future__ import annotations

from typing import Any

from . import cost_tracker
from .config import settings


def _to_chat_completions_tools(tools: list[dict]) -> list[dict]:
    """Translate OpenReward's `format='openai'` tool defs (Responses-API shape)
    into Chat Completions shape. Idempotent — already-CC tools pass through."""
    out: list[dict] = []
    for t in tools:
        if "function" in t:
            out.append(t)
        else:
            out.append(
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t.get("description", ""),
                        "parameters": t.get("parameters", {}),
                    },
                }
            )
    return out


def openai_chat(
    *,
    model: str | None = None,
    messages: list[dict],
    tools: list[dict] | None = None,
    tool_choice: str = "auto",
) -> Any:
    """Chat Completions call with cost tracking. `tools` may be in either
    Responses-API shape or Chat Completions shape — translated as needed."""
    from openai import OpenAI

    client = OpenAI()
    model = model or settings.AGENT_MODEL
    kwargs: dict[str, Any] = {"model": model, "messages": messages}
    if tools:
        kwargs["tools"] = _to_chat_completions_tools(tools)
        kwargs["tool_choice"] = tool_choice
    resp = client.chat.completions.create(**kwargs)
    if resp.usage:
        cost_tracker.record(
            "openai",
            model,
            resp.usage.prompt_tokens,
            resp.usage.completion_tokens,
        )
    return resp


def anthropic_chat(
    *,
    model: str | None = None,
    system: str | None = None,
    messages: list[dict],
    tools: list[dict] | None = None,
    max_tokens: int = 4096,
) -> Any:
    """Anthropic Messages call with cost tracking and prompt caching when a
    system prompt is provided."""
    import anthropic

    client = anthropic.Anthropic()
    model = model or settings.AGENT_MODEL
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
    }
    if system:
        # Cache the system prompt — long, stable, expensive to re-tokenize.
        kwargs["system"] = [
            {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}
        ]
    if tools:
        kwargs["tools"] = tools
    resp = client.messages.create(**kwargs)
    if resp.usage:
        cost_tracker.record(
            "anthropic",
            model,
            resp.usage.input_tokens,
            resp.usage.output_tokens,
        )
    return resp
