"""World state for the triage-batch v2 env.

Strictly less than v1: just patients, vitals, and a small trajectory.
No nurses, no consultants, no families, no event queue. The "world" is the
five patients in the waiting room and the agent's classifications so far.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

KtasLevel = Literal[1, 2, 3, 4, 5]
KtasName = Literal[
    "immediate", "very_urgent", "urgent", "standard", "not_urgent"
]
MentalState = Literal["alert", "verbal", "pain", "unresponsive"]

KTAS_NAMES: dict[int, str] = {
    1: "immediate",
    2: "very_urgent",
    3: "urgent",
    4: "standard",
    5: "not_urgent",
}
KTAS_LEVELS: dict[str, int] = {v: k for k, v in KTAS_NAMES.items()}


class Vitals(BaseModel):
    hr: int
    sbp: int
    dbp: int
    rr: int
    spo2: int
    temp_c: float


class TrajectoryStep(BaseModel):
    time_offset_min: int
    state: str
    requires_intervention: bool


class Patient(BaseModel):
    id: str
    age: int
    sex: Literal["F", "M"]
    chief_complaint: str
    history: str
    mental_state: MentalState
    nrs_pain: int | None
    vitals: Vitals
    trajectory: list[TrajectoryStep]
    ground_truth_ktas: KtasLevel


class WorldState(BaseModel):
    sim_time_min: int = 0
    patients: dict[str, Patient]
    assigned: dict[str, KtasLevel | None] = Field(default_factory=dict)
    charts: dict[str, list[str]] = Field(default_factory=dict)
    seed: int = 0
