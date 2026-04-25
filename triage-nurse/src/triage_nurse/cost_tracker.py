"""Shared cost cap: the same tracker is used by env-side LLM calls (actor
dialogue, judge) and harness-side LLM calls (agent decisions). When cumulative
spend crosses the cap, the next attempted record raises CostCapExceeded.

The cap value comes from settings (£2 default); GBP→USD uses a fixed
conservative rate so the cap fires slightly early relative to the live FX.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from threading import Lock

from .config import settings

USD_PER_GBP = 1.27  # conservative — caps fire a touch early when GBP weakens

# (input_per_token_usd, output_per_token_usd). Order: cheapest first.
PRICE_TABLE: dict[str, tuple[float, float]] = {
    "gpt-5-mini": (0.25e-6, 2.00e-6),
    "gpt-5": (1.25e-6, 10.00e-6),
    "gpt-4o-mini": (0.15e-6, 0.60e-6),
    "gpt-4o": (2.50e-6, 10.00e-6),
    "claude-haiku-4-5": (1.00e-6, 5.00e-6),
    "claude-sonnet-4-6": (3.00e-6, 15.00e-6),
    "claude-opus-4-7": (15.00e-6, 75.00e-6),
}

DEFAULT_PRICE = (5.00e-6, 20.00e-6)  # used when a model isn't in the table

logger = logging.getLogger(__name__)


class CostCapExceeded(RuntimeError):
    pass


@dataclass
class _Entry:
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    usd: float


@dataclass
class _Tracker:
    entries: list[_Entry] = field(default_factory=list)
    lock: Lock = field(default_factory=Lock)

    def record(
        self, provider: str, model: str, input_tokens: int, output_tokens: int
    ) -> None:
        price = PRICE_TABLE.get(model)
        if price is None:
            logger.warning(
                "no price table entry for model=%s; using conservative default", model
            )
            price = DEFAULT_PRICE
        usd = input_tokens * price[0] + output_tokens * price[1]
        with self.lock:
            self.entries.append(
                _Entry(provider, model, input_tokens, output_tokens, usd)
            )
            total_usd = sum(e.usd for e in self.entries)
        cap_usd = settings.MAX_EPISODE_GBP * USD_PER_GBP
        if total_usd > cap_usd:
            raise CostCapExceeded(
                f"cumulative cost ${total_usd:.4f} exceeded cap "
                f"${cap_usd:.2f} (~£{settings.MAX_EPISODE_GBP:.2f})"
            )

    def total_usd(self) -> float:
        with self.lock:
            return sum(e.usd for e in self.entries)

    def total_gbp(self) -> float:
        return self.total_usd() / USD_PER_GBP

    def reset(self) -> None:
        with self.lock:
            self.entries.clear()

    def summary(self) -> dict:
        with self.lock:
            by_model: dict[str, dict[str, float]] = {}
            for e in self.entries:
                bucket = by_model.setdefault(
                    e.model, {"calls": 0, "input": 0, "output": 0, "usd": 0.0}
                )
                bucket["calls"] += 1
                bucket["input"] += e.input_tokens
                bucket["output"] += e.output_tokens
                bucket["usd"] += e.usd
            return {
                "total_usd": sum(e.usd for e in self.entries),
                "total_gbp": sum(e.usd for e in self.entries) / USD_PER_GBP,
                "calls": len(self.entries),
                "by_model": by_model,
            }


_tracker = _Tracker()


def record(
    provider: str, model: str, input_tokens: int, output_tokens: int
) -> None:
    _tracker.record(provider, model, input_tokens, output_tokens)


def total_usd() -> float:
    return _tracker.total_usd()


def total_gbp() -> float:
    return _tracker.total_gbp()


def reset() -> None:
    _tracker.reset()


def summary() -> dict:
    return _tracker.summary()
