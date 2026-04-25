"""Custom agent loop driving TriageEnv via the OpenReward client.

Owned by sub-agent G. The harness:
  1. Connects to a locally-running TriageEnv server.
  2. Iterates `list_tasks(split="test")` (or one specified by --task).
  3. For each task, opens a session, drives the loop with OpenAI/Anthropic.
  4. Writes rollouts to `runs/<episode_id>/{result.json,trajectory.jsonl,rewards.jsonl}`.

The Next.js `/episodes` route reads from that directory.

For now: stub `main()` connects, lists tasks, prints them, exits 0. Full agent
loop pattern is in `spike/harness_spike.py` for reference.
"""
from __future__ import annotations

import sys

from openreward import OpenReward

LOCAL_URL = "http://localhost:8080"
ENV_NAME = "triagenv"  # discovered at runtime; spike used "triagespike"


def main() -> int:
    client = OpenReward(base_url=LOCAL_URL)
    # Try a few likely registered names.
    for name in ("triagenv", "TriageEnv", "triage_env"):
        try:
            env = client.environments.get(name=name)
            print(f"connected to env: {name}")
            tasks = env.list_tasks(split="test")
            print(f"found {len(tasks)} task(s)")
            for t in tasks:
                print(f"  - {t}")
            return 0
        except Exception as e:  # noqa: BLE001
            print(f"  tried {name!r}: {type(e).__name__}: {e}")
    print("could not locate env on", LOCAL_URL, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
