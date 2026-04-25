# Role

You are the lead architect for a hackathon project: a long-horizon RL environment for the General Reasoning "Complex Worlds" hackathon (London, hosted with Entrepreneurs First and Air Street Capital). You're operating with a small team of parallel sub-agents that you will spawn and coordinate. Your job is to produce a buildable plan, then dispatch sub-agents to build it in parallel, then integrate their outputs.

# Project context

We're building a medical practice environment: an agent plays an ED physician on a 6-hour shift, navigating patients, nurses, consultants, and families that respond to the agent's behavior. The env runs on OpenReward's Open Reward Standard (ORS).

Constraints:
- **Token budget: under £50 total** for development and demo runs combined; per-episode cap configurable, default £2.
- **Timeline: ~2 days** of build.
- **Deliverable: env + custom harness** (no training).
- **Submission: env code, a baseline harness, a demo trajectory, and a leaderboard slide comparing 2-3 frontier models.**
- **Codebase home**: `triage-nurse/` subdirectory of the existing `triage-lab` repo, alongside the Next.js "Triage Lab" UI which will read rollout files and display them. Do not touch the Next.js tree (`app/`, `components/`, `lib/`, `package.json`, etc.).

Judging criteria (verbatim from the brief):
- Long horizon (hundreds-thousands of tool calls per episode)
- Capability tangent (requires capabilities that only emerge at long horizons — long-term planning, dealing with non-stationarity)
- Hard but tractable

# The thesis

After SWE is solved, the next frontier is agents operating inside human institutions. Medicine is the canonical hard case: high stakes, multi-actor, partially observable, with real ground truth. Existing medical evals test isolated capabilities. Ours tests *operating in a hospital* — the long-horizon judgment that holds together when other people, finite resources, and accumulating consequences all push against you at once.

Three load-bearing capability-tangent pressure points the env must require:
1. **Silent deterioration** — patients triaged early in the shift develop dangerous trajectories with no notification; only proactive reassessment catches them.
2. **Consultant cooperation as finite resource** — calling consultants reflexively early in the shift means none available when really needed.
3. **Information that's only useful in context built earlier** — a nursing observation at hour 2 only matters if recalled at hour 5.

# Architecture summary (verified against `openreward 0.1.106`)

OpenReward's ORS is **not** a gym-style framework. The env is an HTTP server of tools.

- `TriageEnv` subclasses `openreward.environments.Environment`. It holds all mutable world state on `self`.
- The 7 primitives are 7 `@tool`-decorated methods on `TriageEnv`: `speak`, `examine`, `order`, `read`, `write`, `wait`, `reflect`. Plus one terminator: `submit_handoff`.
- Each tool returns `ToolOutput(blocks=[TextBlock(...)], reward=float, finished=bool)`. Reward is per-call; the episode terminates when any tool returns `finished=True`.
- Final scoring runs **inside** the `submit_handoff` tool — there is no separate end-of-episode hook. (`teardown()` is cleanup only.)
- The agent loop runs separately, in `harness.py`. The harness uses the OpenAI or Anthropic SDK directly with `env.list_tools(format=...)` to get tool definitions and `session.call_tool(name, args)` to dispatch.
- `Server([TriageEnv]).run()` exposes the env on `http://0.0.0.0:8080`. Locally, `OpenReward(base_url="http://localhost:8080")` connects without auth.

Skeleton:

```python
from typing import Literal
from pydantic import BaseModel
from openreward.environments import Environment, JSONObject, Server, Split, TextBlock, ToolOutput, tool

class SpeakParams(BaseModel):
    actor_id: str
    utterance: str

class TriageEnv(Environment):
    def __init__(self, task_spec: JSONObject = {}, secrets: dict[str, str] = {}):
        super().__init__(task_spec)
        self.world = build_world_from_spec(task_spec)
        self.summary: list[str] = []
        self.cost = CostTracker(cap_gbp=task_spec.get("cap_gbp", 2.0))

    @classmethod
    def list_splits(cls): return [Split(name="test", type="test")]

    @classmethod
    def list_tasks(cls, split: str): return load_tasks(split)

    def get_prompt(self): return [TextBlock(type="text", text=SHIFT_BRIEF)]

    @tool
    def speak(self, params: SpeakParams) -> ToolOutput:
        reply = self.world.actors[params.actor_id].respond(params.utterance, self.cost)
        self.summary.append(f"speak({params.actor_id}): {params.utterance[:40]}")
        return ToolOutput(blocks=[TextBlock(type="text", text=reply)], reward=0.0, finished=False)
    # ... other tools ...
```

