# Triage Lab

Triage Lab is a clinical-style triage console that now connects the frontend app to a real local backend runner.

The app flow is:

1. enter a freeform intake note in `/`
2. get lightweight dataset-backed case suggestions from `dataset/emergency-triage.csv`
3. run a live baseline case through the Python `triage-nurse` backend
4. render the resulting rollout back into the app as thinking, decision, and follow-up actions
5. inspect archived rollouts in `/episodes`

The product is still intentionally procedural rather than chat-like, but it is no longer just a mocked shell.

## Current status

The system is now a hybrid Next.js + Python local stack.

- the app frontend lives in `app/` and `components/triage/`
- the live backend runner lives in `triage-nurse/`
- the root `dataset/` folder provides intake-search substrate
- episodes are written to `triage-nurse/runs/<episode_id>/`
- `/episodes` reads those rollout files directly

Still true:

- there is no auth
- there is no database
- there is no streaming model loop yet
- the Python harness still runs a deterministic baseline rather than a fully adaptive agent

## What the app does now

### `/`

The main page is now connected to the live backend.

- the textarea accepts a freeform patient/intake note
- the app calls `POST /api/triage/intake` to find likely matching cases from the dataset
- the best-matching case is selected for the run
- the app calls `POST /api/triage/run`
- the backend ensures the Python env server is running, executes the harness, and returns an `episodeId`
- the app then calls `GET /api/episodes/[id]` and renders the result into the existing triage UI

The user note is passed through to the Python side as an operator note and appears in the rollout.

### `/episodes`

The episodes page lists archived runs from `triage-nurse/runs/` and shows:

- episode id
- task id
- score
- disposition
- summary
- event count

## Architecture

### Next.js side

Important app routes:

- `app/page.tsx` — live intake and result rendering
- `app/episodes/page.tsx` — rollout archive view
- `app/api/triage/intake/route.ts` — dataset-backed complaint matching
- `app/api/triage/tasks/route.ts` — available live cases
- `app/api/triage/run/route.ts` — starts a live run
- `app/api/episodes/[id]/route.ts` — returns a single episode payload

Shared server-side runtime:

- `lib/triage/runtime.ts`

This module is the bridge between Next.js and `triage-nurse`. It:

- reads case files
- parses the root dataset
- suggests cases for freeform intake text
- auto-starts the Python env server if needed
- executes the Python harness
- reads episode files back for the UI

### Python side

`triage-nurse/` is a separate `uv`-managed Python project.

Important files:

- `src/triage_nurse/triage_env.py` — OpenReward environment with the current minimal live tools
- `src/triage_nurse/harness.py` — deterministic baseline runner
- `scripts/run_demo.py` — batch demo runner across available tasks
- `cases/*.json` — hand-authored live cases used by the backend env

Current live tool path includes:

- `write`
- `reflect`
- `read`
- `examine`
- `order`
- `wait`
- `submit_handoff`

The note from the frontend is injected into the harness as `--note`, written into the chart, reflected into working notes, and persisted in rollout files.

## Dataset usage

The root dataset is:

- `dataset/emergency-triage.csv`

This file is not just complaint substrate. It contains the labels we should use
for real triage rewards and OpenReward scoring.

Important fields from `dataset/README.md`:

- `KTAS_expert` — ground-truth expert triage level
- `Disposition` — ground-truth route/outcome
- `mistriage` — whether the nurse was correct, over-triaged, or under-triaged
- `Error_group` — category of the triage mistake
- `Diagnosis in ED` — useful as diagnosis/outcome context, not as a point-of-triage input signal

Current usage today:

- complaint and diagnosis text are used for lightweight intake matching in the app
- hand-authored live cases in `triage-nurse/cases/*.json` now carry some dataset-aligned metadata such as `ktas_expert`, `mistriage_risk`, and `error_group_hint`

Intended reward/scoring direction:

- reward correct disposition against dataset-grounded disposition labels
- reward appropriate acuity against `KTAS_expert`
- penalize under-triage more heavily than over-triage using `mistriage`
- use `Error_group` to explain or classify why a rollout failed

This file is not used as a model-training pipeline here. The app currently
searches complaint/diagnosis text from the CSV and returns the closest
candidate cases so the operator’s freeform input can steer the selected live
case.

That means the app is now complaint-driven at intake time, but the actual executable cases still come from:

- `triage-nurse/cases/*.json`

## UI model

The UI still renders three semantic regions:

| Region | Purpose | UI treatment |
| --- | --- | --- |
| Thinking | Tool-by-tool trace from the rollout | Muted collapsible panel |
| Decision | Final disposition + summary | Pale green decision card |
| Actions | Follow-up actions derived from the result | Selectable action grid |

## Run locally

### App

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Python backend

`triage-nurse` uses `uv`.

```bash
cd triage-nurse
/home/waseef/.local/bin/uv venv --python 3.11
/home/waseef/.local/bin/uv pip install -e ".[dev]"
```

You do not need to start the env server manually for normal app usage. The app API will auto-start it if needed.

Manual backend commands are still useful:

```bash
cd triage-nurse
/home/waseef/.local/bin/uv run pytest tests
/home/waseef/.local/bin/uv run ruff check src tests
/home/waseef/.local/bin/uv run python -m triage_nurse.triage_env
/home/waseef/.local/bin/uv run python -m triage_nurse.harness --task patient-a-nstemi --note "silent deterioration concern"
/home/waseef/.local/bin/uv run python scripts/run_demo.py
```

## Repo layout

```text
app/
  api/
    triage/
      intake/route.ts      dataset-backed intake matching
      run/route.ts         launch live Python run
      tasks/route.ts       list live case options
    episodes/[id]/route.ts fetch single episode payload
  episodes/page.tsx        rollout archive UI
  globals.css              design tokens and animations
  layout.tsx               root layout and font setup
  page.tsx                 live intake page
components/
  ui/                      shadcn primitives
  triage/                  feature UI components
dataset/
  emergency-triage.csv     root intake-matching dataset
  README.md                dataset documentation
lib/
  triage/
    types.ts               UI/domain types
    mock-agent.ts          old mock profiles, still partly retained
    runtime.ts             Next.js <-> Python bridge and dataset helpers
  utils.ts                 shared utilities
triage-nurse/
  cases/                   executable live cases
  runs/                    archived rollout outputs
  src/triage_nurse/        env + harness code
```

## Known limitations

- the dataset match is lightweight text overlap, not semantic retrieval
- the selected live case is still chosen from authored JSON cases, not dynamically generated from the CSV row
- the backend run is still deterministic
- the app does not yet ask dynamic follow-up questions
- the frontend note influences the recorded run context, but not a true model-driven reasoning policy yet
- the current reward is still a simplified case-local check, not a full dataset-grounded OpenReward score over `KTAS_expert`, `Disposition`, `mistriage`, and `Error_group`

## Next sensible steps

1. replace deterministic harness logic with a real model/tool loop
2. let the app keep a persistent live session instead of one-shot runs
3. generate temporary executable cases directly from matched dataset rows
4. add follow-up questioning when intake ambiguity is high

## License

Private project. No license assigned.
