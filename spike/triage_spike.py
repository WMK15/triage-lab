"""
Minimal OpenReward Environment to verify our understanding of the API.

Three @tool methods, one fake patient (P1), deterministic reward.
True diagnosis: NSTEMI. Reward = 1.0 iff agent orders troponin AND admits.

Run server:   python triage_spike.py
Drive it via: python harness_spike.py
"""
from typing import Literal

from pydantic import BaseModel
from openreward.environments import (
    Environment,
    JSONObject,
    Server,
    Split,
    TextBlock,
    ToolOutput,
    tool,
)


class ExamineParams(BaseModel):
    patient_id: str


class OrderTestParams(BaseModel):
    patient_id: str
    test_name: str


class SubmitParams(BaseModel):
    patient_id: str
    disposition: Literal["admit", "discharge", "observe"]


class TriageSpike(Environment):
    """Tiny ED env with one fake patient (P1)."""

    def __init__(self, task_spec: JSONObject = {}, secrets: dict[str, str] = {}) -> None:
        super().__init__(task_spec)
        self.examined: set[str] = set()
        self.tests_ordered: list[str] = []
        self.turns = 0

    @classmethod
    def list_tasks(cls, split: str) -> list[JSONObject]:
        return [{"id": "spike-1", "scenario": "single-patient-NSTEMI"}]

    @classmethod
    def list_splits(cls):
        return [Split(name="test", type="test")]

    def get_prompt(self) -> list[TextBlock]:
        return [
            TextBlock(
                type="text",
                text=(
                    "You are an ED physician. Patient P1 presents with vague jaw "
                    "discomfort and mild SOB; reported history of GERD. "
                    "Examine, order tests as needed, and submit a disposition. "
                    "Tools: examine_patient, order_test, submit_disposition."
                ),
            )
        ]

    @tool
    def examine_patient(self, params: ExamineParams) -> ToolOutput:
        """Examine a patient and receive their current state."""
        self.examined.add(params.patient_id)
        self.turns += 1
        return ToolOutput(
            blocks=[
                TextBlock(
                    type="text",
                    text=(
                        f"Patient {params.patient_id}: HR 92, BP 138/86, RR 18, "
                        "SpO2 96% RA, mild diaphoresis, denies acute chest pain."
                    ),
                )
            ],
            reward=0.0,
            finished=False,
        )

    @tool
    def order_test(self, params: OrderTestParams) -> ToolOutput:
        """Order a test and receive the result."""
        self.tests_ordered.append(params.test_name)
        self.turns += 1
        name_lower = params.test_name.lower()
        if "trop" in name_lower:
            result = "Troponin I 0.18 ng/mL (elevated; ref < 0.04)"
        elif "ecg" in name_lower or "ekg" in name_lower:
            result = "ECG: ST depression V4-V6, no Q waves"
        elif "cbc" in name_lower or "blood" in name_lower:
            result = "WBC 9.1, Hgb 13.8, Plt 240 (normal)"
        else:
            result = f"Test '{params.test_name}' resulted: within normal limits"
        return ToolOutput(
            blocks=[TextBlock(type="text", text=f"{params.test_name}: {result}")],
            reward=0.0,
            finished=False,
        )

    @tool
    def submit_disposition(self, params: SubmitParams) -> ToolOutput:
        """Submit final disposition for a patient. Ends the episode."""
        self.turns += 1
        ordered_troponin = any("trop" in t.lower() for t in self.tests_ordered)
        admitted = params.disposition == "admit"
        reward = 1.0 if (ordered_troponin and admitted) else 0.0
        if reward == 1.0:
            verdict = "Correct: NSTEMI confirmed by troponin, appropriate admission."
        else:
            verdict = (
                f"Suboptimal. ordered_troponin={ordered_troponin}, "
                f"disposition={params.disposition!r}."
            )
        return ToolOutput(
            blocks=[TextBlock(type="text", text=verdict)],
            reward=reward,
            finished=True,
        )


if __name__ == "__main__":
    Server([TriageSpike]).run()
