# Spec: Multi-mode input (test batch / manual single / manual multi)

**Status:** draft, on branch `spec/multi-mode-input`
**Date:** 2026-04-25
**Supersedes:** none — extends v2 batch classification

## Goal

Make the homepage input panel support three submission modes instead of one:

1. **Test batch** — a pre-seeded KTAS-graded batch (current mode), now with size presets and a chief-complaint preview, plus an optional intake note that adds a 6th unscored patient.
2. **Manual single patient** — user types one patient's details (free text + optional structured fields). Agent classifies. No ground truth, no composite — agent's level is the output.
3. **Manual multi-patient** — user types up to 8 patients (each a card with free text + optional structured). Agent classifies all. No ground truth.

The unifying rule: **only patients with `ground_truth_ktas` contribute to the composite reward.** Manual / intake-note patients get classified, are recorded in the trajectory and result, but skipped by `scoring.score_batch`.

## Why

- The current homepage's intake-note textarea is dead UX from v1 — it goes to `TRIAGE_OPERATOR_NOTE` env var that nothing reads. Users typed clinical scenarios expecting a single-patient response and got a generic 5-batch run unrelated to their text.
- "Manual" modes turn the env into a useful triage advisor for cases that don't exist in the dataset. The agent's classification is the output even without truth — useful for heuristic comparisons across cases or models.
- Test batch with intake-note (Option C from the prior brainstorm) splits the difference: keep the scored cohort, add the user's case alongside as an unscored sixth.
- Multi-size batches let demos pick `n=3` for a fast £0.003 run or `n=10` for a more substantial one.

## UX

### Tabs at the top of the input panel

```
╔═══════════╗  ┌──────────────┐  ┌───────────────┐
║Test batch ║  │Manual single │  │Manual multi   │
╚═══════════╝  └──────────────┘  └───────────────┘
```

Active tab styled with the existing `--accent` token; inactive tabs use `--surface-secondary` like the existing button group elsewhere in the design system.

### Mode A — Test batch

```
Batch:    [batch-seed42 ▼]
Size:     [3] [5*] [8] [10]            ← preset chips, default 5

Preview ────────────────────────────────────────────
  1. row-132  age 71 M  "right ocular pain"     KTAS 1
  2. row-510  age 38 F  "general weakness"      KTAS 2
  3. row-960  age 52 M  "abdominal pain"        KTAS 3
  4. row-581  age 24 F  "throat pain"           KTAS 4
  5. row-311  age 60 M  "headache"              KTAS 5
────────────────────────────────────────────────────

☐ Add intake-note patient (unscored)
[ ───────────────────────────────────────────── ]   ← textarea, disabled
[ ───────────────────────────────────────────── ]      until checkbox ✓

[ Submit run ]
```

The preview is fetched from a new `POST /api/triage/preview` endpoint that takes `{taskId, batchSize}` and returns the patients (id, age, sex, chief_complaint, ground_truth_ktas) the env will load. Refetched on dropdown / size change.

When the intake-note checkbox is on and text is entered, that gets serialised as a sixth patient (no ground truth) and submitted alongside the batch.

### Mode B — Manual single

```
Patient details (free text):
[ 58yo male, chest pain radiating to jaw, sweating, ─ ]
[ HR around 100, BP 145/95.                          ─ ]

▸ Add structured fields (optional)        ← expandable

[ Submit run ]
```

Expanded structured fields:

```
Age:       [ 58 ]      Sex:           [ M ▼ ]
HR:        [ 100 ]     SBP/DBP:       [ 145 ] / [ 95 ]
RR:        [ 18 ]      SpO2:          [ 96 ]    Temp °C: [ 37.0 ]
Mental:    [ alert ▼ ]  NRS pain:     [ 7 ]
```

If structured fields are filled, they take precedence; otherwise the backend best-effort extracts via regex from the free text; otherwise placeholders (HR 90, BP 120/80, RR 16, SpO2 98, Temp 37.0, mental=alert, NRS none).

### Mode C — Manual multi

```
Patient 1 ──────────────────────────────────── [×]
[ free text textarea ]
▸ Structured fields (optional)

Patient 2 ──────────────────────────────────── [×]
[ free text textarea ]
▸ Structured fields (optional)

[ + Add another patient ]   (disabled when count = 8)

[ Submit run ]
```

Hard cap: 8. Add button disables when at cap; tooltip says `"Cap of 8 patients per run to keep cost predictable."` Submit warns if any patient has empty free text.

