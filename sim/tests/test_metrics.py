import numpy as np
import pytest

from mutual_sim.metrics import bootstrap_ci, gini


def test_gini_spec_test_values() -> None:
    assert gini([1, 1, 1, 1]) == 0.0
    assert gini([0, 0, 0, 1]) == 0.75
    assert gini([1, 2, 3, 4]) == 0.25


def test_gini_zero_mean_is_zero() -> None:
    assert gini([0, 0, 0, 0]) == 0.0
    assert gini([]) == 0.0


def test_gini_single_value_is_zero() -> None:
    assert gini([5.0]) == 0.0


def test_gini_matches_naive_double_sum() -> None:
    rng = np.random.default_rng(0)
    for _ in range(20):
        x = rng.exponential(size=rng.integers(2, 30))
        naive = np.abs(x[:, None] - x[None, :]).sum() / (2 * x.size**2 * x.mean())
        assert gini(x) == pytest.approx(naive)


def test_bootstrap_ci_is_deterministic_given_seed() -> None:
    x = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    a = bootstrap_ci(x, np.mean, resamples=500, seed=0)
    b = bootstrap_ci(x, np.mean, resamples=500, seed=0)
    assert a == b


def test_bootstrap_ci_brackets_the_statistic_for_constant_input() -> None:
    x = np.full(10, 3.0)
    lo, hi = bootstrap_ci(x, np.mean, resamples=200, seed=1)
    assert lo == hi == 3.0


def test_bootstrap_ci_different_seeds_can_differ() -> None:
    rng = np.random.default_rng(42)
    x = rng.normal(size=50)
    a = bootstrap_ci(x, np.mean, resamples=500, seed=0)
    b = bootstrap_ci(x, np.mean, resamples=500, seed=1)
    assert a != b


def test_bootstrap_ci_empty_input() -> None:
    assert bootstrap_ci(np.array([]), np.mean, resamples=10, seed=0) == (0.0, 0.0)
