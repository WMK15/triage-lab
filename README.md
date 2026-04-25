# 🩺 Triage Lab

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-20232A?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![OpenReward](https://img.shields.io/badge/OpenReward-Environment-111827)](https://openreward.ai/WMK-15/triage-lab)

Triage Lab is an open-source interactive triage console for exploring clinical intake, structured prioritisation, and evaluation inside a simulated emergency-department workflow.

It combines a Next.js frontend with a Python OpenReward environment. A user can describe a case in free text, answer short follow-up questions, run test or manual batches, and inspect archived episode rollouts.

## Why this project is interesting

- It treats triage as a structured decision problem, not a generic chatbot interaction.
- It pairs a polished UI with a runnable evaluation environment and archived trajectories.
- It can be used as both a product prototype and an agent-evaluation sandbox.
- It is also published on OpenReward: [openreward.ai/WMK-15/triage-lab](https://openreward.ai/WMK-15/triage-lab)

The OpenReward listing is the public footprint of the environment side of the project: a compact benchmark surface for testing how well agents classify and reason under triage-style constraints.

## What it does

The app currently supports four workflows:

- `Chat triage`: collect a free-text intake, ask follow-up questions, and produce a structured triage recommendation.
- `Test batch`: run a predefined evaluation batch against the Python harness.
- `Manual single`: enter one patient directly and run the backend on that case.
- `Manual multi`: enter multiple patients and evaluate them as a batch.

Results are rendered in three distinct regions:

- `Thinking`: intermediate reasoning and tool activity.
- `Decision`: structured triage output with severity and progress.
- `Evaluation`: per-patient scoring and summary metrics when ground truth is available.

Past runs are stored under `triage-nurse/runs/` and can be browsed in `/episodes`.

## Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS v4
- shadcn/ui
- Python 3.11
- OpenReward

## Repository layout

```text
app/
  api/
    triage/
      assess/route.ts      follow-up question and triage assessment API
      intake/route.ts      intake suggestion API
      preview/route.ts     batch preview API
      run/route.ts         launch a backend episode
      tasks/route.ts       list available evaluation tasks
    episodes/[id]/route.ts episode payload API
  episodes/                archived runs UI
  page.tsx                 main triage console
components/
  triage/                  feature UI components
  ui/                      shadcn/ui primitives
dataset/                   triage reference data and documentation
lib/
  triage/
    runtime.ts             Next.js <-> Python bridge and dataset logic
    types.ts               shared app types
triage-nurse/
  src/triage_nurse/        OpenReward environment and harness
  tests/                   backend tests
  runs/                    archived episode outputs
```

## How it works

1. The frontend collects intake text or manual patient data.
2. The Next.js API layer matches the case against local reference datasets and/or builds a task spec.
3. The runtime ensures the Python environment server is available.
4. The harness runs an episode and writes rollout artifacts to `triage-nurse/runs/<episode_id>/`.
5. The UI reads those artifacts back and renders thinking steps, decisions, and evaluation details.

## Local development

### Requirements

- Node.js 20+
- npm
- Python 3.11
- `uv`

### Frontend setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Backend setup

```bash
cd triage-nurse
uv venv --python 3.11
uv pip install -e ".[dev]"
cp .env.example .env
```

Add one provider key to `triage-nurse/.env`:

- `OPENAI_API_KEY`, or
- `ANTHROPIC_API_KEY`

The app can auto-start the environment server when needed. If you want to run the backend directly during development:

```bash
cd triage-nurse
uv run python -m triage_nurse.triage_env
```

### Useful commands

Frontend:

```bash
npm run dev
npm run build
npm run lint
```

Backend:

```bash
cd triage-nurse
just install
just serve-env
just run-harness
just test
just lint
```

Equivalent `uv` commands are also available in `triage-nurse/README.md`.

## Data

The repository includes several local dataset files under `dataset/`.

- `combined-triage-reference.csv`
- `emergency-triage-cleaned.csv`
- `symptom-triage-reference.csv`
- `mimic-iv-ed-triage.csv`
- `mimic-iv-ed-diagnosis.csv`
- `mimic-iv-ed-edstays.csv`

These files are used for intake matching, task construction, and evaluation support. See `dataset/README.md` for schema notes, quality caveats, and field descriptions.

## Contributing

Triage Lab is open source, and contributions are welcome.

If you want to help, issues and pull requests that improve the product, environment, evaluation flow, or documentation are all useful.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup, workflow, and PR guidance.

When contributing:

1. Keep changes small and focused.
2. Prefer minimal abstractions over speculative structure.
3. Run the relevant frontend or backend checks before opening a PR.
4. Avoid committing secrets or local `.env` files.

## Current status

This is an active experimental codebase. The interface is polished enough to explore, but the project is still evolving in a few important ways:

- the environment and scoring loop are still experimental
- dataset matching is heuristic rather than semantic retrieval
- some parts of the developer and contribution experience are still evolving

## License

This project is licensed under the MIT License. See [`LICENSE`](./LICENSE).

## Acknowledgements

Built by SerHackers.dev, engineers at [Serac Group](https://serac-group.co.uk).
