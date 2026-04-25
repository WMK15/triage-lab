"""Deterministic scoring of an episode's outcomes.

Owned by sub-agent D. Pure function — reads world state at end of episode plus
the tool-call summary, returns a structured breakdown. The judge (separate
LLM call) contributes the practice-quality dimensions; this module only does
the hard outcomes (survival, diagnostic accuracy, time-to-disposition,
adverse events, resource appropriateness).
"""
from __future__ import annotations

from pydantic import BaseModel

from .world_state import WorldState


class HardOutcomes(BaseModel):
    survival_rate: float
    diagnostic_accuracy: float
    avg_time_to_disposition_min: float
    adverse_events: int
    resource_appropriateness: float


class ScoreBreakdown(BaseModel):
    hard: HardOutcomes
    composite: float  # 0..1; 70% hard + 30% judge if judge is available


def score_episode(state: WorldState, summary: list[str]) -> ScoreBreakdown:
    raise NotImplementedError
