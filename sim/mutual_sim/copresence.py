"""Daily co-presence via a stochastic block model (SPEC.md §15.2).

Each simulated day, among that day's *active* agents, every unordered pair is a
crossing with probability depending on whether they share a hostel, a department, or
neither. Exactly one CSPRNG draw per unordered pair, so a crossing is symmetric by
construction (never two independent per-direction draws that could disagree).

A pair that shares both a hostel and a department uses the hostel weight (the higher
of the two, in the shipped config) — a modelling choice, documented in
docs/DECISIONS_LOG.md #17.
"""

from __future__ import annotations

import numpy as np

from mutual_sim.population import Population


def daily_crossings(
    rng: np.random.Generator,
    population: Population,
    active: np.ndarray,
    *,
    same_hostel_weight: float,
    same_department_weight: float,
    otherwise_weight: float,
) -> list[tuple[int, int]]:
    """Return today's crossings as (agent_i, agent_j) global-index pairs, i < j."""
    active_idx = np.flatnonzero(active)
    m = active_idx.size
    if m < 2:
        return []

    hostel = population.hostel[active_idx]
    department = population.department[active_idx]
    i_idx, j_idx = np.triu_indices(m, k=1)  # every unordered pair among active agents

    same_hostel = hostel[i_idx] == hostel[j_idx]
    same_department = department[i_idx] == department[j_idx]

    p = np.full(i_idx.shape, otherwise_weight, dtype=np.float64)
    p[same_department] = same_department_weight
    p[same_hostel] = same_hostel_weight  # applied last: hostel wins when both are true

    draws = rng.random(i_idx.shape) < p
    pairs_local = np.stack([i_idx[draws], j_idx[draws]], axis=1)
    pairs_global = active_idx[pairs_local]  # map local (within-active) indices back
    return [(int(a), int(b)) for a, b in pairs_global]
