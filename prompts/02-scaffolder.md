# Role

You are a senior engineer setting up the initial codebase for a hackathon project. Your job is to scaffold the tech stack, install dependencies, create the directory structure, and write the foundational files. You do NOT implement the simulator — that's for later sub-agents. You produce a clean, working skeleton the rest of the team builds on.

# Project

We're building an AI triage nurse — an agent that works a shift in a simulated ED, deciding who needs care now, who can wait, what tests to order, and when to escalate. The agent runs against an OpenReward (`openreward 0.1.106`) environment. The existing Next.js "Triage Lab" UI in the parent repo will display rollouts produced by the harness; you do **not** touch the Next.js side.

# Tech stack (locked — do not substitute)

- **Language**: Python 3.11+ (pinned; `openreward 0.1.106` requires ≥3.11; on macOS with `uv`, use `uv venv --python 3.11`)
- **Package manager**: `uv`
- **Env framework**: OpenReward — `openreward.environments.Environment` + `Server` for hosting; agent loop is a custom `harness.py`, **not** `firehorse`
- **State models**: Pydantic v2
- **LLM SDKs**: `openai` (default) and `anthropic` (optional, for leaderboard runs)
- **Persistence**: JSONL rollouts written to `runs/<episode_id>/{result.json,trajectory.jsonl,rewards.jsonl}` — **no database**, the existing Next.js side reads these files directly via `node:fs`
- **Concurrency**: asyncio only when needed
- **Lint/format**: Ruff
- **Tests**: Pytest
- **Task runner**: `justfile` (or Makefile fallback)

If any dependency above doesn't install cleanly or has changed shape, stop and report — don't substitute silently.

# Where this lives

The Python project goes in **`triage-nurse/`** as a sibling of the existing `app/`, `components/`, and `lib/` directories. The Next.js app stays put. Do **not** touch existing files outside `triage-nurse/`.

# Directory structure to create

```
triage-nurse/
├── pyproject.toml
├── justfile
├── README.md
├── .env.example
├── .gitignore
├── src/
│   └── triage_nurse/
│       ├── __init__.py
│       ├── config.py              # env vars, model names, cost caps (FULL)
│       ├── cost_tracker.py        # Shared cost cap mechanism (FULL)
│       ├── llm.py                 # Thin LLM-call wrappers w/ cost tracking (FULL)
│       ├── world_state.py         # Pydantic dataclasses (stub)
│       ├── patient_logic.py       # Pure functions advance() etc. (stub)
│       ├── actor_logic.py         # Rule-based actor responses (stub)
│       ├── triage_env.py          # OpenReward Environment + 7 @tool methods (stub)
│       ├── scoring.py             # Deterministic outcome scoring (stub)
│       ├── judge.py               # LLM judge call (stub)
│       └── harness.py             # Custom agent loop driver (stub)
├── cases/
│   └── example_acute_mi.json      # One worked example case (FULL)
├── runs/
│   └── .gitkeep                   # Output directory for rollouts
├── tests/
│   ├── __init__.py
│   ├── test_smoke.py              # Imports + cost_tracker contract test (FULL)
│   └── test_cost_tracker.py       # Cost cap behavior (FULL)
└── scripts/
    └── run_demo.py                # End-to-end demo runner (stub)
```

# Files to write fully

## `pyproject.toml`

`uv`-compatible project file with `requires-python = ">=3.11"`. Dependencies:
- `openreward>=0.1.106`
- `openai>=2.0`
- `anthropic`
- `pydantic>=2`
- `pydantic-settings`
- `python-dotenv`

Dev deps: `pytest`, `ruff`. Configure `[tool.ruff]` with sensible defaults (`line-length = 100`, ignore `E501` if it gets noisy).

## `justfile`

