# Triage Lab

An interactive decision environment, inspired by clinical triage. A user describes a scenario, an AI agent reasons step-by-step, returns a structured decision, and offers a fixed set of standardised next-step actions. The aesthetic is professional and calm — closer to a triage console or operations dashboard than to a chatbot.

The agent is currently **mocked** — `lib/triage/mock-agent.ts` produces deterministic responses keyed off an `EnvironmentType`. There is no backend.

## Stack

- **Next.js 16** (App Router, Turbopack)
- **React 19**, TypeScript strict mode
- **Tailwind CSS v4** with `@theme inline` design tokens
- **shadcn/ui** primitives (radix base, `new-york` style) — owned source under `components/ui/`
- **lucide-react** icons
- **next/font/google** — Inter (sans) + Source Serif 4 (serif "voice")

## Run

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

Try the five environments — `general`, `planning`, `clinical`, `compliance`, `incident`. Each produces a different reasoning chain, decision, and action set.

```bash
npm run build   # production build
npm run lint    # ESLint
```

## Anatomy of an agent response

Every agent message has three semantic regions, each with its own visual language:

| Region   | Purpose                       | Surface                                                  |
| -------- | ----------------------------- | -------------------------------------------------------- |
| Thinking | Internal reasoning (muted)    | Collapsible panel, closed by default, wave loader        |
| Decision | Structured output             | Pale-green card with severity badge + headline + rationale |
| Actions  | Standardised next steps       | 2-col grid; click commits the choice and bumps progress  |

Selecting an action is **immutable** — once committed, the choice is locked, the unchosen buttons dim, an acknowledgement strip appears, and the case progress meter advances.

## Design system

Pastel-green clinical palette. Two layers of tokens in `app/globals.css`:

- **Foundation tokens** consumed by shadcn primitives: `--background`, `--card`, `--primary`, `--muted`, `--border`, `--ring`, `--radius`.
- **Domain tokens** for triage surfaces: `--decision-bg/border/text`, `--thinking-bg/border/text`, `--accent`, `--accent-hover`, `--surface`, `--surface-secondary`, plus warning/error pairs.

Typography pairs **Source Serif 4** (the "voice" surfaces — page title, decision headline, scenario echo) with **Inter** (UI chrome).

Layout is a centered column at `max-w-3xl`, `rounded-2xl` surfaces, `shadow-sm` only — no heavy shadows or glassmorphism.

## Repo layout

```
app/
  globals.css            — design tokens + animations
  layout.tsx             — fonts, root html/body
  page.tsx               — page shell, all state
components/
  ui/                    — shadcn primitives (do not edit)
  triage/
    input-panel.tsx      — Textarea + env Select + Run button
    user-message.tsx     — right-aligned scenario bubble
    agent-message.tsx    — composes the three sections below
    thinking-panel.tsx   — Collapsible reasoning + wave loader
    decision-card.tsx    — pale-green decision container
    action-choices.tsx   — selectable / committed actions
    case-status-bar.tsx  — progress + severity + count
    severity-badge.tsx
    empty-state.tsx
lib/
  triage/
    types.ts             — Message, Decision, Action, ThinkingStep, EnvironmentType
    mock-agent.ts        — generateAgentResponse + generateActionOutcome
  utils.ts               — cn() helper
AGENTS.md                — agent-facing project guide
CLAUDE.md                — symlink → AGENTS.md
plan.md                  — roadmap & open questions
```

## Adding a new environment

1. Add the value to `EnvironmentType` in `lib/triage/types.ts`.
2. Add a profile to `profiles` in `lib/triage/mock-agent.ts` — thinking steps, decision (headline + rationale + severity + caseProgress), 4 actions.
3. Add an entry to `ENVIRONMENT_OPTIONS` (label + hint).

The select dropdown picks it up automatically.

## License

Private project. No license assigned.