## Schema changes

### `world_state.py`

```python
class Patient(BaseModel):
    ...
    # was: ground_truth_ktas: KtasLevel
    ground_truth_ktas: KtasLevel | None = None   # None = manual / intake-note patient
```

### Task spec (env input)

```jsonc
{
  "id": "...",
  "row_indices": [132, 510, 960, 581, 311],   // CSV-derived patients (scored against KTAS_expert)
  "manual_patients": [                         // user-entered
    {
      "chief_complaint": "blurry vision, shooting pain down left arm",
      "age": null,                              // null = use placeholder / extract from text
      "sex": null,
      "vitals": null,                           // null = placeholders
      "mental_state": null,
      "nrs_pain": null,
      "expected_ktas": 2                        // OPTIONAL — if present, becomes ground_truth_ktas
                                                //   and patient gets scored against it (treats user
                                                //   expectation as truth). If absent → unscored.
    }
  ],
  "n": 5,
  "seed": 42,
  "max_turns": 50,
  "shift_length_min": 60
}
```

**`expected_ktas` as ground truth.** When provided on a manual patient, the
env stores it as `ground_truth_ktas` exactly as if it came from the dataset.
The agent's classification is then scored normally (asymmetric KTAS distance,
with under-triage penalty). This converts manual mode from "free-form
inspection" into a "user-defined eval set" — useful for stress-testing the
agent against cases the user knows the answer to.

The UI surfaces `expected_ktas` as an optional dropdown on each manual
patient card (default: blank = unscored). When set, the per-patient row in
the result page shows `expected vs agent` comparison just like a CSV row's
`truth vs agent`.

`row_indices` may be empty for pure-manual tasks. Either field can be omitted; at least one of (`row_indices`, `manual_patients`, `n>0` for selection) must be non-empty.

### Result schema additions

```jsonc
{
  // existing fields …
  "scored_count": 5,                  // patients that contributed to composite
  "manual_count": 1,                  // count of unscored manual / intake-note
  "per_patient_assignments": [
    {
      "patient_id": "row-132",
      "agent_level": 1,
      "truth_level": 1,
      "reward": 1.0,
      "scored": true,
      "source": "dataset",            // "dataset" | "manual"
      "chief_complaint": "right ocular pain"
    },
    {
      "patient_id": "manual-0",
      "agent_level": 2,
      "truth_level": null,
      "reward": null,
      "scored": false,
      "source": "manual",
      "chief_complaint": "blurry vision, shooting pain down left arm"
    }
  ],
  "evaluation_summary": {             // NEW — aggregated truth-vs-agent stats
    "scored_count": 5,
    "exact_matches": 3,
    "over_triage": 1,                 // agent assigned MORE severe than truth
    "under_triage": 1,                // agent assigned LESS severe than truth (numerically larger)
    "exact_rate": 0.6,
    "mistriage_rate": 0.4,            // 1 - exact_rate
    "under_triage_rate": 0.2,         // dataset paper: 70% of human errors are under-triage
    "off_by_one_count": 2,
    "off_by_two_or_more_count": 0,
    "confusion": {                    // small confusion structure: agent_level -> {truth_level: count}
      "1": {"1": 1},
      "2": {"2": 1, "3": 1},
      "3": {"3": 1, "4": 1},
      "4": {"4": 0},
      "5": {"5": 0}
    }
  }
}
```

`composite_score` and `score` continue to be the mean over scored patients only. If `scored_count == 0` (pure manual run with no `expected_ktas` set), composite is `null`; the UI displays the agent's classifications without a score and `evaluation_summary` is also `null`.

**Why a separate `evaluation_summary`.** `per_patient_assignments` already contains everything to compute it, but the front-end re-computing on every render is wasteful when there are 8+ patients. Pre-computing in the harness (it already iterates the assignments to build the rollout) is cheap and lets the UI stay declarative.

### Episode detail page — evaluation section

A new card on `/episodes/[id]` rendering the evaluation:

