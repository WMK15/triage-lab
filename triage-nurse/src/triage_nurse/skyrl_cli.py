"""Compatibility CLI for the short `skyrl train` command used by this repo."""

from __future__ import annotations

import argparse
import math
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from .skyrl_dataset import write_skyrl_datasets


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _check_env_url(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return 200 <= response.status < 500
    except urllib.error.HTTPError as error:
        return 200 <= error.code < 500
    except OSError:
        return False


def _cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except (ImportError, ModuleNotFoundError):
        return False


def _build_overrides(args: argparse.Namespace, train_path: Path, validation_path: Path, output_dir: Path) -> list[str]:
    steps_per_epoch = max(1, math.ceil(256 / args.batch_tasks))
    epochs = max(1, math.ceil(args.iterations / steps_per_epoch))
    num_gpus = args.num_gpus or int(os.environ.get("NUM_GPUS", "1"))

    return [
        f"data.train_data=['{train_path}']",
        f"data.val_data=['{validation_path}']",
        f"trainer.algorithm.advantage_estimator={args.algorithm}",
        f"trainer.policy.model.path={args.base_model}",
        "trainer.strategy=fsdp2",
        "trainer.placement.colocate_all=true",
        f"trainer.placement.policy_num_gpus_per_node={num_gpus}",
        f"trainer.placement.ref_num_gpus_per_node={num_gpus}",
        f"trainer.train_batch_size={args.batch_tasks}",
        f"trainer.policy_mini_batch_size={args.batch_tasks}",
        f"trainer.eval_batch_size={min(64, args.batch_tasks)}",
        f"trainer.epochs={epochs}",
        f"trainer.eval_interval={args.eval_every}",
        f"trainer.ckpt_interval={args.eval_every}",
        "trainer.eval_before_train=true",
        "trainer.logger=console",
        "trainer.project_name=triage-lab",
        "trainer.run_name=triagebatchenv-grpo",
        f"trainer.ckpt_path={output_dir / 'checkpoints'}",
        f"trainer.export_path={output_dir / 'exports'}",
        f"trainer.log_path={output_dir / 'logs'}",
        "trainer.max_prompt_length=2048",
        "generator.max_input_length=2048",
        "generator.max_turns=1",
        "generator.batched=true",
        f"generator.n_samples_per_prompt={args.group_size}",
        "generator.inference_engine.backend=vllm",
        f"generator.inference_engine.num_engines={num_gpus}",
        "generator.inference_engine.tensor_parallel_size=1",
        "generator.inference_engine.weight_sync_backend=nccl",
        "generator.sampling_params.max_generate_length=512",
        "environment.env_class=triagebatchenv",
    ]


def _train(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="skyrl train")
    parser.add_argument("--env", required=True)
    parser.add_argument("--env-url", required=True)
    parser.add_argument("--base-model", required=True)
    parser.add_argument("--algorithm", default="grpo")
    parser.add_argument("--group-size", type=int, default=8)
    parser.add_argument("--batch-tasks", type=int, default=32)
    parser.add_argument("--iterations", type=int, default=200)
    parser.add_argument("--eval-every", type=int, default=20)
    parser.add_argument("--output-dir", type=Path, default=_repo_root() / "triage-nurse" / "skyrl-runs" / "latest")
    parser.add_argument("--num-gpus", type=int)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="attempt launch even when local CUDA preflight fails")
    args, passthrough = parser.parse_known_args(argv)

    if args.env.lower() != "triagebatchenv":
        parser.error("this repo shim only supports --env triagebatchenv")

    output_dir = args.output_dir.expanduser().resolve()
    data_dir = output_dir / "data"
    train_path, validation_path = write_skyrl_datasets(data_dir)
    overrides = _build_overrides(args, train_path, validation_path, output_dir) + passthrough
    command = [sys.executable, "-m", "triage_nurse.skyrl_train_entrypoint", *overrides]

    env_ok = _check_env_url(args.env_url)
    if not env_ok:
        print(f"warning: env URL is not reachable: {args.env_url}", file=sys.stderr)
        print("warning: SkyRL training uses the local SkyRL-Gym adapter and can still launch.", file=sys.stderr)

    print(f"prepared SkyRL datasets: {train_path} {validation_path}")
    print("underlying SkyRL command:")
    print(" ".join(str(part) for part in command))

    if args.dry_run:
        return 0

    if not args.force and not _cuda_available():
        print(
            "error: CUDA is not available in this environment. Upstream SkyRL GRPO training "
            "with vLLM/FSDP requires a CUDA GPU node; refusing to start a Qwen 7B run locally. "
            "Run this same command on the GPU machine, or pass --force if you intentionally "
            "want to see the backend failure.",
            file=sys.stderr,
        )
        return 2

    env = os.environ.copy()
    env.setdefault("RAY_RUNTIME_ENV_HOOK", "ray._private.runtime_env.uv_runtime_env_hook.hook")
    return subprocess.run(command, env=env, check=False).returncode


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in {"-h", "--help"}:
        print("usage: skyrl train [options]")
        return 0
    command = argv.pop(0)
    if command == "train":
        return _train(argv)
    print(f"unsupported skyrl command: {command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
