"""Pure functions that evolve patient state over time.

Owned by sub-agent A. Deterministic given seed. NO LLM calls, NO Environment
instance — just data in, data out, called from inside @tool methods on
TriageEnv.
"""
from __future__ import annotations

import hashlib

from .world_state import Patient, Vitals

# Keywords scanned in a TrajectoryStep.state to bias vitals drift.
_HR_UP_HINTS = ("hr ", "tachy", "diaphor", "pale", "distress", "pain")
_HR_DOWN_HINTS = ("brady",)
_SBP_DOWN_HINTS = ("hypoten", "shock", "pale", "diaphor")
_SBP_UP_HINTS = ("hypertens",)
_RR_UP_HINTS = ("tachypn", "short of breath", "shortness", "respir", "dyspn")
_SPO2_DOWN_HINTS = ("hypox", "desat", "cyanos")


def _det_drift(seed: int, step_index: int, patient_id: str, salt: str, span: int) -> int:
    """Deterministic small integer in [-span, span] from (seed, step, id, salt)."""
    if span <= 0:
        return 0
    key = f"{seed}|{step_index}|{patient_id}|{salt}".encode()
    digest = hashlib.sha256(key).digest()
    # Use first 4 bytes as an unsigned int, then map into [-span, span].
    val = int.from_bytes(digest[:4], "big")
    return (val % (2 * span + 1)) - span


def _select_step_index(patient: Patient, target_offset: int) -> int:
    """Largest index whose time_offset_min <= target_offset; clamps to last step
    if target exceeds the trajectory; clamps to 0 if target is before the
    first step."""
    traj = patient.trajectory
    if not traj:
        return -1
    idx = 0
    for i, step in enumerate(traj):
        if step.time_offset_min <= target_offset:
            idx = i
        else:
            break
    return idx


def _state_text_lower(text: str) -> str:
    return text.lower()


def advance(patient: Patient, dt_min: int, seed: int) -> Patient:
    """Advance a patient's state by `dt_min` minutes of simulated time.

    `dt_min` is interpreted as the cumulative elapsed time since the patient
    arrived (i.e. the target trajectory offset). Picks the trajectory step
    whose `time_offset_min` is closest to `dt_min` but not greater. If the
    target exceeds the last step's offset, freezes at the last step.

    Vitals shift via small deterministic drift derived from
    (seed, step_index, patient.id), with the direction biased by keywords in
    the chosen step's `state` text. Returns a NEW Patient (immutable update).
    """
    if not patient.trajectory:
        return patient.model_copy()

    step_idx = _select_step_index(patient, dt_min)
    step = patient.trajectory[step_idx]
    text = _state_text_lower(step.state)

    # Direction biases from keywords; default 0 if no hints match.
    hr_dir = 0
    if any(h in text for h in _HR_UP_HINTS):
        hr_dir += 1
    if any(h in text for h in _HR_DOWN_HINTS):
        hr_dir -= 1

    sbp_dir = 0
    if any(h in text for h in _SBP_DOWN_HINTS):
        sbp_dir -= 1
    if any(h in text for h in _SBP_UP_HINTS):
        sbp_dir += 1

    rr_dir = 1 if any(h in text for h in _RR_UP_HINTS) else 0
    spo2_dir = -1 if any(h in text for h in _SPO2_DOWN_HINTS) else 0

    # Magnitudes: small per-step drift, deterministic per (seed, step_idx, id).
    hr_jitter = _det_drift(seed, step_idx, patient.id, "hr", 3)
    sbp_jitter = _det_drift(seed, step_idx, patient.id, "sbp", 4)
    rr_jitter = _det_drift(seed, step_idx, patient.id, "rr", 1)

    new_hr = patient.vitals.hr + hr_dir * 6 + hr_jitter
    new_sbp = patient.vitals.sbp + sbp_dir * 6 + sbp_jitter
    new_rr = patient.vitals.rr + rr_dir * 2 + rr_jitter
    new_spo2 = patient.vitals.spo2 + spo2_dir * 2

    # Clamp to physiologically plausible bounds.
    new_hr = max(20, min(220, new_hr))
    new_sbp = max(40, min(260, new_sbp))
    new_dbp = max(20, min(160, patient.vitals.dbp))
    new_rr = max(4, min(60, new_rr))
    new_spo2 = max(50, min(100, new_spo2))

    new_vitals = Vitals(
        hr=new_hr,
        sbp=new_sbp,
        dbp=new_dbp,
        rr=new_rr,
        spo2=new_spo2,
        temp_c=patient.vitals.temp_c,
    )
    return patient.model_copy(update={"vitals": new_vitals})


def severity_at(patient: Patient, sim_time_min: int) -> str:
    """Return the qualitative severity at the given sim time.

    Buckets:
      'critical'      — HR>120 OR SBP<90 OR SpO2<90
      'deteriorating' — current trajectory step requires intervention
      'concerning'    — HR>100 OR SBP<100
      'stable'        — otherwise
    """
    v = patient.vitals
    if v.hr > 120 or v.sbp < 90 or v.spo2 < 90:
        return "critical"

    target_offset = sim_time_min - patient.arrived_at_min
    step_idx = _select_step_index(patient, target_offset)
    if step_idx >= 0 and patient.trajectory[step_idx].requires_intervention:
        return "deteriorating"

    if v.hr > 100 or v.sbp < 100:
        return "concerning"

    return "stable"


def required_interventions_due(
    patient: Patient, sim_time_min: int
) -> list[str]:
    """Interventions that, if not done by now, accrue adverse-event penalty.

    Returns the `state` strings of trajectory steps whose
    `requires_intervention` is True AND whose `time_offset_min` (relative to
    `arrived_at_min`) is at or before `sim_time_min`.
    """
    target_offset = sim_time_min - patient.arrived_at_min
    return [
        step.state
        for step in patient.trajectory
        if step.requires_intervention and step.time_offset_min <= target_offset
    ]