```
┌─ Evaluation ────────────────────────────────────────────┐
│  Scored: 5 / 6 patients      Mistriage rate: 40.0%       │
│  ┌────────────┬────────┬────────┬───────┬─────────┐     │
│  │ Patient    │ Truth  │ Agent  │ Δ     │ Result  │     │
│  ├────────────┼────────┼────────┼───────┼─────────┤     │
│  │ row-132    │ 1      │ 1      │ exact │  ✓      │     │
│  │ row-510    │ 2      │ 3      │ -1    │ UNDER   │     │
│  │ row-960    │ 3      │ 2      │ +1    │ over    │     │
│  │ row-581    │ 4      │ 4      │ exact │  ✓      │     │
│  │ row-311    │ 5      │ 5      │ exact │  ✓      │     │
│  │ manual-0   │ —      │ 2      │ —     │ unscored│     │
│  └────────────┴────────┴────────┴───────┴─────────┘     │
│                                                          │
│  Vs. nurse panel on this dataset (Moon et al. 2019):     │
│    Human nurses mistriage rate: 14.7%                    │
│    Of those errors: 70.4% under-triage                   │
└──────────────────────────────────────────────────────────┘
```

The "vs. human nurses" line is static text from the source paper; lets the
demo make a direct comparison without computing anything across runs.

## Implementation map

### Python

| File | Change |
|---|---|
| `world_state.py` | `Patient.ground_truth_ktas: KtasLevel \| None = None` |
| `dataset.py` | New `synthesize_manual_patient(payload, idx) -> Patient`. Reads optional structured fields, extracts vitals from free text via regex (e.g. `r"HR\s*(\d+)"`, `r"BP\s*(\d+)/(\d+)"`), falls back to placeholders. Trajectory is a single step at `time_offset_min=0` with `state="As reported by operator"`, `requires_intervention=False`. |
| `triage_env.py` | `_build_world` reads `task_spec.manual_patients`, calls `synthesize_manual_patient` for each, appends to `world.patients` with `id="manual-<idx>"`. `n` parameter respected when `row_indices` empty. Tool docstrings say `"manual patients have no ground truth and don't contribute to the composite."` `_assign` checks `patient.ground_truth_ktas is None`: skips reward-computation, records `truth=None`, `reward=None` in `_assignments`. |
| `scoring.py` | `AssignmentResult.truth_level: KtasLevel \| None`. `score_batch` filters out unscored entries before computing `base_reward` and ordering bonus. Returns composite `None` if zero scored entries. |
| `harness.py` | Two changes: (1) New `--task-spec-file <path>` flag — alternative to `--task <id>`, loads task JSON from disk and passes it to `session(task=...)` directly. (2) `result.json` gets `scored_count`, `manual_count`, `per_patient_assignments` fields populated from the env's final state via a small return tuple from `session.call_tool` of the terminator. Or: read from the trajectory after the fact, since each tool result has agent_level + truth_level encoded in the text. Cleanest: have `submit_handoff`'s tool result include a structured payload the harness parses. |

