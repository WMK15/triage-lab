"""Pure functions that evolve patient state over time.

Owned by sub-agent A. Deterministic given seed. NO LLM calls, NO Environment
instance — just data in, data out, called from inside @tool methods on
TriageEnv.
"""
from __future__ import annotations

from .world_state import Patient


def advance(patient: Patient, dt_min: int, seed: int) -> Patient:
    """Advance a patient's state by `dt_min` minutes of simulated time.

    Reads the patient's `trajectory` to determine the new vitals/state;
    returns a NEW Patient object (immutable update).
    """
    raise NotImplementedError


def severity_at(patient: Patient, sim_time_min: int) -> str:
    """Return the qualitative severity at the given sim time."""
    raise NotImplementedError


def required_interventions_due(
    patient: Patient, sim_time_min: int
) -> list[str]:
    """Interventions that, if not done by now, accrue adverse-event penalty."""
    raise NotImplementedError