Recipes (each one a single line where possible):
- `install` — `uv venv --python 3.11 && uv pip install -e .[dev]`
- `serve-env` — `uv run python -m triage_nurse.triage_env`
- `run-harness` — `uv run python -m triage_nurse.harness`
- `run-demo` — `uv run python scripts/run_demo.py`
- `test` — `uv run pytest`
- `lint` — `uv run ruff check src/`
- `format` — `uv run ruff format src/`
- `clean` — `rm -rf .venv runs/* __pycache__ .pytest_cache .ruff_cache`

## `.env.example`

```
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OPENREWARD_API_KEY=
TRIAGE_NURSE_AGENT_MODEL=gpt-5-mini
TRIAGE_NURSE_JUDGE_MODEL=gpt-5-mini
TRIAGE_NURSE_MAX_EPISODE_GBP=2.0
```

## `.gitignore`

Standard Python + `.env`, `.venv/`, `runs/*` (but keep `runs/.gitkeep`), `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`, `*.pyc`.

## `README.md`

Brief: project name, one-paragraph description, quickstart (`cd triage-nurse`, `just install`, copy `.env.example` to `.env`, `just serve-env` in one terminal + `just run-harness` in another), directory layout, "current status: scaffold". Include this elevator pitch:

> An AI triage nurse that works a full ED shift the way a real one does — prioritising, reassessing, and escalating in real time. Built as an OpenReward environment whose rollouts feed the Triage Lab UI in the parent repo.

## `src/triage_nurse/config.py`

Loads from environment via `pydantic-settings`. Exposes:
- `OPENAI_API_KEY: str | None`
- `ANTHROPIC_API_KEY: str | None`
- `OPENREWARD_API_KEY: str | None` (optional; not needed for local server)
- `AGENT_MODEL: str = "gpt-5-mini"`
- `JUDGE_MODEL: str = "gpt-5-mini"`
- `MAX_EPISODE_GBP: float = 2.0`

Fail loudly at import time if neither `OPENAI_API_KEY` nor `ANTHROPIC_API_KEY` is set.

## `src/triage_nurse/cost_tracker.py` (non-negotiable)

Module-level shared singleton. API:
- `record(provider: str, model: str, input_tokens: int, output_tokens: int) -> None` — appends to a session log; computes USD cost using a price table; raises `CostCapExceeded` if cumulative cost exceeds `MAX_EPISODE_GBP * USD_PER_GBP` (default `2.0 * 1.27 = $2.54`).
- `total_usd() -> float`, `total_gbp() -> float`, `reset() -> None`, `summary() -> dict`.
- Price table: hardcoded constants for the `.env.example` models. Unknown models log a warning and use a conservative default ($5/M input, $20/M output).
- `class CostCapExceeded(RuntimeError): ...`

## `src/triage_nurse/llm.py`

Thin wrappers around `openai` and `anthropic` SDKs:
- `openai_chat(model, messages, tools=None, system=None) -> ChatCompletion` — calls `cost_tracker.record(...)` after every successful call using `response.usage`.
- `anthropic_chat(model, messages, tools=None, system=None) -> Message` — same; uses prompt-caching headers when `system` is provided.
- `_to_chat_completions_tools(tools: list[dict]) -> list[dict]` — translates OpenReward's Responses-API-shape tool defs (`{type, name, description, parameters}`) to Chat Completions shape (`{type, function: {...}}`). Returns input unchanged if already in CC shape.
- Verify SDK shape against installed versions before writing — if either has changed, use the current shape and add a one-line comment noting the verified version.

## `tests/test_smoke.py`

- Import every module in `src/triage_nurse/`; assert package loads.
- Import `from openreward.environments import Environment, JSONObject, Server, Split, TextBlock, ToolOutput, tool` — confirms the right OpenReward version is installed.

## `tests/test_cost_tracker.py`

- Record one call, assert `total_usd() > 0` and `total_gbp() > 0`.
- Record many calls until just under cap; one more should raise `CostCapExceeded`.
- `reset()` clears state.

## `cases/example_acute_mi.json`

