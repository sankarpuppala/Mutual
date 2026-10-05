"""Agent population generation (SPEC.md §15.1). A struct-of-arrays, vectorised with
numpy, driven by a single seeded ``numpy.random.Generator`` (CLAUDE.md §6: never
``random`` for anything security-relevant — this is research code, not the protocol,
but the "one seeded Generator per run" discipline is kept throughout for reproducibility).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass(frozen=True)
class Population:
    """One row per agent. ``c`` is (N, compatibility_dim), a unit vector per agent."""

    hostel: np.ndarray  # int, (N,)
    department: np.ndarray  # int, (N,)
    attractiveness: np.ndarray  # float "a", (N,)
    compatibility: np.ndarray  # float "c", (N, dim), unit-norm rows
    activity: np.ndarray  # float "o" in (0, 1), (N,)
    date_open: np.ndarray  # bool, (N,)

    @property
    def n(self) -> int:
        return self.hostel.shape[0]


def generate_population(rng: np.random.Generator, config: dict[str, Any]) -> Population:
    """Build a fresh population from ``sim/config.yaml``'s population parameters."""
    n = int(config["N"])
    dim = int(config["compatibility_dim"])

    hostel = rng.integers(0, int(config["n_hostels"]), size=n)
    department = rng.integers(0, int(config["n_departments"]), size=n)
    attractiveness = rng.standard_normal(n)  # a ~ N(0, 1)

    raw = rng.standard_normal((n, dim))
    norms = np.linalg.norm(raw, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0  # astronomically unlikely, but keep it defined
    compatibility = raw / norms  # uniform on the unit sphere in R^dim

    activity = rng.beta(float(config["activity_alpha"]), float(config["activity_beta"]), size=n)
    date_open = rng.random(n) < float(config["date_openness_prob"])

    return Population(
        hostel=hostel,
        department=department,
        attractiveness=attractiveness,
        compatibility=compatibility,
        activity=activity,
        date_open=date_open,
    )
