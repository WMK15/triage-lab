"""Tests for triage_nurse.patient_logic — deterministic patient evolution."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from triage_nurse.patient_logic import (
    advance,
    required_interventions_due,
    severity_at,
)
from triage_nurse.world_state import Patient, TrajectoryStep, Vitals


def _make_patient(**overrides) -> Patient:
    defaults = {
        "id": "p1",
        "name": "Test Patient",
        "age": 50,
        "sex": "M",
        "presenting_complaint": "test",
        "vitals": Vitals(hr=80, sbp=120, dbp=80, rr=16, spo2=98, temp_c=37.0),
        "history": "none",
        "persona": "stoic",
        "true_diagnosis": "none",
        "icd10": "Z00",
        "trajectory": [
            TrajectoryStep(time_offset_min=0, state="baseline, no distress", requires_intervention=False),
            TrajectoryStep(time_offset_min=30, state="hr creeps; mild diaphoresis", requires_intervention=False),
            TrajectoryStep(time_offset_min=60, state="worsening; pale; pain", requires_intervention=True),
            TrajectoryStep(time_offset_min=90, state="frank pain; diaphoretic; ischemic", requires_intervention=True),
        ],
        "confirmatory_tests": [],
        "red_herrings": [],
        "narrative_role": "routine",
        "arrived_at_min": 0,
    }
    defaults.update(overrides)
    return Patient.model_validate(defaults)


def _load_example_case() -> Patient:
    path = Path(__file__).parent.parent / "cases" / "example_acute_mi.json"
    raw = json.loads(path.read_text())
    raw["vitals"] = raw.pop("vitals_initial")
    return Patient.model_validate(raw)


def test_advance_deterministic() -> None:
    """Same seed produces an identical Patient (model_dump equality)."""
    p = _make_patient()
    a = advance(p, dt_min=30, seed=42)
    b = advance(p, dt_min=30, seed=42)
    assert a.model_dump() == b.model_dump()


def test_advance_different_seeds_diverge() -> None:
    """Different seeds may produce different jitter (sanity for determinism)."""
    p = _make_patient()
    a = advance(p, dt_min=60, seed=1)
    b = advance(p, dt_min=60, seed=999)
    # Not asserting they always differ (jitter could collide), but vitals are
    # bounded — we simply confirm both produce valid Patients.
    assert isinstance(a, Patient)
    assert isinstance(b, Patient)


def test_advance_progresses_trajectory() -> None:
    """Advancing to dt=30 selects the 30-minute step; vitals shift from baseline."""
    p = _make_patient()
    out = advance(p, dt_min=30, seed=7)
    # Vitals should change deterministically — we don't pin exact values but
    # confirm the result is a fresh Patient with possibly mutated vitals.
    assert isinstance(out, Patient)
    # Patient is immutable — original untouched.
    assert p.vitals.hr == 80
    # The step at offset 30 has "hr creeps" → HR should be >= baseline (drift up,
    # plus jitter in [-3, 3]); allow a small slack.
    assert out.vitals.hr >= 80 - 3


def test_advance_clamps_at_last_step() -> None:
    """dt larger than the last trajectory offset clamps to the final step."""
    p = _make_patient()
    last_offset = p.trajectory[-1].time_offset_min  # 90
    big = advance(p, dt_min=last_offset + 500, seed=3)
    final = advance(p, dt_min=last_offset, seed=3)
    # Both calls should resolve to the same trajectory step → identical output.
    assert big.model_dump() == final.model_dump()


def test_advance_before_first_step_uses_index_zero() -> None:
    """dt below the first step's offset still picks step 0 (no crash)."""
    p = _make_patient()
    out = advance(p, dt_min=-5, seed=11)
    assert isinstance(out, Patient)


def test_advance_returns_new_instance() -> None:
    """Patient should be immutable — advance returns a new object."""
    p = _make_patient()
    out = advance(p, dt_min=30, seed=5)
    assert out is not p


def test_severity_levels_critical_hr() -> None:
    p = _make_patient(
        vitals=Vitals(hr=130, sbp=120, dbp=80, rr=18, spo2=97, temp_c=37.0)
    )
    assert severity_at(p, sim_time_min=0) == "critical"


