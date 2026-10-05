"""The main experiment (SPEC.md §15.6, §15.7): policies P, M, C x 30 seeds at default
parameters. Run as: ``python -m mutual_sim.run --config sim/config.yaml --seeds 30``.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import yaml

from mutual_sim.behaviour import RunResult, run_one
from mutual_sim.metrics import gini

RESULTS_DIR = Path(__file__).resolve().parents[1] / "results"


def load_config(path: str | Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def compute_run_metrics(result: RunResult, attractiveness_all: np.ndarray) -> dict[str, float]:
    """Every §15.6 metric for one (policy, seed) run."""
    active = result.ever_active
    signals_active = result.signals_received[active]
    matches_active = result.matches_received[active]

    resolved = [m for m in result.matches if m.reveal_day is not None]
    ended_at_reveal = [m for m in resolved if m.ended_at_reveal]

    top_decile_cutoff = np.quantile(attractiveness_all, 0.9)
    top_decile_agents = set(np.flatnonzero(attractiveness_all >= top_decile_cutoff).tolist())
    matches_with_top_decile = sum(
        1 for m in result.matches if m.a in top_decile_agents or m.b in top_decile_agents
    )

    return {
        "gini_interest_received": gini(signals_active),
        "gini_matches": gini(matches_active),
        "matches_per_active_agent_day": (
            len(result.matches) / result.active_agent_days if result.active_agent_days else 0.0
        ),
        "mean_compatibility_matched": (
            float(np.mean([m.cos_compat for m in result.matches]))
            if result.matches
            else float("nan")
        ),
        "share_conversations_ending_at_reveal": (
            len(ended_at_reveal) / len(resolved) if resolved else float("nan")
        ),
        "share_matches_top_decile": (
            matches_with_top_decile / len(result.matches) if result.matches else float("nan")
        ),
        "retention_28": result.retention.get(28, float("nan")),
        "retention_56": result.retention.get(56, float("nan")),
        "n_matches": len(result.matches),
        "n_ever_active": int(active.sum()),
    }


def run_experiment(config: dict[str, Any], policies: list[str], seeds: list[int]) -> pd.DataFrame:
    """One row per (policy, seed): every §15.6 metric, computed from a fresh run_one."""
    rows = []
    for policy in policies:
        for seed in seeds:
            result = run_one(config, policy, seed)
            row = compute_run_metrics(result, result.attractiveness)
            row["policy"] = policy
            row["seed"] = seed
            rows.append(row)
    columns_first = ["policy", "seed"]
    df = pd.DataFrame(rows)
    return df[columns_first + [c for c in df.columns if c not in columns_first]]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", required=True)
    parser.add_argument("--seeds", type=int, required=True, help="number of seeds, 0..seeds-1")
    parser.add_argument("--out-dir", default=str(RESULTS_DIR))
    args = parser.parse_args()

    config = load_config(args.config)
    policies: list[str] = list(config["policies"])
    seeds = list(range(args.seeds))

    start = time.perf_counter()
    df = run_experiment(config, policies, seeds)
    elapsed = time.perf_counter() - start

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "main_experiment.csv"
    df.to_csv(csv_path, index=False)
    print(f"wrote {len(df)} rows to {csv_path}")
    print(f"runtime: {elapsed:.1f} s for {len(policies)} policies x {len(seeds)} seeds")

    from mutual_sim.report import write_report

    write_report(df, config, out_dir, runtime_seconds=elapsed)


if __name__ == "__main__":
    main()
