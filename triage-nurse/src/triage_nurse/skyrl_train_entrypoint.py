"""SkyRL entrypoint that registers the triage SkyRL-Gym environment."""

from __future__ import annotations

import sys

import ray
from skyrl.train.config import SkyRLTrainConfig
from skyrl.train.entrypoints.main_base import BasePPOExp
from skyrl.train.utils import validate_cfg
from skyrl.train.utils.utils import initialize_ray
from skyrl_gym import error as skyrl_gym_error
from skyrl_gym.envs.registration import register


def _register_env() -> None:
    try:
        register(
            id="triagebatchenv",
            entry_point="triage_nurse.skyrl_gym_env:TriageBatchSkyRLEnv",
        )
    except skyrl_gym_error.RegistrationError:
        pass


@ray.remote(num_cpus=1)
def skyrl_entrypoint(cfg: SkyRLTrainConfig):
    _register_env()
    exp = BasePPOExp(cfg)
    exp.run()


def main(argv: list[str] | None = None) -> None:
    cfg = SkyRLTrainConfig.from_cli_overrides(sys.argv[1:] if argv is None else argv)
    validate_cfg(cfg)
    initialize_ray(cfg)
    ray.get(skyrl_entrypoint.remote(cfg))


if __name__ == "__main__":
    main()
