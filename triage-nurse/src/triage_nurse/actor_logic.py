"""Rule-based responses for nurses, consultants, and families.

Owned by sub-agent B. Default to templated outputs; LLM enrichment is opt-in
via an injected callable so this module stays unit-testable without LLMs.
"""
from __future__ import annotations

from collections.abc import Callable

from .world_state import Consultant, FamilyMember, Nurse

# --- Lexicons --------------------------------------------------------------

_BRUSQUE_TOKENS = ("now", "immediately", "hurry")
_POLITE_TOKENS = ("please", "thank", "could you")
_DELAY_TOKENS = ("wait", "later", "delay", "soon")
_EXPLAIN_TOKENS = ("explain", "tell you", "update", "your")


def _clamp(value: float) -> float:
    """Clamp a float to the [0.0, 1.0] band."""
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def _is_brusque(utterance: str) -> bool:
    """A message is brusque if it shouts (mostly CAPS), uses '!', or contains
    an imperative urgency token."""
    if not utterance:
        return False
    lowered = utterance.lower()
    if any(token in lowered for token in _BRUSQUE_TOKENS):
        return True
    if "!" in utterance:
        return True
    # CAPS heuristic: at least 4 letters and the majority are uppercase.
    letters = [c for c in utterance if c.isalpha()]
    if len(letters) >= 4:
        upper = sum(1 for c in letters if c.isupper())
        if upper / len(letters) >= 0.6:
            return True
    return False


def _is_polite(utterance: str) -> bool:
    lowered = utterance.lower()
    return any(token in lowered for token in _POLITE_TOKENS)


# --- Public API ------------------------------------------------------------


def nurse_speak(
    nurse: Nurse, utterance: str, llm: Callable[[str], str] | None = None
) -> tuple[str, Nurse]:
    """Return a templated reply varying by the nurse's relationship band, plus
    the mutated nurse (model_copy with relationship/fatigue updated).

    Tone heuristics adjust ``relationship``; every call adds 0.02 fatigue.
    The ``llm`` hook is reserved for future prose enrichment and is unused.
    """
    del llm  # reserved for future enrichment

    relationship = nurse.relationship
    if _is_brusque(utterance):
        relationship -= 0.05
    elif _is_polite(utterance):
        relationship += 0.02
    relationship = _clamp(relationship)

    fatigue = _clamp(nurse.fatigue + 0.02)

    new_nurse = nurse.model_copy(
        update={"relationship": relationship, "fatigue": fatigue}
    )

    if relationship >= 0.6:
        reply = "Sure, on it. I'll grab the chart and let you know what I see."
    elif relationship >= 0.3:
        reply = "OK."
    else:
        reply = "Right."

    return reply, new_nurse


def consultant_call(
    consultant: Consultant,
    request: str,
    sim_time_min: int,
    llm: Callable[[str], str] | None = None,
) -> tuple[str, Consultant]:
    """Templated consultant reply. Cooperation degrades on every call, more
    so when the call fires early in the shift (< 60 min). Below 0.1
    cooperation the consultant flips to ``available=False``.
    """
    del request, llm  # reserved for future enrichment

    if not consultant.available:
        return "Consultant unavailable.", consultant

    cooperation = consultant.cooperation - 0.05
    if sim_time_min < 60:
        cooperation -= 0.10
    cooperation = _clamp(cooperation)

    available = consultant.available and cooperation >= 0.1

    new_consultant = consultant.model_copy(
        update={"cooperation": cooperation, "available": available}
    )

    if not available:
        reply = "Consultant unavailable."
    elif cooperation >= 0.5:
        reply = "Right, what's the case?"
    elif cooperation >= 0.2:
        reply = "What is it?"
    else:
        reply = "I'm slammed — get the on-call senior."

    return reply, new_consultant


def family_respond(
    family: FamilyMember,
    situation: str,
    llm: Callable[[str], str] | None = None,
) -> tuple[str, FamilyMember]:
    """Templated family reply. Words that imply delay raise distress;
    explanatory language lowers it. Reply tone steps from calm → worried →
    angry → demanding-the-attending as distress climbs.
    """
    del llm  # reserved for future enrichment

    lowered = situation.lower()
    distress = family.distress
    if any(token in lowered for token in _DELAY_TOKENS):
        distress += 0.10
    if any(token in lowered for token in _EXPLAIN_TOKENS):
        distress -= 0.05
    distress = _clamp(distress)

    new_family = family.model_copy(update={"distress": distress})

    if distress < 0.4:
        reply = "Thank you."
    elif distress < 0.7:
        reply = "Please, can someone help?"
    elif distress < 0.9:
        reply = "This is unacceptable."
    else:
        reply = "I want to speak to whoever is in charge. Now."

    return reply, new_family
