"""Print example OpenReward training/eval commands for TriageBatchEnv.

This does not run training itself. It gives a concrete invocation surface once
an external trainer (for example SkyRL or Tinker) is available.
"""

from __future__ import annotations


def main() -> None:
    print("Serve the env first:")
    print("  uv run python -m triage_nurse.triage_env")
    print()
    print("Inspect train tasks:")
    print("  uv run python -m triage_nurse.harness --list-tasks --split train")
    print()
    print("Inspect held-out test tasks:")
    print("  uv run python -m triage_nurse.harness --list-tasks --split test")
    print()
    print("Example SkyRL-style command:")
    print(
        "  skyrl train --env triagebatchenv --env-url http://127.0.0.1:8080 "
        "--base-model Qwen/Qwen2.5-7B-Instruct --algorithm grpo --group-size 8 "
        "--batch-tasks 32 --iterations 200 --eval-every 20"
    )
    print()
    print("Example held-out eval pass using the harness:")
    print("  uv run python -m triage_nurse.harness --split test --task all")


if __name__ == "__main__":
    main()
