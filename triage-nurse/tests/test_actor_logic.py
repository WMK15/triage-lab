"""Tests for actor_logic — rule-based replies and state mutations for the
nurse, consultant, and family member actors."""
from __future__ import annotations

from triage_nurse.actor_logic import (
    consultant_call,
    family_respond,
    nurse_speak,
)
from triage_nurse.world_state import Consultant, FamilyMember, Nurse

# --- Nurse tests -----------------------------------------------------------


def test_nurse_brusque_degrades_relationship() -> None:
    nurse = Nurse(id="n1", name="Sam", relationship=0.5)
    _, updated = nurse_speak(nurse, "DO IT NOW!")
    assert updated.relationship < 0.5
    # Fatigue accrues on every call.
    assert updated.fatigue > nurse.fatigue


def test_nurse_polite_preserves() -> None:
    nurse = Nurse(id="n1", name="Sam", relationship=0.5)
    _, updated = nurse_speak(nurse, "please could you help with this?")
    assert updated.relationship >= nurse.relationship


def test_nurse_neutral_holds_relationship() -> None:
    nurse = Nurse(id="n1", name="Sam", relationship=0.5)
    _, updated = nurse_speak(nurse, "Patient in bay 3 needs an ECG.")
    assert updated.relationship == nurse.relationship


def test_nurse_reply_tone_bands() -> None:
    coop = Nurse(id="n1", name="Sam", relationship=0.8)
    pro = Nurse(id="n1", name="Sam", relationship=0.45)
    terse = Nurse(id="n1", name="Sam", relationship=0.1)
    coop_reply, _ = nurse_speak(coop, "Patient ready?")
    pro_reply, _ = nurse_speak(pro, "Patient ready?")
    terse_reply, _ = nurse_speak(terse, "Patient ready?")
    assert "on it" in coop_reply.lower()
    assert pro_reply == "OK."
    assert terse_reply == "Right."


def test_nurse_fatigue_clamped() -> None:
    nurse = Nurse(id="n1", name="Sam", fatigue=0.99)
    _, updated = nurse_speak(nurse, "anything")
    assert updated.fatigue <= 1.0


# --- Consultant tests -----------------------------------------------------


def test_consultant_early_call_burns_cooperation() -> None:
    early = Consultant(
        id="c1", specialty="cardiology", name="Dr Patel", cooperation=1.0
    )
    late = Consultant(
        id="c1", specialty="cardiology", name="Dr Patel", cooperation=1.0
    )
    _, after_early = consultant_call(early, "ECG concern", sim_time_min=10)
    _, after_late = consultant_call(late, "ECG concern", sim_time_min=180)
    assert after_early.cooperation < after_late.cooperation


def test_consultant_unavailable_when_cooperation_zero() -> None:
    consultant = Consultant(
        id="c1", specialty="surgery", name="Dr Khan", cooperation=0.12
    )
    # An early call drains 0.15 → cooperation drops to ~-0.03 → clamped to 0
    # and the consultant flips to unavailable.
    reply, updated = consultant_call(consultant, "abdomen", sim_time_min=5)
    assert updated.available is False
    assert reply == "Consultant unavailable."


def test_consultant_already_unavailable_short_circuits() -> None:
    consultant = Consultant(
        id="c1",
        specialty="neurology",
        name="Dr Chen",
        cooperation=0.4,
        available=False,
    )
    reply, updated = consultant_call(consultant, "stroke?", sim_time_min=200)
    assert reply == "Consultant unavailable."
    # Don't keep degrading state once they've already gone dark.
    assert updated.cooperation == consultant.cooperation


def test_consultant_engaged_then_curt_then_decline() -> None:
    high = Consultant(
        id="c1", specialty="cardiology", name="Dr Patel", cooperation=0.9
    )
    mid = Consultant(
        id="c1", specialty="cardiology", name="Dr Patel", cooperation=0.4
    )
    low = Consultant(
        id="c1", specialty="cardiology", name="Dr Patel", cooperation=0.22
    )
    high_reply, _ = consultant_call(high, "case", sim_time_min=200)
    mid_reply, _ = consultant_call(mid, "case", sim_time_min=200)
    low_reply, _ = consultant_call(low, "case", sim_time_min=200)
    assert "what's the case" in high_reply.lower()
    assert mid_reply == "What is it?"
    assert "on-call senior" in low_reply.lower()


# --- Family tests ---------------------------------------------------------


def test_family_distress_escalates_on_delay() -> None:
    family = FamilyMember(patient_id="p1", relation="daughter", distress=0.3)
    state = family
    angry_seen = False
    for _ in range(8):
        reply, state = family_respond(state, "we'll get to you later")
        if "unacceptable" in reply.lower():
            angry_seen = True
            break
    assert angry_seen, f"expected angry escalation, ended at distress={state.distress}"


def test_family_calm_on_explanation() -> None:
    family = FamilyMember(patient_id="p1", relation="son", distress=0.6)
    _, updated = family_respond(family, "let me explain what we're doing for your dad")
    assert updated.distress < family.distress


def test_family_demands_attending_when_extreme() -> None:
    family = FamilyMember(patient_id="p1", relation="wife", distress=0.95)
    reply, _ = family_respond(family, "thanks for waiting")  # 'wait' bumps distress further
    assert "in charge" in reply.lower()


def test_family_calm_band_default() -> None:
    family = FamilyMember(patient_id="p1", relation="brother", distress=0.2)
    reply, updated = family_respond(family, "the doctor will see them shortly")
    assert reply == "Thank you."
    # Distress is clamped to [0,1] regardless of nudge direction.
    assert 0.0 <= updated.distress <= 1.0
