"""SkyRL-Gym adapter for the triage batch environment."""

from __future__ import annotations

import json
import re
from typing import Any

from skyrl_gym.envs.base_text_env import BaseTextEnv, BaseTextEnvStepOutput

from .scoring import AssignmentResult, assignment_reward, score_batch
from .triage_env import _build_world

_DECODER = json.JSONDecoder()
_LEVEL_RE = re.compile(r"[1-5]")


def _first_json_value(text: str) -> Any | None:
    for idx, char in enumerate(text):
        if char not in "[{":
            continue
        try:
            value, _ = _DECODER.raw_decode(text[idx:])
            return value
        except json.JSONDecodeError:
            continue
    return None


def _coerce_level(value: Any) -> int | None:
    if isinstance(value, int) and 1 <= value <= 5:
        return value
    if isinstance(value, str):
        match = _LEVEL_RE.search(value)
        if match:
            return int(match.group(0))
    return None


def _normalise_json_assignments(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict) and isinstance(value.get("assignments"), list):
        value = value["assignments"]
    elif isinstance(value, dict) and isinstance(value.get("patients"), list):
        value = value["patients"]

    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]

    if isinstance(value, dict):
        assignments: list[dict[str, Any]] = []
        for patient_id, level in value.items():
            if isinstance(level, dict):
                merged = dict(level)
                merged.setdefault("patient_id", patient_id)
                assignments.append(merged)
            else:
                assignments.append({"patient_id": patient_id, "ktas": level})
        return assignments

    return []


def _fallback_assignments(text: str, patient_ids: list[str]) -> list[dict[str, Any]]:
    assignments: list[dict[str, Any]] = []
    for patient_id in patient_ids:
        pattern = re.compile(
            re.escape(patient_id) + r".{0,120}?(?:KTAS|ktas|level|acuity)?[^1-5]*([1-5])",
            re.DOTALL,
        )
        match = pattern.search(text)
        if match:
            assignments.append({"patient_id": patient_id, "ktas": int(match.group(1))})
    return assignments


class TriageBatchSkyRLEnv(BaseTextEnv):
    """Single-turn SkyRL text environment for KTAS batch classification."""

    def __init__(self, _env_config: Any = None, extras: dict[str, Any] | None = None):
        super().__init__()
        extras = extras or {}
        task_spec = extras.get("task_spec") if isinstance(extras.get("task_spec"), dict) else extras
        self.world = _build_world(task_spec)
        self.patient_ids = list(self.world.patients)
        self.max_turns = int(extras.get("max_turns", 1) or 1)
        self._metrics: dict[str, Any] = {}

    def _parse_assignments(self, action: str) -> tuple[list[dict[str, Any]], bool]:
        value = _first_json_value(action)
        if value is not None:
            assignments = _normalise_json_assignments(value)
            if assignments:
                return assignments, False
        return _fallback_assignments(action, self.patient_ids), True

    def step(self, action: str) -> BaseTextEnvStepOutput:
        assignments, used_fallback = self._parse_assignments(action)
        seen: set[str] = set()
        valid_results: list[AssignmentResult] = []
        all_results: list[AssignmentResult] = []
        invalid_count = 0

        for item in assignments:
            patient_id = str(
                item.get("patient_id")
                or item.get("id")
                or item.get("patient")
                or ""
            )
            level = _coerce_level(item.get("ktas") or item.get("level") or item.get("acuity"))
            if patient_id not in self.world.patients or level is None or patient_id in seen:
                invalid_count += 1
                continue

            seen.add(patient_id)
            patient = self.world.patients[patient_id]
            truth = patient.ground_truth_ktas
            reward = assignment_reward(level, truth) if truth is not None else None
            result = AssignmentResult(
                patient_id=patient_id,
                agent_level=level,  # type: ignore[arg-type]
                truth_level=truth,
                reward=reward,
                order=len(valid_results) + 1,
            )
            valid_results.append(result)
            all_results.append(result)

        missing = [patient_id for patient_id in self.patient_ids if patient_id not in seen]
        for patient_id in missing:
            patient = self.world.patients[patient_id]
            truth = patient.ground_truth_ktas
            all_results.append(
                AssignmentResult(
                    patient_id=patient_id,
                    agent_level=5,
                    truth_level=truth,
                    reward=assignment_reward(5, truth) if truth is not None else None,
                    order=len(all_results) + 1,
                )
            )

        scored_rewards = [a.reward for a in all_results if a.truth_level is not None and a.reward is not None]
        base_reward = sum(scored_rewards) / len(scored_rewards) if scored_rewards else 0.0
        ordering_bonus = score_batch(valid_results).ordering_bonus if valid_results else 0.0
        composite = max(0.0, min(1.0, base_reward + ordering_bonus))
        penalty = min(0.5, (0.05 * invalid_count) + (0.1 if used_fallback else 0.0))
        reward = max(0.0, composite - penalty)

        self._metrics = {
            "base_reward": base_reward,
            "ordering_bonus": ordering_bonus,
            "invalid_assignments": invalid_count,
            "missing_assignments": len(missing),
            "used_fallback_parser": float(used_fallback),
        }

        return BaseTextEnvStepOutput(
            observations=[],
            reward=reward,
            done=True,
            metadata={"assignments": [a.model_dump() for a in all_results]},
        )

    def get_metrics(self) -> dict[str, Any]:
        return self._metrics
