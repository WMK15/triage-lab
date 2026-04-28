# Triage Nurse — v2 (batch classification)

> Five patients in a waiting room. Classify each into one of the five Manchester / KTAS triage levels. Ground truth comes from the unified triage reference corpus in `dataset/combined-triage-reference.csv`, which carries the original expert-panel KTAS rows alongside symptom-reference and ED triage rows. Built as an OpenReward environment whose rollouts feed the Triage Lab UI in the parent repo.

The previous **v1 ED-shift formulation** (10 patients across a 6-hour shift, 7 primitives + nurses/consultants/families/judge) lives on the `v1-ed-shift` branch.

## What the agent sees

Initial prompt lists five patients (rows from the CSV) with full vitals, complaint, mental state, NRS pain. Plus seven tools:

- `assign_immediate(patient_id)` — KTAS 1, life-threatening
- `assign_very_urgent(patient_id)` — KTAS 2, high risk of rapid deterioration
- `assign_urgent(patient_id)` — KTAS 3, significant pathology, stable
- `assign_standard(patient_id)` — KTAS 4, stable, non-emergent
- `assign_not_urgent(patient_id)` — KTAS 5, primary-care-manageable
- `wait(minutes)` — advance time, surface deterioration alerts
- `write_note(patient_id, note)` — chart scratchpad

Episode ends when every patient has been assigned exactly one level.

## Reward

Asymmetric KTAS distance — under-triage penalised harder than over-triage:

```
gap = |agent - truth|
base = max(0, 1 - 0.4 * gap)         # 1.0, 0.6, 0.2, 0, 0
under_triage_factor = 0.5 if agent > truth else 1.0
per_patient = base * under_triage_factor
```

Plus an ordering bonus: +0.1 if the first patient assigned was the most acute in the batch; -0.1 if it was the least acute.

```
composite = clip(mean(per_patient) + ordering_bonus, 0, 1)
```

No LLM judge — ground truth is exact match against `KTAS_expert`.

## Quickstart

```bash
cd triage-nurse
just install
cp .env.example .env       # add OPENAI_API_KEY (or ANTHROPIC_API_KEY)
just serve-env             # terminal 1 — starts on http://localhost:8080
just run-harness           # terminal 2 — runs all three demo batches
```

Rollouts land in `runs/<episode_id>/`. The Next.js UI in the parent repo (`/episodes`) reads them.

## Training Readiness

The env now exposes deterministic split-aware tasks for OpenReward training:

- `train` split: 256 generated five-patient batches
- `test` split: 64 held-out five-patient batches
- rows are drawn from `dataset/combined-triage-reference.csv`
- train/test partitioning is deterministic and stratified by KTAS level

List tasks:

```bash
uv run python -m triage_nurse.harness --list-tasks --split train
uv run python -m triage_nurse.harness --list-tasks --split test
```

Print example training commands:

```bash
uv run python scripts/print_training_commands.py
```

The repo includes a compatibility shim for the short SkyRL command shape. It
generates SkyRL prompt datasets, registers a SkyRL-Gym adapter for
`triagebatchenv`, and dispatches to SkyRL's Python module entrypoint:

```bash
skyrl train \
  --env triagebatchenv \
  --env-url http://127.0.0.1:8080 \
  --base-model Qwen/Qwen2.5-7B-Instruct \
  --algorithm grpo \
  --group-size 8 \
  --batch-tasks 32 \
  --iterations 200 \
  --eval-every 20
```

Use `./bin/skyrl train ...` if the shim has not been linked onto `PATH`.

SkyRL GRPO training still requires a CUDA GPU node with the SkyRL Python 3.12
then stops before launching vLLM/FSDP. The `--env-url` flag is retained for the
OpenReward-compatible command shape; SkyRL itself trains through the local
SkyRL-Gym adapter and generated Parquet datasets.

## Layout

```
src/triage_nurse/
  config.py          env vars, model names, cost caps     [full]
  cost_tracker.py    shared cost-cap mechanism            [full]
  llm.py             SDK wrappers + tool-format translator [full]
  world_state.py     Pydantic state models (5 patients)   [full]
  dataset.py         unified dataset loader + splits      [full]
  scoring.py         asymmetric KTAS distance             [full]
  triage_env.py      TriageBatchEnv + 7 @tool methods     [full]
  harness.py         custom OpenAI agent loop             [full]
runs/                harness output (JSONL rollouts)
scripts/             demo and training helpers
tests/               smoke + dataset + scoring + cost     (42 tests)
```

## Why v2

v1 was conceptually rich (6h shift, multi-actor) but its grading was heuristic (`narrative_role` → set of acceptable dispositions) and the agent's surface was broad (8 tools). v2:

- **Real ground truth.** `KTAS_expert` from a 3-expert-panel-graded dataset, carried through the unified corpus without a judge rubric.
- **No judge LLM call.** Saves ~£0.10–£0.30/episode and a parse-failure layer.
- **Tighter loop.** 7 tools, 5–25 turn episodes, ~£0.005/episode at gpt-5-mini.
- **Authoring goes away.** Every valid row is a free task source, and the env now samples split-aware five-patient KTAS-diverse batches from the unified corpus.

Lost: social-complication and finite-cooperation pressure points (no nurses/consultants/families). Kept: silent-deterioration via `wait()` returning trajectory alerts on KTAS 1–2 patients.

## Status

Backend tests currently pass with the unified dataset and split-aware task generation:

```bash
uv run pytest
```

That gives the env a real `train` / `test` surface for OpenReward training instead of only a few demo batches.
