"""Discovery, signalling, matching, conversation, reveal and churn (SPEC.md §15.3-§15.5).

One run = one (policy, seed) pair, driven by a single seeded ``numpy.random.Generator``.
Modelling choices not fully pinned down by SPEC.md §15 are documented in
docs/DECISIONS_LOG.md #17 and repeated briefly in comments here.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

import numpy as np

from mutual_sim.copresence import daily_crossings
from mutual_sim.policies import photo_visible_at_discovery, reveal_progress, rounds_to_reveal
from mutual_sim.population import Population, generate_population


@dataclass
class MatchRecord:
    a: int
    b: int
    day_matched: int
    cos_compat: float
    reveal_day: int | None
    ended_at_reveal: bool | None  # None if the run ended before this match reached reveal


@dataclass
class RunResult:
    seed: int
    policy: str
    signals_received: np.ndarray  # (N,) int: real signals received, ground truth (ch1)
    matches_received: np.ndarray  # (N,) int: count of matches each agent is part of
    matches: list[MatchRecord]
    active_agent_days: int  # sum over days of the day's active-agent count
    retention: dict[int, float]  # checkpoint day -> fraction of N not yet churned
    attractiveness: np.ndarray  # (N,) copy, for the top-decile metric
    ever_active: np.ndarray  # (N,) bool: active on at least one day (§15.6's Gini denominator)


@dataclass
class _MatchState:
    day_matched: int
    rounds_elapsed: int = 0
    resolved: bool = False
    reveal_day: int | None = None
    ended_at_reveal: bool | None = None


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _prune_expired(sent: dict[int, int], today: int) -> None:
    for peer in [p for p, expiry in sent.items() if expiry < today]:
        del sent[peer]


def _discover_and_signal(
    rng: np.random.Generator,
    population: Population,
    alive: np.ndarray,
    crossings_prev: list[tuple[int, int]],
    signals_sent: list[dict[int, int]],
    signals_received: np.ndarray,
    matches: dict[tuple[int, int], _MatchState],
    day: int,
    config: dict[str, Any],
    policy: str,
) -> list[tuple[int, int]]:
    """Each date-open, alive agent reviews yesterday's crossings and signals the ones
    that clear the utility threshold, best first, capped at K active signals (§15.3).
    Returns the (sender, recipient) pairs newly signalled today, for the mutual-match
    check — done in a second pass, after every agent's decision for today is final, so
    a match formed by two agents signalling each other for the first time *on the same
    day* is never missed (a single forward pass over agents could miss exactly that).
    """
    neighbours: dict[int, list[int]] = defaultdict(list)
    for a, b in crossings_prev:
        neighbours[a].append(b)
        neighbours[b].append(a)

    display_cap = int(config["display_cap"])
    tau = float(config["tau"])
    beta_a = float(config["beta_a"])
    beta_c = float(config["beta_c"])
    ttl = int(config["interest_ttl_days"])
    cap_k = int(config["K"])
    photo_visible = photo_visible_at_discovery(policy)

    new_today: list[tuple[int, int]] = []
    for i, peers in neighbours.items():
        if not alive[i] or not population.date_open[i]:
            continue
        sent = signals_sent[i]
        _prune_expired(sent, day)
        remaining = cap_k - len(sent)
        if remaining <= 0:
            continue

        candidates = [
            j
            for j in peers
            if population.date_open[j]
            and alive[j]
            and j not in sent
            and (min(i, j), max(i, j)) not in matches
        ]
        if not candidates:
            continue
        if len(candidates) > display_cap:
            rng.shuffle(candidates)
            candidates = candidates[:display_cap]

        scored = []
        for j in candidates:
            cos = float(np.dot(population.compatibility[i], population.compatibility[j]))
            a_term = beta_a * population.attractiveness[j] if photo_visible else 0.0
            u = a_term + beta_c * cos + rng.logistic(0.0, 1.0)
            scored.append((u, j))
        scored.sort(key=lambda pair: -pair[0])
        chosen = [j for u, j in scored if u > tau][:remaining]

        for j in chosen:
            sent[j] = day + ttl
            signals_received[j] += 1
            new_today.append((i, j))

    return new_today


def _form_match(
    matches: dict[tuple[int, int], _MatchState],
    signals_sent: list[dict[int, int]],
    i: int,
    j: int,
    day: int,
    match_events_by_day: dict[int, list[int]],
) -> None:
    key = (min(i, j), max(i, j))
    if key in matches:
        return
    matches[key] = _MatchState(day_matched=day)
    signals_sent[i].pop(j, None)
    signals_sent[j].pop(i, None)
    match_events_by_day[day].append(i)
    match_events_by_day[day].append(j)


def _advance_matches(
    rng: np.random.Generator,
    population: Population,
    matches: dict[tuple[int, int], _MatchState],
    frustration: np.ndarray,
    policy: str,
    n_reveal: int,
    config: dict[str, Any],
    day: int,
) -> None:
    """Conversation rounds, frustration accrual, and the one-time reveal/continue
    decision (§15.4). A match that has already resolved (reached reveal) is left alone
    — the model only tracks the single drop-or-continue event at reveal, not an
    ongoing per-day decision after that.
    """
    required_rounds = rounds_to_reveal(policy, n_reveal)
    gamma_a = float(config["gamma_a"])
    gamma_c = float(config["gamma_c"])
    gamma_0 = float(config["gamma_0"])
    delta = float(config["delta"])
    phi = float(config["phi"])

    for (a, b), state in matches.items():
        if state.resolved:
            continue
        if state.rounds_elapsed < required_rounds:
            state.rounds_elapsed += 1
            if policy == "C":
                frustration[a] += phi
                frustration[b] += phi
            if state.rounds_elapsed < required_rounds:
                continue

        progress = reveal_progress(policy)
        cos = float(np.dot(population.compatibility[a], population.compatibility[b]))
        p_a = _sigmoid(
            gamma_a * population.attractiveness[b] * (1 - delta * progress)
            + gamma_c * cos
            + gamma_0
        )
        p_b = _sigmoid(
            gamma_a * population.attractiveness[a] * (1 - delta * progress)
            + gamma_c * cos
            + gamma_0
        )
        both_continue = (rng.random() < p_a) and (rng.random() < p_b)
        state.resolved = True
        state.reveal_day = day
        state.ended_at_reveal = not both_continue


def _recent_match_counts(
    match_events_by_day: dict[int, list[int]], day: int, window: int, n: int
) -> np.ndarray:
    counts = np.zeros(n, dtype=np.float64)
    for d in range(max(0, day - window + 1), day + 1):
        for agent in match_events_by_day.get(d, ()):
            counts[agent] += 1.0
    return counts


def run_one(config: dict[str, Any], policy: str, seed: int) -> RunResult:
    """Simulate one (policy, seed) pair for ``config["T"]`` days."""
    rng = np.random.default_rng(seed)
    population = generate_population(rng, config)
    n = population.n
    t_days = int(config["T"])
    n_reveal = int(config["n_reveal"])
    window = int(config["recent_matches_window_days"])
    checkpoints = {int(d) for d in config["retention_checkpoints"]}

    churned = np.zeros(n, dtype=bool)
    frustration = np.zeros(n, dtype=np.float64)
    signals_sent: list[dict[int, int]] = [{} for _ in range(n)]
    signals_received = np.zeros(n, dtype=np.int64)
    matches: dict[tuple[int, int], _MatchState] = {}
    match_events_by_day: dict[int, list[int]] = defaultdict(list)
    active_agent_days = 0
    ever_active = np.zeros(n, dtype=bool)
    retention: dict[int, float] = {}
    crossings_prev: list[tuple[int, int]] = []

    for day in range(t_days):
        alive = ~churned
        active_today = alive & (rng.random(n) < population.activity)
        active_agent_days += int(active_today.sum())
        ever_active |= active_today

        crossings_today = daily_crossings(
            rng,
            population,
            active_today,
            same_hostel_weight=float(config["sbm_same_hostel"]),
            same_department_weight=float(config["sbm_same_department"]),
            otherwise_weight=float(config["sbm_otherwise"]),
        )

        if crossings_prev:
            new_signals = _discover_and_signal(
                rng,
                population,
                alive,
                crossings_prev,
                signals_sent,
                signals_received,
                matches,
                day,
                config,
                policy,
            )
            # Second pass, after every agent's decision for today is final (see the
            # docstring above): a pair that signalled each other for the first time on
            # the same day must still match today.
            for i, j in new_signals:
                if i in signals_sent[j]:
                    _form_match(matches, signals_sent, i, j, day, match_events_by_day)

        _advance_matches(rng, population, matches, frustration, policy, n_reveal, config, day)

        recent = _recent_match_counts(match_events_by_day, day, window, n)
        h = np.clip(
            float(config["h_0"])
            + float(config["h_f"]) * frustration
            - float(config["h_m"]) * recent,
            0.0,
            1.0,
        )
        newly_churned = alive & (rng.random(n) < h)
        churned |= newly_churned

        if (day + 1) in checkpoints:
            retention[day + 1] = float((~churned).sum()) / n

        crossings_prev = crossings_today

    matches_received = np.zeros(n, dtype=np.int64)
    records: list[MatchRecord] = []
    for (a, b), state in matches.items():
        matches_received[a] += 1
        matches_received[b] += 1
        records.append(
            MatchRecord(
                a=a,
                b=b,
                day_matched=state.day_matched,
                cos_compat=float(np.dot(population.compatibility[a], population.compatibility[b])),
                reveal_day=state.reveal_day,
                ended_at_reveal=state.ended_at_reveal,
            )
        )

    return RunResult(
        seed=seed,
        policy=policy,
        signals_received=signals_received,
        matches_received=matches_received,
        matches=records,
        active_agent_days=active_agent_days,
        retention=retention,
        attractiveness=population.attractiveness.copy(),
        ever_active=ever_active,
    )
