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
    episode_id_override: str | None = None,
) -> dict:
    """Run one task end-to-end, write the rollout, and return the result.json content."""
    spec = _task_spec(task)
    task_id = str(spec.get("id", "unknown"))
    episode_id = episode_id_override or _make_episode_id(task_id, model)
    ep_dir = output_dir / episode_id
    ep_dir.mkdir(parents=True, exist_ok=True)
    traj_path = ep_dir / "trajectory.jsonl"
    rewards_path = ep_dir / "rewards.jsonl"
    result_path = ep_dir / "result.json"

    cost_tracker.reset()  # fresh cap per episode
    started = _now_iso()
    cumulative_reward = 0.0
    status = "complete"
    turns = 0
    finished = False

    _write_jsonl(
        traj_path,
        {
            "turn": 0,
            "type": "episode_started",
            "task_id": task_id,
            "model": model,
            "ts": started,
        },
    )

    try:
        with env.session(task=task) as session:
            prompt_blocks = session.get_prompt()
            prompt_text = "".join(getattr(b, "text", "") for b in prompt_blocks)
            _write_jsonl(
                traj_path,
                {
                    "turn": 0,
                    "type": "prompt_loaded",
                    "text": prompt_text,
                    "ts": _now_iso(),
                },
            )
            messages: list[dict] = [{"role": "user", "content": prompt_text}]
            tools = (
                session.list_tools(format="openai")
                if hasattr(session, "list_tools")
                else env.list_tools(format="openai")
            )
            _write_jsonl(
                traj_path,
                {
                    "turn": 0,
                    "type": "tools_loaded",
                    "count": len(tools),
                    "ts": _now_iso(),
                },
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
                            "type": "function",
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
                            "type": "assistant_text",
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
                            "type": "tool_call",
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
                            "type": "tool_result",
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
            else:
                # while-else: fires when the while condition becomes false (not on break)
                if not finished:
                    status = "max_turns"

    except cost_tracker.CostCapExceeded as e:
        status = "capped"
        _write_jsonl(
            traj_path,
            {"turn": turns, "type": "error", "error": str(e), "ts": _now_iso()},
        )

    cost_summary = cost_tracker.summary()
    result = {
        "episode_id": episode_id,
        "task_id": task_id,
        "model": model,
        "turns": turns,
        "finished": finished,
        "status": status,
        "total_reward": cumulative_reward,
        "cost_usd": cost_summary["total_usd"],
        "cost_gbp": cost_summary["total_gbp"],
        "calls": cost_summary["calls"],
        "by_model": cost_summary["by_model"],
        "started_at": started,
        "ended_at": _now_iso(),
        "max_turns": max_turns,
    }
    result_path.write_text(json.dumps(result, indent=2))
    print(
        f"[harness] {episode_id} status={status} turns={turns} "
        f"reward={cumulative_reward:.3f} cost=£{cost_summary['total_gbp']:.4f}"
    )
    return result


def main(argv: list[str] | None = None) -> int:
    require_llm_key()
    p = argparse.ArgumentParser(prog="triage-nurse harness")
    p.add_argument("--task", default="all", help="task id, or 'all'")
    p.add_argument("--split", default="test")
    p.add_argument("--max-turns", type=int, default=200)
    p.add_argument("--model", default=settings.AGENT_MODEL)
    p.add_argument("--output-dir", default="runs")
    p.add_argument("--episode-id")
    args = p.parse_args(argv)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    client = OpenReward(base_url=LOCAL_URL)
    env, name = _connect_env(client)
    print(f"[harness] connected to env: {name}")

    tasks = env.list_tasks(split=args.split)
    if args.task != "all":
        tasks = [t for t in tasks if _task_spec(t).get("id") == args.task]
        if not tasks:
            print(f"[harness] task {args.task!r} not found", file=sys.stderr)
            return 2
    print(f"[harness] running {len(tasks)} task(s)")

    if args.episode_id and len(tasks) != 1:
        print("[harness] --episode-id requires exactly one task", file=sys.stderr)
        return 2

    for t in tasks:
        run_task(
            env,
            t,
            args.model,
            args.max_turns,
            output_dir,
            episode_id_override=args.episode_id,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
