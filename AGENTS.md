<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Triage Lab — Agent Guide

This file is the source of truth for any AI / coding agent working on this repo. `CLAUDE.md` is a symlink to it.

## What this project is

Triage Lab is an **interactive decision environment**, not a chat app. A user describes a scenario, the agent reasons step-by-step, produces a structured decision, and offers a fixed set of standardised next-step actions. The aesthetic is clinical / professional (think medical triage console or operations dashboard), not playful.

The agent is currently **mocked** — `lib/triage/mock-agent.ts` produces deterministic responses keyed off an `EnvironmentType` (`general`, `planning`, `clinical`, `compliance`, `incident`). There is no backend.

## Tech stack

- **Next.js 16** (App Router, Turbopack). `node_modules/next/dist/docs/` is canonical — read it before touching framework APIs. Some conventions differ from older Next.js; do not assume from training data.
- **React 19**, TypeScript strict mode.
- **Tailwind CSS v4** with `@theme inline` design tokens defined in `app/globals.css`.
- **shadcn/ui** components live in `components/ui/`. They use the unified `radix-ui` package (not the legacy `@radix-ui/react-*` packages) and are owned source. Add new components with `npx shadcn@4.4.0 add <name>` (the `latest` tag has been flaky; pin to 4.4.0).
- **lucide-react** for icons.
- No backend, no DB, no auth.

## Repo layout

```
app/
  globals.css       — design tokens (foundation + domain) and animations
  layout.tsx        — Inter font, root html/body
  page.tsx          — triage page shell (client component)
components/
  ui/               — shadcn primitives (do not edit unless extending the system)
  triage/           — feature components (input panel, message types, status bar)
lib/
  triage/
    types.ts        — Message, Decision, Action, ThinkingStep, EnvironmentType
    mock-agent.ts   — deterministic mock response generator
  utils.ts          — cn() helper from shadcn
```

## Design system

**Palette is pastel-green, clinical.** Every colour flows through CSS variables in `app/globals.css`. Two layers of tokens:

- **Foundation tokens** (consumed by shadcn primitives): `--background`, `--card`, `--primary`, `--muted`, `--border`, etc. Mapped to Tailwind classes via `@theme inline` (e.g. `bg-background`, `text-foreground`, `border-border`).
- **Domain tokens** (triage-specific surfaces): `--decision-bg/border/text`, `--thinking-bg/border/text`, `--accent`, `--accent-hover`, `--accent-foreground`, `--surface`, `--surface-secondary`, `--text-primary/secondary/muted`, `--warning-*`, `--error-*`.

Three semantic regions in agent responses, each with its own visual language:

| Region   | Purpose                    | Tokens                                                         |
| -------- | -------------------------- | -------------------------------------------------------------- |
| Thinking | Internal reasoning (muted) | `--thinking-bg/border/text` — calm, smaller text, collapsible  |
| Decision | Structured output          | `--decision-bg/border/text` — pale green, headline + rationale |
| Actions  | Standardised next steps    | `--surface-secondary` default, `--accent` when selected        |

**Typography:** Inter via `next/font/google`, bound to `--font-sans`. No playful fonts. Base 14–16 px, headings 18–24 px, thinking text slightly smaller.

**Shape:** `rounded-2xl` for surfaces, `shadow-sm` only — no heavy shadows or glassmorphism.

**Layout:** centered column, `max-w-3xl`, generous whitespace.

## Conventions

- **Server vs. client components** — default to server components; add `"use client"` only when interactivity is required. The triage page is client because of state; static sub-pieces (`DecisionCard`, `UserMessage`) could leave the client tree if they're ever lifted out.
- **shadcn primitives first.** Reach for `Button`, `Card`, `Textarea`, `Select`, `Collapsible`, `Badge`, `Separator`, `Label` before hand-rolling anything. If a primitive needs project-specific styling, wrap it in `components/triage/` — don't fork the file in `components/ui/`.
- **Tokens over hex.** New surfaces should use existing tokens. If a new colour is genuinely needed, add a domain token in `globals.css` rather than embedding a hex literal in a component.
- **State stays minimal.** All page state lives in `app/page.tsx` (`messages`, `isRunning`). Child components are dumb and accept callbacks.
- **Mock agent stays pure.** `generateAgentResponse(scenario, environment)` must be deterministic given the same input. Keep async / timing concerns in the page.

## Adding a new environment

1. Add the value to `EnvironmentType` in `lib/triage/types.ts`.
2. Add a profile to `profiles` in `lib/triage/mock-agent.ts` with thinking steps, a decision, and 4 actions.
3. Add an entry to `ENVIRONMENT_OPTIONS` in the same file (label + hint).

No UI changes are needed — the select dropdown picks them up automatically.

## Adding a new shadcn component

```bash
npx shadcn@4.4.0 add <name>
```

The init has already chosen the radix base, the `new-york` style, and the project alias paths. If `latest` errors with a missing version, pin to `4.4.0` as above.

## Things to avoid

- **Don't** add backwards-compat shims, dead code, or "in case we need it later" abstractions. Bug fixes shouldn't drag along refactors.
- **Don't** use raw `<button>` / `<input>` when a shadcn primitive exists.
- **Don't** style with arbitrary Tailwind palette classes (`bg-zinc-100`, `text-emerald-700`) for foundational surfaces — go through the tokens.
- **Don't** treat empty / loading / error states as afterthoughts — they're shipped surfaces.
- **Don't** introduce a backend or persistent storage without an explicit ask. The current scope is a simulation UI.

## Running

```bash
npm run dev      # Next.js dev server (port 3000)
npm run build    # Production build
npm run lint     # ESLint
```
