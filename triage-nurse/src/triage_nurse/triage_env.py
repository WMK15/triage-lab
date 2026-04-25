"""TriageEnv — the OpenReward Environment subclass.

Owned by sub-agent C (Wave 2 — depends on A/B/D interfaces). All world state
lives on `self`; tools mutate `self.world` and append to `self.summary`. The
seven primitive tools plus `submit_handoff` (the terminator) are stubbed.

API verified against openreward==0.1.106 on 2026-04-25.
"""
from __future__ import annotations

from typing import Literal

from openreward.environments import (
    Environment,
    JSONObject,
    Server,
    Split,
    TextBlock,
    ToolOutput,
    tool,
)
from pydantic import BaseModel

# ---- Tool param schemas ---------------------------------------------------
# Discrete enums use Literal so they propagate as JSON Schema enum constraints
# and the model is forced to obey (verified in the spike).


class SpeakParams(BaseModel):
    actor_id: str
    utterance: str


class ExamineParams(BaseModel):
    patient_id: str


class OrderParams(BaseModel):
    patient_id: str
    test_name: str


class ReadParams(BaseModel):
    patient_id: str


class WriteParams(BaseModel):
    patient_id: str
    note: str


class WaitParams(BaseModel):
    minutes: int


class ReflectParams(BaseModel):
    thought: str


class SubmitHandoffParams(BaseModel):
    patient_id: str
    disposition: Literal[
        "admit", "discharge", "observe", "transfer", "deceased"
    ]
    notes: str


# ---- The Environment class ------------------------------------------------


class TriageEnv(Environment):
    """ED triage simulation env."""

    def __init__(
        self,
        task_spec: JSONObject = {},  # noqa: B006 — OpenReward signature
        secrets: dict[str, str] = {},  # noqa: B006 — OpenReward signature
    ) -> None:
        super().__init__(task_spec)
        # World construction will move to patient_logic + actor_logic in C's
        # implementation. For now: empty placeholders so the class is
        # registrable.
        self.summary: list[str] = []

    @classmethod
    def list_tasks(cls, split: str) -> list[JSONObject]:
        # Sub-agent E provides demo_shift.json; loader lives here.
        raise NotImplementedError

    @classmethod
    def list_splits(cls):
        return [Split(name="test", type="test")]

    def get_prompt(self) -> list[TextBlock]:
        raise NotImplementedError

    @tool
    def speak(self, params: SpeakParams) -> ToolOutput:
        """Address an actor (nurse / consultant / family / charge nurse)."""
        raise NotImplementedError

    @tool
    def examine(self, params: ExamineParams) -> ToolOutput:
        """Examine a patient — returns current vitals and observable state."""
        raise NotImplementedError

    @tool
    def order(self, params: OrderParams) -> ToolOutput:
        """Order a test or imaging study."""
        raise NotImplementedError

    @tool
    def read(self, params: ReadParams) -> ToolOutput:
        """Read a patient's chart — history, prior notes, results returned."""
        raise NotImplementedError

    @tool
    def write(self, params: WriteParams) -> ToolOutput:
        """Write to a patient's chart."""
        raise NotImplementedError

    @tool
    def wait(self, params: WaitParams) -> ToolOutput:
        """Advance simulated time. Returns events that fired during the wait."""
        raise NotImplementedError

    @tool
    def reflect(self, params: ReflectParams) -> ToolOutput:
        """Free notepad write — does not advance time, no state change."""
        raise NotImplementedError

    @tool
    def submit_handoff(self, params: SubmitHandoffParams) -> ToolOutput:
        """Submit final disposition for a patient. Returns finished=True when
        all patients have been dispositioned."""
        raise NotImplementedError

    async def teardown(self) -> None:
        # Cleanup hook — not for scoring (which lives in submit_handoff).
        pass


if __name__ == "__main__":
    Server([TriageEnv]).run()
