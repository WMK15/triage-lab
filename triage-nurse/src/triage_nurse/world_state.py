"""Pydantic dataclasses for the world. Pure data — no behavior here.

Owned by sub-agent A. Field names locked in Phase 1 before sub-agents spawn;
the shapes below are placeholders that the smoke test depends on.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Persona = Literal["stoic", "anxious", "minimizing", "confused"]
NarrativeRole = Literal[
    "routine", "silent_deterioration", "social_complication", "crisis"
]
Severity = Literal["low", "moderate", "high", "critical"]


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
    name: str
    age: int
    sex: Literal["F", "M"]
    presenting_complaint: str
    vitals: Vitals
    history: str
    persona: Persona
    true_diagnosis: str
    icd10: str
    trajectory: list[TrajectoryStep]
    confirmatory_tests: list[str]
    red_herrings: list[str] = Field(default_factory=list)
    narrative_role: NarrativeRole
    arrived_at_min: int = 0


class Nurse(BaseModel):
    id: str
    name: str
    fatigue: float = 0.0
    relationship: float = 0.5  # 0..1; degraded by being talked over


class Consultant(BaseModel):
    id: str
    specialty: Literal["cardiology", "neurology", "surgery", "psych", "pediatrics"]
    name: str
    cooperation: float = 1.0  # 0..1; degraded by reflexive early calls
    available: bool = True


class FamilyMember(BaseModel):
    patient_id: str
    relation: str
    distress: float = 0.3


class Event(BaseModel):
    fires_at_min: int
    kind: str
    patient_id: str | None = None
    payload: dict = Field(default_factory=dict)


class EventQueue(BaseModel):
    """Ordered by fires_at_min; pop() returns the next due event."""

    events: list[Event] = Field(default_factory=list)


class WorldState(BaseModel):
    sim_time_min: int = 0
    patients: dict[str, Patient] = Field(default_factory=dict)
    nurses: dict[str, Nurse] = Field(default_factory=dict)
    consultants: dict[str, Consultant] = Field(default_factory=dict)
    families: dict[str, FamilyMember] = Field(default_factory=dict)
    event_queue: EventQueue = Field(default_factory=EventQueue)
    seed: int = 0
