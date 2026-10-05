"""AC-T1-9: policy P is the only policy where beta_a affects discovery."""

from __future__ import annotations

import copy

import numpy as np
import yaml

from mutual_sim.behaviour import run_one
from mutual_sim.policies import photo_visible_at_discovery, reveal_progress, rounds_to_reveal

CONFIG_PATH = __file__.rsplit("tests", 1)[0] + "config.yaml"


def _small_config() -> dict:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        config = yaml.safe_load(f)
    config["N"] = 150
    config["T"] = 30
    return config


def test_photo_visible_only_under_p() -> None:
    assert photo_visible_at_discovery("P") is True
    assert photo_visible_at_discovery("M") is False
    assert photo_visible_at_discovery("C") is False


def test_rounds_and_progress() -> None:
    assert rounds_to_reveal("M", n_reveal=8) == 0
    assert rounds_to_reveal("P", n_reveal=8) == 0
    assert rounds_to_reveal("C", n_reveal=8) == 8
    assert reveal_progress("M") == 0.0
    assert reveal_progress("P") == 0.0
    assert reveal_progress("C") == 1.0


def test_beta_a_changes_discovery_only_under_p() -> None:
    base = _small_config()
    for policy, should_differ in (("P", True), ("M", False), ("C", False)):
        low = copy.deepcopy(base)
        low["beta_a"] = 0.0
        high = copy.deepcopy(base)
        high["beta_a"] = 5.0
        r_low = run_one(low, policy, seed=1)
        r_high = run_one(high, policy, seed=1)
        identical = bool(np.array_equal(r_low.signals_received, r_high.signals_received))
        assert identical != should_differ, (
            f"policy {policy}: expected signals_received to "
            f"{'differ' if should_differ else 'stay identical'} across beta_a, but it didn't"
        )


def test_beta_c_still_matters_under_every_policy() -> None:
    """A sanity check in the other direction: compatibility weight is never special-cased."""
    base = _small_config()
    for policy in ("P", "M", "C"):
        low = copy.deepcopy(base)
        low["beta_c"] = 0.0
        high = copy.deepcopy(base)
        high["beta_c"] = 5.0
        r_low = run_one(low, policy, seed=2)
        r_high = run_one(high, policy, seed=2)
        assert not np.array_equal(r_low.signals_received, r_high.signals_received)
