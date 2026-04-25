"""Settings for triage_nurse, loaded from the environment via pydantic-settings.

A missing LLM key is fatal at import time so misconfig surfaces immediately, not
mid-episode after the harness has spun up.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="",
        extra="ignore",
        case_sensitive=False,
    )

    OPENAI_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None
    OPENREWARD_API_KEY: str | None = None

    TRIAGE_NURSE_AGENT_MODEL: str = "gpt-5-mini"
    TRIAGE_NURSE_JUDGE_MODEL: str = "gpt-5-mini"
    TRIAGE_NURSE_MAX_EPISODE_GBP: float = 2.0

    @property
    def AGENT_MODEL(self) -> str:
        return self.TRIAGE_NURSE_AGENT_MODEL

    @property
    def JUDGE_MODEL(self) -> str:
        return self.TRIAGE_NURSE_JUDGE_MODEL

    @property
    def MAX_EPISODE_GBP(self) -> float:
        return self.TRIAGE_NURSE_MAX_EPISODE_GBP


settings = Settings()


def require_llm_key() -> None:
    """Call from the entry point (harness/env). Tests and stubs don't need a key."""
    if not settings.OPENAI_API_KEY and not settings.ANTHROPIC_API_KEY:
        raise RuntimeError(
            "Neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is set. "
            "Copy .env.example to .env and fill one in."
        )
