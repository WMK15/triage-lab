# Contributing to Triage Lab

Thanks for contributing.

Triage Lab is an open-source triage simulation project with a Next.js frontend and a Python OpenReward backend. Good contributions are usually small, focused, and easy to review.

## Before you start

1. Read `README.md` for the main project overview.
2. Read `triage-nurse/README.md` if your change touches the Python environment or harness.
3. Read `dataset/README.md` if your change depends on dataset fields or assumptions.

## Development setup

### Frontend

```bash
npm install
npm run dev
```

### Backend

```bash
cd triage-nurse
uv venv --python 3.11
uv pip install -e ".[dev]"
cp .env.example .env
```

Set one provider key in `triage-nurse/.env`:

- `OPENAI_API_KEY`, or
- `ANTHROPIC_API_KEY`

## Useful commands

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

## Contribution guidelines

1. Keep changes focused on a single problem or improvement.
2. Prefer the smallest correct change over broad refactors.
3. Match the existing UI and design token system instead of introducing one-off styles.
4. Use existing shadcn/ui primitives before adding custom components.
5. Do not commit secrets, `.env` files, generated local artifacts, or credentials.
6. Update documentation when behavior, setup, or commands change.

## Pull requests

Before opening a PR:

1. Run the relevant checks for the area you changed.
2. Verify the affected workflow manually if you changed product behavior.
3. Keep the PR description clear about what changed and why.

Useful PR content:

1. Short summary
2. Why the change was needed
3. Screenshots for UI changes
4. Notes on testing

## Areas that are especially helpful

- Documentation improvements
- UI polish and workflow clarity
- Evaluation and scoring improvements
- Better dataset handling and task generation
- Backend reliability and developer ergonomics

## Questions

If something is unclear, open an issue or propose the change in a PR with context.
