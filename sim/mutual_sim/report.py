"""Builds ``sim/results/report.md`` and its figures (SPEC.md §15, §19 AC-T1-9).

The assumption caveat comes first, always. ``write_report`` is called by ``run.py``
after the main experiment; ``append_sweep_section`` is called by ``sweep.py`` and
edits the same file in place, so there is one report, not two.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless: this module never opens a window
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from mutual_sim.metrics import bootstrap_ci

SWEEP_MARKER = "<!-- SWEEP_SECTION -->"

METRICS: list[tuple[str, str]] = [
    ("gini_interest_received", "Gini of interest received"),
    ("gini_matches", "Gini of matches"),
    ("matches_per_active_agent_day", "Matches per active agent-day"),
    ("mean_compatibility_matched", "Mean compatibility of matched pairs"),
    ("share_conversations_ending_at_reveal", "Share of conversations ending at reveal"),
    ("share_matches_top_decile", "Share of matches with a top-decile-attractiveness agent"),
    ("retention_28", "Retention at day 28"),
    ("retention_56", "Retention at day 56"),
]

ASSUMPTION_CAVEAT = (
    "**All results below are conditional on this simulation's modelling assumptions** "
    "(SPEC.md §15) — a stochastic-block-model co-presence structure, a logistic-plus-"
    "utility signalling rule, and the parameter values in the table below, most of which "
    "are plausible assumptions rather than measurements. They describe how these three "
    "reveal policies behave *under this model*, not a measured fact about any real "
    "population. See `docs/DECISIONS_LOG.md` entry #17 for the modelling choices made "
    "where SPEC.md §15 left a gap (an explicit judgement call, not a hidden one)."
)


def _policy_table(df: pd.DataFrame, bootstrap_cfg: dict[str, Any]) -> str:
    policies = sorted(df["policy"].unique())
    header = "| Metric | " + " | ".join(f"{p} (95% CI)" for p in policies) + " |"
    sep = "|---" * (1 + len(policies)) + "|"
    rows = [header, sep]
    for key, label in METRICS:
        cells = [label]
        for policy in policies:
            values = df.loc[df["policy"] == policy, key].dropna().to_numpy()
            if values.size == 0:
                cells.append("n/a")
                continue
            mean = float(np.mean(values))
            lo, hi = bootstrap_ci(
                values,
                np.mean,
                resamples=int(bootstrap_cfg["resamples"]),
                seed=int(bootstrap_cfg["seed"]),
                ci=float(bootstrap_cfg["ci"]),
            )
            cells.append(f"{mean:.3f} [{lo:.3f}, {hi:.3f}]")
        rows.append("| " + " | ".join(cells) + " |")
    return "\n".join(rows)


def _parameter_table(config: dict[str, Any]) -> str:
    rows = ["| Parameter | Value |", "|---|---|"]
    for key, value in config.items():
        if isinstance(value, dict):
            continue  # bootstrap/sweep sub-configs are described in their own sections
        rows.append(f"| `{key}` | `{value}` |")
    return "\n".join(rows)


def _make_figures(df: pd.DataFrame, figures_dir: Path) -> None:
    figures_dir.mkdir(parents=True, exist_ok=True)
    policies = sorted(df["policy"].unique())
    for key, label in METRICS:
        fig, ax = plt.subplots(figsize=(5, 3.5))
        data = [df.loc[df["policy"] == p, key].dropna().to_numpy() for p in policies]
        ax.boxplot(data, tick_labels=policies)
        ax.set_title(label)
        ax.set_xlabel("policy")
        fig.tight_layout()
        fig.savefig(figures_dir / f"{key}.png", dpi=120)
        plt.close(fig)


def write_report(
    df: pd.DataFrame, config: dict[str, Any], out_dir: Path, *, runtime_seconds: float
) -> Path:
    _make_figures(df, out_dir / "figures")
    n_policies = df["policy"].nunique()
    lines = [
        "# Mutual simulation report (RQ2)",
        "",
        ASSUMPTION_CAVEAT,
        "",
        (
            f"Main experiment: {n_policies} polic{'y' if n_policies == 1 else 'ies'} x "
            f"{df['seed'].nunique()} seeds, {int(config['T'])} days each. "
            f"Runtime: {runtime_seconds:.1f} s on one CPU core."
        ),
        "",
        "## Parameters",
        "",
        _parameter_table(config),
        "",
        "## Results by policy (mean, 95% bootstrap CI over seeds)",
        "",
        _policy_table(df, config["bootstrap"]),
        "",
        "## Figures",
        "",
    ]
    lines += [f"![{label}](figures/{key}.png)" for key, label in METRICS]
    lines += ["", SWEEP_MARKER, ""]

    report_path = out_dir / "report.md"
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return report_path


def find_reversals(
    df_main: pd.DataFrame, df_sweep: pd.DataFrame, cell_cols: list[str]
) -> list[str]:
    """Name every metric whose "which policy scores highest" ranking, from the main
    experiment, is not the same in every sweep cell."""
    reversals = []
    for key, label in METRICS:
        main_means = df_main.groupby("policy")[key].mean()
        if main_means.isna().all():
            continue
        main_top = main_means.idxmax()

        def _top_policy(group: pd.DataFrame, metric_key: str = key) -> str | None:
            return (
                group.loc[group[metric_key].idxmax(), "policy"]
                if group[metric_key].notna().any()
                else None
            )

        cell_tops = (
            df_sweep.groupby([*cell_cols, "policy"])[key]
            .mean()
            .reset_index()
            .groupby(cell_cols)
            .apply(_top_policy, include_groups=False)
        )
        differing = cell_tops[cell_tops != main_top].dropna()
        if not differing.empty:
            example_cell = differing.index[0]
            example_desc = ", ".join(
                f"{col}={_fmt(val)}" for col, val in zip(cell_cols, example_cell, strict=True)
            )
            reversals.append(
                f"**{label}**: main experiment favours {main_top}, but {len(differing)} sweep "
                f"cell(s) favour a different policy instead (e.g. {example_desc} favours "
                f"{differing.iloc[0]})."
            )
    return reversals


def _fmt(value: object) -> str:
    """A plain Python number for a report sentence, not numpy's ``np.int64(0)`` repr."""
    return str(value.item()) if hasattr(value, "item") else str(value)