**Reward shaping.** Per-tool reward stays at 0.0 for most calls, with small immediate penalties for clearly wrong moves (`order(test, wrong_patient)` → −0.05). The full composite (70% deterministic outcomes + 30% LLM judge) is computed in `submit_handoff`, which returns the composite reward and `finished=True`.

**Cost tracking.** A single `CostTracker` is shared between the env (actor dialogue, judge) and the harness (agent decisions). Both call `tracker.record(provider, model, usage)` after every LLM call. Hitting the per-episode cap raises `CostCapExceeded` from the next attempted call.

**Tool format gotcha.** `env.list_tools(format="openai")` returns Responses-API shape (flat `{type, name, description, parameters}`); Chat Completions wants `{type, function: {...}}`. The harness either uses the Responses API directly or includes a translator. Pick one in the spec and document it.

**Long-horizon enforcement.** Each tool returns *real, varying state*: `examine` includes nursing observations queued during simulated time-since-last-call; `wait` advances the clock and returns events that fired; `read` and `write` interact with the patient chart; `reflect` is a free notepad write to `self.notes` with no state change. Static return values teach the agent to stop calling tools, so don't use them.

# Phase 1: Lock the spec

OpenReward verified by spike — no need to re-spike. Lock these decisions:

1. **Tool param schemas (Pydantic models).** Discrete actions (`disposition`, `consultant_specialty`, severity codes) use `Literal[...]` so the JSON Schema constrains the agent. Free-text params (`utterance`, `notes`) stay strings. Confirmed in spike: `Literal` propagates through to the tool definition and the model obeys.
2. **Tool format on the harness side.** Pick one of: (a) Chat Completions + translator helper, (b) Responses API direct. Document choice.
3. **Case template format.** JSON files under `cases/`. Required fields: `id`, `name` (de-identified), `presenting_complaint`, `vitals_initial`, `history`, `persona` (`stoic | anxious | minimizing | confused`), `true_diagnosis` (text + ICD-10), `trajectory` (list of `{time_offset_min, state, requires_intervention}`), `confirmatory_tests`, `red_herrings`, `narrative_role` (`routine | silent_deterioration | social_complication | crisis`). Write one fully worked example (suspected NSTEMI in stoic 58yo, gradual worsening over 90min) — this becomes the reference.
4. **Demo shift task spec.** A single JSON Task spec listing 8-12 case IDs with arrival times across the 6-hour shift. Must include: ≥1 silent deterioration, ≥1 multi-consultant case, ≥1 social complication, ≥1 routine. Write a one-paragraph narrative summary naming each patient and their narrative role.
5. **Token budget split.** £50 total. Suggested: £10 dev iteration, £15 demo runs, £25 leaderboard (3 seeds × 3 models). Per-episode cap defaults to £2; raised to £3 for leaderboard runs only.
6. **Spec doc.** Single markdown under 1500 words: tool param schemas (Pydantic models), case format with worked example, scoring rubric (deterministic + judge prompt), file structure, and the parallel work breakdown for Phase 2.

# Phase 2: Spawn parallel sub-agents

**Important.** The OpenReward env is one class; all `@tool` methods read/write `self.*`. A/B/D below are *helpers* called by C, not independent state-owning modules. C is the keystone integrator.

**Wave 1 — parallel, independent (no inter-dependencies):**

- **Sub-agent A — World state & patient logic.** Builds `world_state.py` (Pydantic dataclasses for `Patient`, `Nurse`, `Consultant`, `Family`, `EventQueue`) and `patient_logic.py` (pure `advance(patient, dt_min, seed) -> patient`). Driven by hardcoded test scripts. Scope: NO Environment subclass, NO `@tool`, NO LLM calls.

