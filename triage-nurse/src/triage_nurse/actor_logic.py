"""Rule-based responses for nurses, consultants, and families.

Owned by sub-agent B. Default to templated outputs; LLM enrichment is opt-in
via an injected callable so this module stays unit-testable without LLMs.
"""
from __future__ import annotations

from collections.abc import Callable

from .world_state import Consultant, FamilyMember, Nurse


def nurse_speak(
    nurse: Nurse, utterance: str, llm: Callable[[str], str] | None = None
) -> str:
    """Templated reply by default; if `llm` is provided, may call it for prose
    enrichment when the templated reply would feel too curt."""
    raise NotImplementedError


def consultant_call(
    consultant: Consultant, request: str, llm: Callable[[str], str] | None = None
) -> str:
    """Returns the consultant's reply. Cooperation degrades on reflexive early
    calls; very low cooperation produces refusals."""
    raise NotImplementedError


def family_respond(
    family: FamilyMember,
    situation: str,
    llm: Callable[[str], str] | None = None,
) -> str:
    """Family member reply. Distress drives terseness, hostility, or repeated
    questions."""
    raise NotImplementedError