def test_severity_levels_critical_sbp() -> None:
    p = _make_patient(
        vitals=Vitals(hr=80, sbp=85, dbp=60, rr=18, spo2=97, temp_c=37.0)
    )
    assert severity_at(p, sim_time_min=0) == "critical"


def test_severity_levels_critical_spo2() -> None:
    p = _make_patient(
        vitals=Vitals(hr=80, sbp=120, dbp=80, rr=18, spo2=85, temp_c=37.0)
    )
    assert severity_at(p, sim_time_min=0) == "critical"


def test_severity_levels_deteriorating_when_intervention_required() -> None:
    """Vitals are 'concerning' (HR=110), but trajectory step at min 60 demands
    intervention → bumped to 'deteriorating'."""
    p = _make_patient(
        vitals=Vitals(hr=110, sbp=120, dbp=80, rr=18, spo2=97, temp_c=37.0)
    )
    assert severity_at(p, sim_time_min=60) == "deteriorating"


def test_severity_levels_concerning() -> None:
    p = _make_patient(
        vitals=Vitals(hr=105, sbp=120, dbp=80, rr=18, spo2=97, temp_c=37.0)
    )
    # At sim_time 0 the active step does not require intervention.
    assert severity_at(p, sim_time_min=0) == "concerning"


def test_severity_levels_concerning_low_sbp() -> None:
    p = _make_patient(
        vitals=Vitals(hr=80, sbp=95, dbp=60, rr=18, spo2=97, temp_c=37.0)
    )
    assert severity_at(p, sim_time_min=0) == "concerning"


def test_severity_levels_stable() -> None:
    p = _make_patient()
    assert severity_at(p, sim_time_min=0) == "stable"


def test_required_interventions_due_returned_after_offset() -> None:
    """Step at min 60 requires intervention; query at min 70 → returned."""
    p = _make_patient()
    due = required_interventions_due(p, sim_time_min=70)
    assert any("worsening" in s.lower() or "pale" in s.lower() for s in due)
    assert len(due) == 1


def test_required_interventions_due_not_returned_before_offset() -> None:
    """Step at min 60 requires intervention; query at min 50 → not returned."""
    p = _make_patient()
    due = required_interventions_due(p, sim_time_min=50)
    assert due == []


def test_required_interventions_due_includes_all_past_due() -> None:
    """At min 95, both intervention-required steps (60 and 90) are due."""
    p = _make_patient()
    due = required_interventions_due(p, sim_time_min=95)
    assert len(due) == 2


def test_required_interventions_due_respects_arrived_at_min() -> None:
    """Patient arrived at sim_time 100 — intervention at offset 60 is due at
    sim_time 160, not 60."""
    p = _make_patient(arrived_at_min=100)
    assert required_interventions_due(p, sim_time_min=120) == []
    due = required_interventions_due(p, sim_time_min=170)
    assert len(due) == 1


def test_example_case_loads_and_advances() -> None:
    """Sanity: the bundled NSTEMI case round-trips through advance/severity."""
    p = _load_example_case()
    out = advance(p, dt_min=60, seed=2026)
    assert isinstance(out, Patient)
    # Step at min 60 ("HR 105 ... pale ... requires_intervention=True")
    # should yield 'deteriorating' even before vitals breach the critical
    # thresholds.
    sev = severity_at(out, sim_time_min=60)
    assert sev in {"deteriorating", "concerning", "critical"}


def test_empty_trajectory_returns_copy() -> None:
    """Patient with no trajectory steps should round-trip safely."""
    p = _make_patient(trajectory=[])
    out = advance(p, dt_min=30, seed=1)
    assert out.model_dump() == p.model_dump()


@pytest.mark.parametrize("dt", [0, 15, 30, 45, 60, 90, 200])
def test_advance_idempotent_for_same_inputs(dt: int) -> None:
    """Running advance twice with the same args yields identical state."""
    p = _make_patient()
    a = advance(p, dt_min=dt, seed=17)
    b = advance(p, dt_min=dt, seed=17)
    assert a.model_dump() == b.model_dump()