def append_sweep_section(
    df_sweep: pd.DataFrame,
    df_main: pd.DataFrame,
    config: dict[str, Any],
    out_dir: Path,
    *,
    runtime_seconds: float,
) -> Path:
    cell_cols = ["beta_a_over_beta_c", "phi", "K"]
    reversals = find_reversals(df_main, df_sweep, cell_cols)
    grid_desc = ", ".join(f"`{k}`: {v}" for k, v in config["sweep"].items() if isinstance(v, list))

    lines = [
        "## Sensitivity sweep",
        "",
        (
            f"{len(df_sweep)} runs ({df_sweep['policy'].nunique()} policies x "
            f"{df_sweep.groupby(cell_cols).ngroups} cells x "
            f"{config['sweep']['seeds_per_cell']} seeds). Runtime: {runtime_seconds:.1f} s."
        ),
        "",
        f"Grid: {grid_desc}",
        "",
    ]
    if reversals:
        lines.append("**Conclusions that reverse somewhere in the sweep:**")
        lines.extend(f"- {r}" for r in reversals)
    else:
        lines.append(
            "No metric's main-experiment policy ranking reversed in any sweep cell "
            "(the *size* of differences between policies still varies with the grid; "
            "see `sim/results/sweep.csv` for every cell's numbers)."
        )
    lines.append("")

    report_path = out_dir / "report.md"
    text = (
        report_path.read_text(encoding="utf-8")
        if report_path.exists()
        else f"# Mutual simulation report (RQ2)\n\n{SWEEP_MARKER}\n"
    )
    new_section = "\n".join(lines)
    text = (
        text.replace(SWEEP_MARKER, new_section)
        if SWEEP_MARKER in text
        else text + "\n" + new_section
    )
    report_path.write_text(text, encoding="utf-8")
    return report_path
