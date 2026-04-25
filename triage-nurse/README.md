# Triage Nurse

> An AI triage nurse that works a full ED shift the way a real one does — prioritising, reassessing, and escalating in real time. Built as an OpenReward environment whose rollouts feed the Triage Lab UI in the parent repo.

## Quickstart

```bash
cd triage-nurse
just install
cp .env.example .env       # add your OPENAI_API_KEY (or ANTHROPIC_API_KEY)
just serve-env             # terminal 1 — starts the env on http://localhost:8080
just run-harness           # terminal 2 — drives the env with the agent
```

Rollouts land in `runs/<episode_id>/`. The Next.js UI in the parent repo (`/episodes`) reads them.

## Layout

```
src/triage_nurse/
  config.py          env vars, model names, cost caps     [full]
  cost_tracker.py    shared cost-cap mechanism            [full]
  llm.py             SDK wrappers + tool-format translator [full]
  world_state.py     Pydantic state models                [stub]
  patient_logic.py   patient evolution                    [stub]
  actor_logic.py     nurses, consultants, families        [stub]
  triage_env.py      OpenReward Env subclass + 7 @tools   [stub]
  scoring.py         deterministic outcome scoring        [stub]
  judge.py           LLM judge call                       [stub]
  harness.py         custom agent loop                    [stub]
cases/               patient case templates (JSON)
runs/                harness output (JSONL rollouts)
tests/               smoke + cost-tracker contract
scripts/run_demo.py  end-to-end demo runner               [stub]
```

## Status

Scaffold. The simulator, scoring, and judge are stubs — only `cost_tracker`, `config`, and `llm` are implemented. The build-out plan lives in `prompts/01-architect.md` in the repo root.

## Why £2 per episode?

The shared `cost_tracker` raises `CostCapExceeded` when cumulative LLM spend (env-side actor dialogue + harness-side agent decisions + judge call) crosses the cap. £2 ≈ $2.54 USD, enough headroom for a full 6-hour shift on `gpt-5-mini`.
