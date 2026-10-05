"""AC-T1-9: identical seed implies an identical output hash."""

from __future__ import annotations

import hashlib

import yaml

from mutual_sim.behaviour import run_one

CONFIG_PATH = __file__.rsplit("tests", 1)[0] + "config.yaml"


def _small_config() -> dict:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        config = yaml.safe_load(f)
    config["N"] = 120
    config["T"] = 20
    return config


def _hash_result(result) -> str:
    parts = [
        result.signals_received.tobytes(),
        result.matches_received.tobytes(),
        result.attractiveness.tobytes(),
        str(result.active_agent_days).encode(),
        str(sorted(result.retention.items())).encode(),
        str(
            [
                (m.a, m.b, m.day_matched, round(m.cos_compat, 12), m.reveal_day, m.ended_at_reveal)
                for m in result.matches
            ]
        ).encode(),
    ]
    return hashlib.sha256(b"|".join(parts)).hexdigest()


def test_same_seed_gives_identical_output_hash() -> None:
    config = _small_config()
    for policy in ("P", "M", "C"):
        h1 = _hash_result(run_one(config, policy, seed=7))
        h2 = _hash_result(run_one(config, policy, seed=7))
        assert h1 == h2


def test_different_seeds_give_different_output_hash() -> None:
    config = _small_config()
    h1 = _hash_result(run_one(config, "M", seed=7))
    h2 = _hash_result(run_one(config, "M", seed=8))
    assert h1 != h2


def test_config_mutation_does_not_leak_between_runs() -> None:
    """run_one must not mutate the config dict it is given (sweep.py reuses one base dict)."""
    config = _small_config()
    before = dict(config)
    run_one(config, "C", seed=3)
    assert config == before
