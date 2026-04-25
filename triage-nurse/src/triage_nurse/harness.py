"""Custom agent loop driving TriageEnv via the OpenReward client.

Owned by sub-agent G. The harness is a separate process from the env server:
it connects to ``localhost:8080``, iterates one or more tasks, drives the LLM
with the env's tools, and writes per-episode rollouts to
``runs/<episode_id>/{trajectory.jsonl, result.json, rewards.jsonl}``. The
Next.js ``/episodes`` route reads from that directory.

Cost is tracked via the shared ``cost_tracker`` module imported by both env
and harness; cumulative spend is reset per episode and capped at
``settings.MAX_EPISODE_GBP``.

Reference pattern (verified working): ``spike/harness_spike.py``.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from openreward import OpenReward

from . import cost_tracker, llm
from .config import require_llm_key, settings

LOCAL_URL = "http://localhost:8080"
# OpenReward server-side env name isn't fully documented; the spike showed it
# lowercases the class name. Try a few likely candidates for v2.
ENV_NAMES = ("triagebatchenv", "TriageBatchEnv", "triage_batch_env", "triagenv")


def _connect_env(client: OpenReward) -> tuple[Any, str]:
    """Locate the env on ``client`` by trying a few likely registered names."""
    last_err: Exception | None = None
    for name in ENV_NAMES:
        try:
            env = client.environments.get(name=name)
            return env, name
        except Exception as e:  # noqa: BLE001 — tolerant probe
            last_err = e
    raise RuntimeError(f"could not locate env on {LOCAL_URL}: {last_err}")


def _make_episode_id(task_id: str, model: str) -> str:
    """Compose a filesystem-safe, time-sortable, unique episode id."""
    ts = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    short = uuid.uuid4().hex[:6]
    safe_model = model.replace("/", "-")
    return f"{task_id}__{safe_model}__{ts}-{short}"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _write_jsonl(path: Path, obj: dict) -> None:
    with path.open("a") as f:
        f.write(json.dumps(obj) + "\n")


def _task_spec(task: Any) -> dict:
    """Extract the underlying task spec dict from an SDK Task or a plain dict."""
    spec = getattr(task, "task_spec", None)
    if isinstance(spec, dict):
        return spec
    if isinstance(task, dict):
        return task
    return {}


def run_task(
    env: Any,
    task: Any,
    model: str,
    max_turns: int,
    output_dir: Path,
) -> dict:
    """Run one task end-to-end, write the rollout, and return the result.json content."""
    spec = _task_spec(task)
    task_id = str(spec.get("id", "unknown"))
    episode_id = _make_episode_id(task_id, model)
    ep_dir = output_dir / episode_id
    ep_dir.mkdir(parents=True, exist_ok=True)
    traj_path = ep_dir / "trajectory.jsonl"
    rewards_path = ep_dir / "rewards.jsonl"
    result_path = ep_dir / "result.json"

    cost_tracker.reset()  # fresh cap per episode
    started = _now_iso()
    cumulative_reward = 0.0
    composite_score: float | None = None  # reward of the terminal tool call
    terminal_meta: dict[str, Any] | None = None  # parsed from final text
    status = "complete"
    turns = 0
    finished = False

    try:
        with env.session(task=task) as session:
            prompt_blocks = session.get_prompt()
            prompt_text = "".join(getattr(b, "text", "") for b in prompt_blocks)
            messages: list[dict] = [{"role": "user", "content": prompt_text}]
            tools = (
                session.list_tools(format="openai")
                if hasattr(session, "list_tools")
                else env.list_tools(format="openai")
            )

            while not finished and turns < max_turns:
                turns += 1
                resp = llm.openai_chat(model=model, messages=messages, tools=tools)
                msg = resp.choices[0].message
                assistant_msg: dict[str, Any] = {
                    "role": "assistant",
                    "content": msg.content or "",
                }
                if msg.tool_calls:
                    assistant_msg["tool_calls"] = [
                        {
                            "id": tc.id,
                            "type": "function",  # required by OpenAI tool_calls schema
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in msg.tool_calls
                    ]
                messages.append(assistant_msg)

                if not msg.tool_calls:
                    _write_jsonl(
                        traj_path,
                        {
                            "turn": turns,
                            "kind": "assistant_text",
                            "text": msg.content or "",
                            "ts": _now_iso(),
                        },
                    )
                    status = "no_tool_call"
                    break

                for tc in msg.tool_calls:
                    args = json.loads(tc.function.arguments or "{}")
                    _write_jsonl(
                        traj_path,
                        {
                            "turn": turns,
                            "kind": "tool_call",
                            "tool": tc.function.name,
                            "args": args,
                            "ts": _now_iso(),
                        },
                    )
                    tr = session.call_tool(tc.function.name, args)
                    text = "".join(getattr(b, "text", str(b)) for b in getattr(tr, "blocks", []))
                    reward = float(getattr(tr, "reward", 0.0) or 0.0)
                    fin = bool(getattr(tr, "finished", False))
                    cumulative_reward += reward
                    _write_jsonl(
                        traj_path,
                        {
                            "turn": turns,
                            "kind": "tool_result",
                            "tool": tc.function.name,
                            "text": text,
                            "reward": reward,
                            "finished": fin,
                            "ts": _now_iso(),
                        },
                    )
                    _write_jsonl(
                        rewards_path,
                        {
                            "turn": turns,
                            "tool": tc.function.name,
                            "reward": reward,
                            "cumulative": cumulative_reward,
                        },
                    )
                    messages.append({"role": "tool", "tool_call_id": tc.id, "content": text})
                    if fin:
                        finished = True
                        composite_score = reward
                        # The terminator (a successful submit) embeds a META
                        # JSON below a delimiter so the harness can lift
                        # per_patient_assignments + evaluation_summary into
                        # result.json.
                        from .triage_env import META_DELIMITER

                        if META_DELIMITER in text:
                            try:
                                meta_json = text.split(META_DELIMITER, 1)[1]
                                terminal_meta = json.loads(meta_json)
                            except (ValueError, json.JSONDecodeError):
                                terminal_meta = None
            else:
                # while-else: fires when the while condition becomes false (not on break)
                if not finished:
                    status = "max_turns"

    except cost_tracker.CostCapExceeded as e:
        status = "capped"
        _write_jsonl(
            traj_path,
            {"turn": turns, "kind": "error", "error": str(e), "ts": _now_iso()},
        )

    cost_summary = cost_tracker.summary()
    summary_text = (
        f"{turns} turn(s) — status {status}"
        + (f", composite {composite_score:.3f}" if composite_score is not None else "")
        + f", cost £{cost_summary['total_gbp']:.4f}"
    )
    # Convenience: a 0..1 score field for UI consumers. Prefer the terminal
    # composite when the episode ran to completion; fall back to a normalised
    # cumulative reward otherwise (so non-completing runs don't display 0).
    if composite_score is not None:
        score = max(0.0, min(1.0, composite_score))
    elif turns > 0:
        score = max(0.0, min(1.0, cumulative_reward / max(1, turns)))
    else:
        score = 0.0
    result: dict[str, Any] = {
        "episode_id": episode_id,
        "task_id": task_id,
        "model": model,
        "turns": turns,
        "finished": finished,
        "status": status,
        "total_reward": cumulative_reward,
        "composite_score": composite_score,
        "score": score,
        "summary": summary_text,
        "cost_usd": cost_summary["total_usd"],
        "cost_gbp": cost_summary["total_gbp"],
        "calls": cost_summary["calls"],
        "by_model": cost_summary["by_model"],
        "started_at": started,
        "ended_at": _now_iso(),
        "max_turns": max_turns,
    }
    # If the terminator embedded structured meta, lift it into result.json.
    if terminal_meta is not None:
        for key in (
            "scored_count",
            "manual_count",
            "per_patient_assignments",
            "evaluation_summary",
        ):
            if key in terminal_meta:
                result[key] = terminal_meta[key]
    else:
        # Episode didn't reach the terminator — set explicit None placeholders
        # so the UI knows there's no eval data.
        result["scored_count"] = None
        result["manual_count"] = None
        result["per_patient_assignments"] = None
        result["evaluation_summary"] = None
    result_path.write_text(json.dumps(result, indent=2))
    print(
        f"[harness] {episode_id} status={status} turns={turns} "
        f"reward={cumulative_reward:.3f} cost=£{cost_summary['total_gbp']:.4f}"
    )
    return result


def _patient_preview(patient: Any) -> dict[str, Any]:
    """Compact patient summary for the UI's pre-run preview pane."""
    v = patient.vitals
    return {
        "id": patient.id,
        "age": patient.age,
        "sex": patient.sex,
        "chief_complaint": patient.chief_complaint,
        "mental_state": patient.mental_state,
        "nrs_pain": patient.nrs_pain,
        "vitals": {
            "hr": v.hr,
            "sbp": v.sbp,
            "dbp": v.dbp,
            "rr": v.rr,
            "spo2": v.spo2,
            "temp_c": v.temp_c,
        },
        "ground_truth_ktas": patient.ground_truth_ktas,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="triage-nurse harness")
    p.add_argument("--task", default="all", help="task id, or 'all'")
    p.add_argument("--max-turns", type=int, default=200)
    p.add_argument("--model", default=settings.AGENT_MODEL)
    p.add_argument("--output-dir", default="runs")
    p.add_argument(
        "--list-tasks",
        action="store_true",
        help="Print available tasks as JSON and exit. Does NOT need an LLM key or env server.",
    )
    p.add_argument(
        "--split", default="test", help="Split to list tasks from (default: test)"
    )
    p.add_argument(
        "--task-spec-file",
        default=None,
        help="Path to a JSON file containing a task spec; used in place of --task lookup.",
    )
    p.add_argument(
        "--preview",
        default=None,
        help="Print a JSON preview of patients for the given taskId and exit.",
    )
    p.add_argument(
        "--n",
        type=int,
        default=None,
        help="Override the batch size for --preview / --list-tasks variants.",
    )
    args = p.parse_args(argv)

    if args.list_tasks:
        from .triage_env import TriageBatchEnv

        tasks = TriageBatchEnv.list_tasks(args.split)
        if args.n is not None:
            # Reshape each task's row_indices to size n.
            from . import dataset

            for t in tasks:
                seed = int(t.get("seed", 0))
                rows = dataset.select_diverse_batch(seed=seed, n=args.n)
                t["row_indices"] = rows
                t["n"] = args.n
                t["ground_truth_ktas"] = [
                    dataset.load_row(i).ground_truth_ktas for i in rows
                ]
        print(json.dumps(tasks, indent=2))
        return 0

    if args.preview is not None:
        # Doesn't need an LLM key. Synthesize the patients deterministically
        # from the same select_diverse_batch the env uses, plus any manual
        # patients if a task-spec-file was also passed.
        from . import dataset
        from .triage_env import TriageBatchEnv

        spec: dict[str, Any] | None = None
        if args.task_spec_file:
            spec = json.loads(Path(args.task_spec_file).read_text())
        else:
            for t in TriageBatchEnv.list_tasks(args.split):
                if t.get("id") == args.preview:
                    spec = dict(t)
                    break
        if spec is None:
            print(
                f"[harness] preview: task {args.preview!r} not found", file=sys.stderr
            )
            return 2
        if args.n is not None:
            seed = int(spec.get("seed", 0))
            spec["row_indices"] = dataset.select_diverse_batch(seed=seed, n=args.n)
            spec["n"] = args.n
            spec["ground_truth_ktas"] = [
                dataset.load_row(i).ground_truth_ktas for i in spec["row_indices"]
            ]
        # Build the env so the same patient construction logic runs.
        env_local = TriageBatchEnv(task_spec=spec)
        previews = [
            _patient_preview(env_local.world.patients[pid])
            for pid in env_local.world.patients
        ]
        print(json.dumps({"task_id": spec.get("id"), "patients": previews}, indent=2))
        return 0

    require_llm_key()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    client = OpenReward(base_url=LOCAL_URL)
    env, name = _connect_env(client)
    print(f"[harness] connected to env: {name}")

    if args.task_spec_file:
        # Ad-hoc task: load the spec from disk, wrap it in a Task object so
        # the OpenReward client's session() context manager (which reads
        # `task.task_spec`) accepts it.
        from openreward.api.environments.types import Task as ORTask

        adhoc_spec = json.loads(Path(args.task_spec_file).read_text())
        # Borrow server/env names from any existing task so the Task object
        # has the right deployment metadata. If list_tasks is empty we fall
        # back to placeholders (the env class registers without them).
        existing = env.list_tasks(split="test")
        first = existing[0] if existing else None
        adhoc_task = ORTask(
            server_name=getattr(first, "server_name", name),
            environment_name=getattr(first, "environment_name", name),
            task_spec=adhoc_spec,
            namespace=getattr(first, "namespace", None),
        )
        print(f"[harness] running ad-hoc task {adhoc_spec.get('id', '<unknown>')}")
        run_task(env, adhoc_task, args.model, args.max_turns, output_dir)
        return 0

    tasks = env.list_tasks(split="test")
    if args.task != "all":
        tasks = [t for t in tasks if _task_spec(t).get("id") == args.task]
        if not tasks:
            print(f"[harness] task {args.task!r} not found", file=sys.stderr)
            return 2
    print(f"[harness] running {len(tasks)} task(s)")

    for t in tasks:
        run_task(env, t, args.model, args.max_turns, output_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
