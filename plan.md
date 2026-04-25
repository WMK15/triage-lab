# Triage Lab — Plan

> Forward-looking roadmap. For project conventions and design system, see `AGENTS.md`. For setup and run, see `README.md`.

## Where we are

A working UI for an interactive triage / decision environment. The agent is mocked: deterministic responses keyed off `EnvironmentType` (`general`, `planning`, `clinical`, `compliance`, `incident`). Each scenario produces a thinking chain, a structured decision (headline + rationale + severity + case progress), and four standardised next-step actions. Committing an action locks the choice, dims unchosen options, surfaces an acknowledgement strip, and bumps case progress.

UI is in production-ish shape: shadcn/ui primitives throughout, pastel-green clinical palette, Source Serif 4 (voice) + Inter (chrome), wave-loader for the thinking state, and an empty/loading/committed/error state path on every surface.

## Open questions

These need answers before further work commits to a direction.

1. **Real agent vs. simulator.** Is the goal to ship a real LLM-backed triage agent, or to keep this as a designed reference UI that other teams plug into? The answer drives most of what follows.
2. **Multi-step cases.** Right now a single scenario produces a single decision. Real triage usually has follow-ups (the action is taken, new state arrives, the agent reasons again). Worth modelling? If so, the data shape is already mostly there; what's missing is the loop.
3. **Persistence.** Cases currently live only in component state and disappear on refresh. Are scenarios meant to survive a session? If so we need storage + a case index.
4. **Audit trail.** Triage decisions in regulated environments require a log: who-asked-what, what-the-agent-saw, what-was-chosen, when. Is that in scope?

## Near-term (2–4 days of focused work)

Each item is independently shippable. Pick based on the answers above.

### A — Real agent integration

Replace `generateAgentResponse` with a streamed LLM call. Keep the `AgentResponse` shape so the UI doesn't move.

- Use the AI SDK (`@ai-sdk/anthropic` or `ai-gateway`) with a structured-output schema matching `Decision` + `Action[]` + `ThinkingStep[]`.
- Stream the thinking chain into the panel so the wave loader gives way to incremental steps as they arrive.
- Keep the mock available as a fallback (`?mock=1`) for design work and offline dev.
- Move from `app/page.tsx` orchestration to a Server Action or Route Handler so the API key never reaches the client.

Risk: structured streaming is finicky. Plan a fallback to non-streaming if the structured schema doesn't validate mid-stream.

### B — Multi-step cases

Once an action is committed, the agent should be able to react to that commitment.

- Extend the message list to allow chained agent responses on the same case.
- After commit, optionally trigger a follow-up `generateAgentResponse` with the chosen action as additional context, producing a new agent message.
- Add a "case closed" terminal state when `caseProgress === 100`.

### C — Case history

Cases survive across sessions and can be re-opened.

- Persist `messages[]` keyed by case id in localStorage (cheap) or a real DB (proper).
- Sidebar or `/cases` route listing recent cases with severity + last action.
- Routing: `/case/[id]` for deep-linkable cases.

### D — Audit log

Every decision and committed action emits an audit event with timestamp, scenario hash, environment, severity, decision headline, chosen action.

- Initially: append to a server-side log (file or simple table).
- Surface a "Show audit trail" toggle on each agent message that reveals the underlying record.

## Medium-term (1–2 weeks)

- **Keyboard shortcuts.** Number keys (1–4) commit the corresponding action. `Cmd+Enter` runs the simulation. Spec'd in the original brief as optional; deferred.
- **Per-environment customisation.** Today every environment has the same 4-action shape. Some (incident) might want 6 actions or sub-categories; some (general) could have just 2.
- **Risk score visualisation.** Status bar currently shows a single severity badge. A small sparkline of severity-over-time across cases in the session would help the "operations console" feel.
- **Export.** PDF / Markdown export of a closed case for handover.
- **Embedding.** Allow the triage panel to be mounted inside a host application (case-management system, ticketing tool) via `<iframe>` or React component package.

## Things explicitly out of scope

- Multi-tenant auth and user accounts — premature until there's a real backend.
- Real-time multi-user collaboration on a case — not asked for, would change the data model significantly.
- Offline-first / PWA — possible later but not a current need.

## Dependencies and risks

| Item                           | Risk                                                                 | Mitigation                                                                  |
| ------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| LLM cost on heavy use          | Streaming + reasoning chains are expensive per scenario              | Cache by `(scenario, environment)` hash; let the mock cover demos           |
| Structured output drift        | Schema mismatch between agent output and UI types                    | Zod schema + JSON-schema fallback; validate on the server before UI consume |
| Severity inference correctness | Keyword matching is naive; a real agent will need clearer signals    | Move severity into the decision schema rather than inferring after the fact |
| Audit-log compliance           | "Audit log" can mean very different things by industry / regulation  | Resolve scope before designing — see open question 4                        |

## What "done" looks like (current iteration)

- ✅ All UI states designed and shipped (input, thinking, decision, actions, committed, empty)
- ✅ shadcn/ui primitives only — no raw `<button>` / `<input>` for foundational controls
- ✅ Tokens for every colour; no embedded hex literals in components
- ✅ TypeScript strict, `tsc --noEmit` clean
- ⏳ A choice between A / B / C / D as the next focused work block

Decide on (1)–(4) above and pick the next near-term block. Defaults if unspecified: **A then B**, treating the rest as later.