- **Sub-agent B — Actor logic.** Builds `actor_logic.py`: rule-based `nurse_speak`, `consultant_call`, `family_respond`. Templated outputs by default; LLM enrichment is an optional path that takes a cheap-model client (`gpt-5-mini`). Scope: pure functions over A's dataclasses; no state ownership.

- **Sub-agent D — Scoring & judge.** Builds `scoring.py` (deterministic, reads world state + episode summary, returns `ScoreBreakdown`) and `judge.py` (single async LLM call taking `self.summary` + `self.outcomes`, returns dimensional rubric scores). Scope: pure functions, no state mutation. Judge prompt + rubric included.

- **Sub-agent E — Cases & demo shift.** Authors 8-12 patient case JSONs in `cases/` plus `demo_shift.json` task spec. Uses A's worked example as reference. Scope: structured content only.

- **Sub-agent G — Cost tracker & harness shell.** Builds `cost_tracker.py` (shared module: `record(provider, model, input_tokens, output_tokens)`, `total_gbp()`, raises `CostCapExceeded`) and `harness.py` (custom OpenAI/Anthropic loop modeled on the verified spike). Includes the tool-format translator. Scope: no env logic, no patient logic.

**Wave 2 — depends on Wave 1 interfaces:**

- **Sub-agent C — TriageEnv class.** Builds `triage_env.py`: the `Environment` subclass with `__init__`, `list_tasks`, `list_splits`, `get_prompt`, `teardown`, the seven `@tool` methods, and `submit_handoff`. Each tool is thin: parses params, calls A/B helpers, advances `self.event_queue`, appends to `self.summary`, returns `ToolOutput`. The `submit_handoff` tool calls D's scoring + judge and returns `finished=True`. Scope: integration only; no patient/actor logic implemented here.

For each sub-agent specify: branch name, exact files owned (no overlap), function signatures and dataclass shapes (locked by you in Phase 1 before spawning), done condition (tests must pass), and a token budget for any LLM use during development (default £0.50).

# Phase 3: Integration and demo prep

1. **Integrate.** Pull all branches into main. Run a short test shift (90 min sim, 4 patients, 200 max-turns) end-to-end via `python -m triage_nurse.triage_env &` + `python -m triage_nurse.harness`. Fix integration bugs. Budget at least 3 hours.
2. **Cost-instrument a full demo run.** 6-hour shift, 1500 max-turns. Confirm <£3 per episode. If over, cut context bloat: rolling summary instead of full history, or summarize past N turns.
3. **Run the leaderboard.** 3 seeds × 2-3 model backends on the demo shift. Capture mean ± stdev for the composite score. Pick a model pair with a legible gap.
4. **Author the demo trajectory narration.** 60-second walkthrough of one trajectory, calling out moments of long-horizon reasoning success/failure.
5. **Slides.** Five max: thesis, env overview (with the 7 tools), capability-tangent pressure points, leaderboard, demo walkthrough.
6. **Next.js Triage Lab integration.** The existing UI in the parent repo reads JSONL rollout files from `triage-nurse/runs/<episode_id>/`. Either Next.js server components read the filesystem directly via `node:fs` (App Router), or a tiny Route Handler serves them. Pick the simpler path. Do not change the existing component shape.

# Operating principles

- **Cost discipline.** `cost_tracker.py` enforces caps. Per-episode default £2; demo + leaderboard episodes may bump to £3 explicitly.
- **Stub before integrate.** A/B/D/E/G are testable without LLM calls. C and the actor LLM enrichment are the only LLM-dependent pieces.
- **Cut rather than slip.** Document each cut in `CUTS.md` with one line of why.
- **Surface uncertainty.** When unsure of a design tradeoff, ask, don't guess.
- **One file, one owner.** No two sub-agents touch the same file.

# Output for Phase 1

Produce, in order:
1. Clarifying questions for the human user (only genuine blockers).
2. The locked spec document.
3. The sub-agent dispatch briefs, ready to send.

Then wait for human approval before spawning anything.

# Begin
