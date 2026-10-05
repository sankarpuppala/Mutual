"""The sensitivity sweep (SPEC.md §15.7): beta_a/beta_c, phi and K, 30 seeds per cell,
seeds 1000+. Run as: ``python -m mutual_sim.sweep --config sim/config.yaml``.

Must be run after ``mutual_sim.run`` has written ``main_experiment.csv`` and
``report.md`` — this module only *appends* the sweep section to that report.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Any

import pandas as pd

from mutual_sim.behaviour import run_one
from mutual_sim.report import append_sweep_section
from mutual_sim.run import RESULTS_DIR, compute_run_metrics, load_config


def run_sweep(config: dict[str, Any]) -> pd.DataFrame:
    sweep_cfg = config["sweep"]
    seeds = [int(sweep_cfg["seed_start"]) + i for i in range(int(sweep_cfg["seeds_per_cell"]))]
    beta_c = float(config["beta_c"])
    rows: list[dict[str, Any]] = []

    for ratio in sweep_cfg["beta_a_over_beta_c"]:
        for phi in sweep_cfg["phi"]:
            for k in sweep_cfg["K"]:
                cell_config = dict(config)
                cell_config["beta_a"] = float(ratio) * beta_c
                cell_config["phi"] = float(phi)
                cell_config["K"] = int(k)
                for policy in config["policies"]:
                    for seed in seeds:
                        result = run_one(cell_config, policy, seed)
                        row = compute_run_metrics(result, result.attractiveness)
                        row.update(
                            {
                                "policy": policy,
                                "seed": seed,
                                "beta_a_over_beta_c": ratio,
                                "phi": phi,
                                "K": k,
                            }
                        )
                        rows.append(row)
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", required=True)
    parser.add_argument("--out-dir", default=str(RESULTS_DIR))
    args = parser.parse_args()

    config = load_config(args.config)
    out_dir = Path(args.out_dir)

    main_csv = out_dir / "main_experiment.csv"
    if not main_csv.exists():
        raise SystemExit(f"{main_csv} not found — run `python -m mutual_sim.run` first.")
    df_main = pd.read_csv(main_csv)

    start = time.perf_counter()
    df_sweep = run_sweep(config)
    elapsed = time.perf_counter() - start

    out_dir.mkdir(parents=True, exist_ok=True)
    sweep_csv = out_dir / "sweep.csv"
    df_sweep.to_csv(sweep_csv, index=False)
    print(f"wrote {len(df_sweep)} rows to {sweep_csv}")
    print(f"runtime: {elapsed:.1f} s")

    append_sweep_section(df_sweep, df_main, config, out_dir, runtime_seconds=elapsed)


if __name__ == "__main__":
    main()
