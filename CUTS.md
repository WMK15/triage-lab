# Cuts — what was scoped out and why

## Deliberately not run (budget / time)

- **Full 6-hour demo run with all 10 patients dispositioned.** Smoke test ran
  30 turns at £0.0195. A full run hitting the long-horizon judging criterion
  (~1500 tool calls) costs ~£1–2 per episode and 10–20 min wall clock. Run via
  `just serve-env` + `just run-harness` (raise `--max-turns` to 2000+).

- **Leaderboard (3 seeds × 2–3 models).** ~£15–25 across all combinations.
  Harness `--model` flag takes any model in `cost_tracker.PRICE_TABLE`. Once
  budget is in place, run e.g.:
  `for s in 1 2 3; do just run-harness --model gpt-5-mini; done`, repeat for
  `claude-haiku-4-5` and `claude-sonnet-4-6`.

- **Slide deck.** Outside the repo. Five-slide outline lives in
  `prompts/01-architect.md` § Phase 3 (thesis · env overview · three pressure
  points · leaderboard · demo trajectory).

- **Demo trajectory narration.** Pick a clean leaderboard run; write a 60s
  walkthrough naming moments where long-horizon reasoning succeeded or failed.

## Implementation cuts (sub-agent follow-ups)

- **Patient-id UX in the agent prompt.** The prompt lists patients as
  "Patient E (case-corneal-abrasion) — arriving at +5 min". gpt-5-mini in
  the smoke test latched onto the letter alias and called
  `examine(patient_id="E")` instead of the case-id slug, eating the `−0.05`
  penalty repeatedly. Either drop the letter alias from the prompt or add a
  patient-id lookup helper.

- **No persistent event queue.** `WorldState.event_queue` exists but is
  always empty; deferred semantics are computed inline inside `wait()`.
  Sufficient for the demo. A richer env would pre-load nurse alerts,
  family interruptions, and consultant call-backs scheduled at specific sim
  times.

- **Disposition correctness is coarse.** `_ACCEPTABLE_DISPOSITIONS` in
  `triage_env.py` maps `narrative_role` → set of acceptable dispositions.
  Real ED practice is more nuanced (e.g. observe-with-reassessment is often
  defensible for borderline cases). Current scheme accepts `observe` broadly
  to cover that band.

- **Episode detail UI is plain.** `app/episodes/[id]/page.tsx` lists the raw
  trajectory event sequence (capped at 200 events). A polished demo would
  render per-patient lanes, key decision points, and a final scoreboard.

## Open hygiene

- The leaked `OPENAI_API_KEY` and `OPENREWARD_API_KEY` are still in
  `triage-nurse/.env` (gitignored, copied from `spike/.env` before the spike
  was deleted). Rotate before sharing the repo beyond the immediate team.