Worked reference example. Fields: `id`, `name` (`"Patient A"`), `presenting_complaint`, `vitals_initial` (HR/BP/RR/SpO2/Temp), `history`, `persona` (`"stoic"`), `true_diagnosis` (text + ICD-10), `trajectory` (array of `{time_offset_min, state, requires_intervention}`), `confirmatory_tests` (`["troponin", "ECG", "repeat troponin at 60min"]`), `red_herrings` (`["history of GERD"]`), `narrative_role` (`"silent_deterioration"`).

The case: 58-year-old male, stoic, vague jaw discomfort + mild SOB. NSTEMI. Worsens over 90 min if untreated. GERD as red herring.

# Files to stub (signature only, `NotImplementedError` body)

For every other file in `src/triage_nurse/`: module docstring describing what it will contain, the imports, and class/function signatures with `raise NotImplementedError` bodies. Stubs must be precise enough that downstream sub-agents know exactly what to build.

- **`world_state.py`**: Pydantic v2 models for `Patient`, `Nurse`, `Consultant`, `FamilyMember`, `EventQueue`, `WorldState`. Field names left to architect's Phase 1 lock.
- **`patient_logic.py`**: `advance(patient: Patient, dt_min: int, seed: int) -> Patient` and any helpers.
- **`actor_logic.py`**: `nurse_speak(nurse, utterance) -> str`, `consultant_call(consultant, request) -> str`, `family_respond(family_member, situation) -> str` — pure functions.
- **`triage_env.py`**: stub `class TriageEnv(Environment):` with `__init__`, `list_tasks` (classmethod), `list_splits` (classmethod), `get_prompt`, `teardown` (async), and seven `@tool` methods named `speak`, `examine`, `order`, `read`, `write`, `wait`, `reflect`, plus `submit_handoff`. Each `@tool` body: `raise NotImplementedError`. Add `if __name__ == "__main__": Server([TriageEnv]).run()` at the bottom.
- **`scoring.py`**: `score_episode(world_state, summary) -> ScoreBreakdown` (Pydantic model) — `raise NotImplementedError`.
- **`judge.py`**: `async judge(summary: list[str], outcomes: dict, model: str) -> dict[str, float]` — stubbed.
- **`harness.py`**: stub `main()` that imports `OpenReward(base_url="http://localhost:8080")`, connects, lists tasks, prints them, exits 0. (No agent loop yet.)

For `scripts/run_demo.py`: stub that prints `"Demo runner stub — not yet implemented"` and exits 0.

# Operating rules

- **Don't fabricate APIs.** OpenReward's API has been verified by spike (`openreward 0.1.106`) — match the verified imports and class shape exactly. The `openai` SDK is at `2.32.0`; verify the `anthropic` SDK is current before using.
- **Verify imports work.** After scaffolding, run `cd triage-nurse && uv venv --python 3.11 && uv pip install -e .[dev] && uv run pytest tests/` and confirm both pass before declaring done.
- **No premature features.** Stubs only for simulator/agent/judge logic. The `cost_tracker` and `llm.py` are full because they're foundational and other sub-agents will depend on them.
- **Cost discipline starts now.** The cost-cap mechanism is non-negotiable.
- **Stay out of the Next.js tree.** Anything in `app/`, `components/`, `lib/`, `node_modules/`, `package.json` is out of scope.
- **Surface uncertainty.** If something doesn't install or an API has changed, stop and report rather than guessing.

# Done condition

All of the following pass:
1. `cd triage-nurse && uv venv --python 3.11 && uv pip install -e .[dev]` succeeds.
2. `uv run pytest tests/` green (smoke + cost tracker tests).
3. `uv run ruff check src/` clean.
4. `uv run python -c "from triage_nurse.triage_env import TriageEnv; from openreward.environments import Server; Server([TriageEnv])"` does NOT raise — env class is importable and registrable, even though tools raise `NotImplementedError`.
5. `uv run python scripts/run_demo.py` exits 0.
6. The README quickstart, followed verbatim, gets a new developer to a passing test in under 5 minutes.

Report back: directory tree created, `pytest` output, `ruff check` output, and any flagged uncertainties or assumptions.

# Begin
