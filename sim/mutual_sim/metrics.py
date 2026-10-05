"""Metrics computed on simulation output (SPEC.md §15.6): the Gini coefficient and a
seeded percentile bootstrap confidence interval. Pure functions, no simulation state.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np


def gini(x: np.ndarray) -> float:
    """G = sum_i sum_j |x_i - x_j| / (2 n^2 mu), with G = 0 when mu = 0 (SPEC §15.6).

    Computed via the sorted-array identity (O(n log n)) rather than the naive O(n^2)
    double sum, but numerically identical to it.
    """
    values = np.asarray(x, dtype=np.float64)
    n = values.size
    if n == 0:
        return 0.0
    mu = values.mean()
    if mu == 0.0:
        return 0.0
    sorted_values = np.sort(values)
    # sum_i sum_j |x_i - x_j| = 2 * sum_i (2*i - n + 1) * x_sorted[i]  (0-indexed i)
    index = np.arange(n, dtype=np.float64)
    weighted = (2.0 * index - n + 1.0) * sorted_values
    return float(weighted.sum() / (n * n * mu))


def bootstrap_ci(
    values: np.ndarray,
    statistic: Callable[[np.ndarray], float],
    *,
    resamples: int,
    seed: int,
    ci: float = 0.95,
) -> tuple[float, float]:
    """A seeded percentile bootstrap CI for ``statistic`` over ``values`` (resampled
    with replacement, same size as ``values`` each time). Deterministic given the seed.
    """
    values = np.asarray(values, dtype=np.float64)
    n = values.size
    if n == 0:
        return (0.0, 0.0)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(resamples, n))
    resampled_stats = np.array([statistic(values[row]) for row in idx])
    alpha = (1.0 - ci) / 2.0
    lo, hi = np.quantile(resampled_stats, [alpha, 1.0 - alpha])
    return float(lo), float(hi)