(Alternative for the harness change: env's `submit_handoff` writes a `summary.json` to the run dir — harness picks that up. Maybe simpler than threading data back through the tool result. Decide at impl time.)

### Tests

| File | New / changed tests |
|---|---|
| `test_world_state.py` (new tiny) | Patient with `ground_truth_ktas=None` constructs cleanly. |
| `test_dataset.py` | `synthesize_manual_patient` with various inputs (empty, full structured, mixed text, regex-extractable text). |
| `test_scoring.py` | `score_batch` with mixed scored/unscored entries — base_reward only over scored, composite=None when all unscored, ordering bonus computed only on scored. |
| `test_smoke.py` | Construct env with `manual_patients=[...]`, assert env builds and exposes them with `ground_truth_ktas=None`. |

### Next.js runtime

| File | Change |
|---|---|
| `lib/triage/runtime.ts` | New `previewBatch(taskId, batchSize) -> PatientPreview[]`. Spawns `uv run python -m triage_nurse.harness --preview <taskId> --n <N>` (new flag) and parses JSON. |
| `lib/triage/runtime.ts` | `runLiveEpisode` accepts `RunRequest`: `{mode, taskId?, batchSize?, extraPatient?, manualPatients?}`. Constructs ad-hoc task spec, writes to `/tmp/triage-task-<uuid>.json`, calls `harness --task-spec-file <path>`. Cleans up temp file on exit. |
| `lib/triage/runtime.ts` | `pickScore` already handles missing composite — no change. |
| `lib/triage/types.ts` | New `PatientPreview`, `ManualPatient`, `RunMode`, updated `RunRequest`. |

### Next.js API routes

| Route | Change |
|---|---|
| `POST /api/triage/preview` | New. Body: `{taskId, batchSize}`. Returns `{patients: PatientPreview[]}`. |
| `POST /api/triage/run` | Body widened to `{mode: "test"\|"manual-single"\|"manual-multi", taskId?, batchSize?, extraPatient?, manualPatients?}`. Validates per mode, calls runtime. |

### Frontend components

| File | Change |
|---|---|
| `components/triage/input-panel.tsx` | Tabs + mode-conditional form. Heaviest change. ~300 LOC. |
| `components/triage/manual-patient-card.tsx` (new) | Per-patient card: free-text textarea + collapsible structured fields. Used by manual-single (count=1, no remove) and manual-multi (count 1..8, removable). |
| `components/triage/batch-preview.tsx` (new) | Renders the patient list returned by `/api/triage/preview`. Fetches on `taskId`/`batchSize` change. |
| `app/page.tsx` | `handleSubmit` signature changes to take `RunRequest` instead of `(scenario, taskId)`. Passes mode through to `/api/triage/run`. |
| `app/episodes/[id]/page.tsx` | When `result.manual_count > 0`, display `(unscored)` badges next to manual patients in the trajectory; show `scored_count / total` next to the composite. |

## Cost & time

Per-run cost stays bounded by `MAX_EPISODE_GBP` (default £2). At gpt-5-mini:
- n=3 batch ≈ £0.003
- n=5 batch ≈ £0.005
- n=8 batch ≈ £0.008
- n=10 batch ≈ £0.010
- Manual single ≈ £0.002
- Manual 8 ≈ £0.012

All comfortably under cap. Implementation effort ~7.5 hours per the brainstorm:
- Env + scoring + dataset (Python): ~2 hrs
- Harness flags + result schema: ~0.5 hrs
- Runtime + API routes (TS): ~1.25 hrs
- InputPanel + new components (TSX): ~3 hrs
- Tests + smoke: ~1 hr

## What stays the same

- The 7-tool surface (`wait`, `write_note`, 5 assignment tools) — no env-tool changes.
- Cost tracker, llm.py wrappers, config — all reused verbatim.
- `app/page.tsx`'s broader chat-style UI (just the input panel sub-component changes plus `handleSubmit` wiring).
- The detail page (`/episodes/[id]`) gets cosmetic additions only.
- The rollout JSONL schema (`trajectory.jsonl`, `rewards.jsonl`) — no changes; events still have `kind`, `tool`, `args`, `text`, `reward`, `finished`.

## Open / deferred

1. **Regex extraction of vitals from free text.** I'm proposing a small set of regex (`HR \d+`, `BP \d+/\d+`, `age \d+`, etc.). It'll get most cases. For anything missed, placeholders kick in. If the agent classifies based mostly on chief complaint anyway, this is fine.
2. **Manual patient ID format.** `manual-0`, `manual-1`, … per run. Trivial but worth fixing in spec.
3. **Trajectory for manual patients.** A single step at offset 0 with `state="As reported by operator"` and `requires_intervention=False`. `wait()` returns no alerts for them — they don't deteriorate. (Fine for v2: deterioration is a CSV-row feature.)
4. **Should manual-single use a different tool surface?** Currently no — same 7 tools. The agent might call `wait()` on a manual patient and get nothing back, which is a small UX wart but not a blocker.
5. **Error handling on manual-multi submit:** if any free text is empty, block submit with inline validation. Backend should also defend (skip empty manual entries with a warning in stdout).

## Risks

- **Free-text regex misses things.** Agent might classify based on placeholder vitals when the user's text included them in non-standard form ("heart rate one hundred and four"). Mitigation: tooltip says "if vitals matter, use the structured fields."
- **Composite=null breaks the homepage's `caseProgress` calc** (it does `Math.round(score * 100)`). Need to guard with `score ?? 0` or render a different decision card variant when null.
- **`/api/triage/preview` adds a Python spawn per dropdown change.** Cache by `(taskId, batchSize)` in runtime memory; subsequent picks are instant. First pick of a new size is ~500ms.
- **Batch size > 5 doesn't guarantee KTAS diversity.** `select_diverse_batch` picks one per level; for n>5 the second-pass fills from larger pools (already implemented). For n=10 you might get two KTAS-3s. Acceptable — the diversity guarantee is "≥1 of each level when n≥5," weaker for n>5.

## Training the agentic loop

The env is **trainable** by construction — it exposes deterministic train/test
batches, the reward signal is dense per-assignment plus a terminal composite,
and episodes are short so iteration is fast. The repo now includes a local
SkyRL compatibility shim, but the actual model update still requires external
CUDA compute.

### What you need

1. **Compute.** A single H100 (80GB) for ~12–24 hours, or 2–4 for a few hours.
   Hackathon-team scale is around $200–$1500 of cloud compute for one
   meaningful run. The env's per-episode cost (£0.005 at gpt-5-mini) is
   irrelevant during training because you're using a *local* base model, not
   the OpenAI API — the LLM lives on your GPU.
2. **A base model.** 3B–7B instruction-tuned, with tool-use baked in. Options:
   - `Qwen/Qwen2.5-7B-Instruct` — strong tool-use, 7B is the sweet spot for
     single-GPU.
   - `meta-llama/Llama-3.2-3B-Instruct` — smaller, faster iteration.
   - `deepseek-ai/DeepSeek-R1-Distill-Qwen-7B` — reasoning variant, may
     overthink the simple classification but worth testing.
3. **A training framework.** OpenReward's docs list four integrations:
   - **Tinker** (Anthropic) — most polished for LLM tool-use. Probably the
     easiest to start.
   - **SkyRL** (Berkeley, open source) — GRPO-based, designed for long-horizon
     agentic envs. Good for academic work.
   - **Slime** (TogetherAI) — distributed; useful if you have multiple GPUs.
   - **Miles** (Tencent) — same pattern, less common in the West.

### What the loop looks like

The standard recipe for tool-use RL on this kind of env:

```
for iteration in range(N):                                     # ~100 iterations
    tasks = sample_batch(env.list_tasks("train"), k=32)        # 32 tasks per iter
    rollouts = []
    for task in tasks:
        for _ in range(rollouts_per_task=8):                   # GRPO group size
            traj = run_episode(model, env, task)               # tool-use loop
            rollouts.append(traj)
    advantages = group_relative_advantage(rollouts)            # GRPO: per-group baseline
    loss = -mean(advantage * log_prob(action | state))         # policy gradient
    optimizer.step(loss)
    if iteration % 10 == 0:
        eval_on(env.list_tasks("test"))                        # held-out
        save_checkpoint()
```

Concrete command shape for SkyRL:

```bash
skyrl train \
  --env triagebatchenv \
  --env-url http://127.0.0.1:8080 \
  --base-model Qwen/Qwen2.5-7B-Instruct \
  --algorithm grpo \
  --group-size 8 \
  --batch-tasks 32 \
  --iterations 200 \
  --eval-every 20 \
  --output-dir ./training-run-001
```

In this repo, `bin/skyrl` maps that short command onto SkyRL's real Python
module entrypoint by generating Parquet prompt datasets and registering a
SkyRL-Gym adapter for `triagebatchenv`. The `--env-url` argument is retained for
the OpenReward-compatible command shape, but SkyRL rollouts use the local
SkyRL-Gym adapter. On a non-CUDA machine the shim stops after dataset
preparation; run the same command on a CUDA node to launch GRPO.

### Why this env is well-shaped for RL

Three properties matter:

1. **Episodes are short.** 5–25 turns. RL on long-horizon agents (1000+ turns)
   is hard because credit assignment is brutal — you don't know which of
   1000 actions caused the bad outcome. v2's terminator-on-batch-complete
   gives a clear signal at episode end.
2. **Reward is dense AND sparse.** Per-tool dense rewards (exact-match +1.0,
   under-triage -0.5, etc.) give immediate gradient signal. The sparse
   terminal composite (with ordering bonus) gives the long-horizon signal.
   GRPO loves both.
3. **Ground truth is exact.** No reward-model noise from an LLM judge. Every
   training signal is a deterministic function of `KTAS_expert`. This makes
   the gradient cleaner and the loss curves more interpretable.

### What to expect

- A 3B base model trained on this env for 12 hours on one H100 will plausibly
  beat the gpt-5-mini baseline (which is already at 1.0 composite on at
  least seed 42). The interesting metric is *generalisation* — does it
  generalise from train batches to held-out test batches?
- For the dataset's full 1267 rows: split into ~1000 train, ~267 test. Build
  a `select_diverse_batch(seed, n, split="train"|"test")` variant that picks
  only from the right pool. (One-hour change to `dataset.py`.)
- Mistriage-rate baseline from the source paper: 14.7% nurse error rate. A
  trained 3B agent that beats that is publishable.

### What this spec doesn't address

- The actual training infrastructure (Dockerfile, GPU provisioning, framework
  config). The command bridge exists, but CUDA provisioning is still separate.
- Model serving (after training, you'd serve the trained checkpoint via vLLM
  or similar — separate infra).
- Iteration tooling (tensorboard, eval dashboards). Frameworks ship their own.

The point of this section: when someone asks "is this env trainable?" the
answer is yes, with the recipe above, and we've shaped the rewards, episode
length, and ground truth specifically to make that recipe work.

## Implementation Checklist

Tick as items land on `feat/multi-mode-input`.

### Python — schema + helpers

- [ ] `world_state.py`: `Patient.ground_truth_ktas` becomes `KtasLevel | None`
- [ ] `dataset.py`: new `synthesize_manual_patient(payload, idx) -> Patient` with regex extraction + placeholders fallback
- [ ] `scoring.py`: `AssignmentResult.truth_level` becomes `KtasLevel | None`, `score_batch` filters unscored, returns `composite=None` when zero scored

### Python — env + harness

- [ ] `triage_env.py`: `_build_world` reads `task_spec.manual_patients`, appends with id `manual-<idx>`
- [ ] `triage_env.py`: `_assign` records `truth=None` / `reward=None` for unscored manual patients
- [ ] `triage_env.py`: tool docstrings note unscored manual patients
- [ ] `triage_env.py`: respects `n` parameter for variable batch size when `row_indices` not provided
- [ ] `harness.py`: new `--task-spec-file <path>` flag (alternative to `--task <id>`)
- [ ] `harness.py`: new `--preview <taskId>` (with optional `--n <N>`) prints patient preview JSON and exits
- [ ] `harness.py`: `result.json` gains `scored_count`, `manual_count`, `per_patient_assignments`, `evaluation_summary`

### Python — tests

- [ ] `tests/test_dataset.py`: `synthesize_manual_patient` covers empty / structured / mixed-text / regex-extractable inputs
- [ ] `tests/test_scoring.py`: mixed scored/unscored, all-unscored returns `composite=None`, ordering bonus only over scored
- [ ] `tests/test_smoke.py`: env builds with `manual_patients`, exposes `ground_truth_ktas=None`

### TypeScript — types + runtime

- [ ] `lib/triage/types.ts`: `RunMode`, `ManualPatient`, `PatientPreview`, widened `RunRequest`
- [ ] `lib/triage/runtime.ts`: `previewBatch(taskId, batchSize) -> PatientPreview[]` (cached)
- [ ] `lib/triage/runtime.ts`: `runLiveEpisode` accepts `RunRequest`, branches by mode, writes temp task-spec JSON, calls `harness --task-spec-file`

### Next.js — API routes

- [ ] `app/api/triage/preview/route.ts`: new `POST` returning `{patients: PatientPreview[]}`
- [ ] `app/api/triage/run/route.ts`: body widened to per-mode shape, validates per mode

### Next.js — components

- [ ] `components/triage/manual-patient-card.tsx`: free-text textarea + collapsible structured fields + optional `expected_ktas` dropdown + `[×]` remove (when applicable)
- [ ] `components/triage/batch-preview.tsx`: renders `PatientPreview[]` in a small table; fetches on `(taskId, batchSize)` change
- [ ] `components/triage/input-panel.tsx`: tabs at top, per-mode form, batch size preset chips, intake-note checkbox+textarea for Option C
- [ ] `app/page.tsx`: `handleSubmit` accepts `RunRequest`, passes through to `/api/triage/run`
- [ ] `app/episodes/[id]/page.tsx`: new Evaluation card rendering `evaluation_summary` + per-patient truth-vs-agent table; `(unscored)` badges on manual rows; nurse mistriage citation

### Smoke + ship

- [ ] `pytest`: all green
- [ ] `ruff check src/ tests/`: clean
- [ ] `npx tsc --noEmit`: clean
- [ ] `npm run lint`: clean
- [ ] Test batch mode: end-to-end, all sizes (3/5/8/10)
- [ ] Test batch + intake note (Option C): runs with 6 patients, scored over 5
- [ ] Manual single without `expected_ktas`: runs, `composite=null`, classification visible
- [ ] Manual single with `expected_ktas`: scored against expectation
- [ ] Manual multi up to 8: runs, scored portion correct
- [ ] Episode detail page renders evaluation card
- [ ] `git push` to `feat/multi-mode-input`

## Decision

Spec ready for review. Defaults applied (manual-multi cap 8, ground truth
visible in preview, branch-then-implement).

— authored 2026-04-25
— evaluation summary + manual-patient `expected_ktas` + training section
  added 2026-04-25 in response to brainstorm Q3 follow-up
— implementation checklist added 2026-04-25
