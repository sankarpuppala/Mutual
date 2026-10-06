"""The pre-registered analysis (study/PREREGISTRATION.md §6, SPEC.md §16).

Runs every table fixed in the pre-registration, in that order, from an export CSV whose
schema is defined by `make_synthetic_export.py`. Acceptance criterion AC-T3-3 is that this
runs on the synthetic export and produces every pre-registered table.

Three disciplines are built into this file rather than left to whoever runs it:

1. **Nothing is computed that the pre-registration does not name.** The temptation in a
   small pilot is to go looking, find something, and report it as if it had been the plan.
   Every table here maps to a numbered outcome in §5 of the pre-registration, and the
   mapping is printed beside it.
2. **No p-values and no significance claims.** The pre-registration says intervals only,
   because a pilot this size cannot support a decision rule.
3. **A synthetic export is labelled as such, loudly, in every table.** A reader must never
   be able to mistake a pipeline test for a result.

Run:
    python study/analysis/analyze.py --input study/analysis/synthetic_export.csv
"""

from __future__ import annotations

import argparse
import math
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

import numpy as np
import pandas as pd

# Windows consoles default to cp1252, which cannot encode the typographic characters in
# these tables. Reconfiguring is better than degrading the output to ASCII.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BOOTSTRAP_RESAMPLES = 10_000
BOOTSTRAP_SEED = 0
CI = 0.95

#: A pilot-sized dataset is not worth a mixed model below this many matches.
MIN_MATCHES_FOR_REGRESSION = 30


# --------------------------------------------------------------------------- statistics


def gini(values: Sequence[float] | np.ndarray) -> float:
    """The Gini coefficient of a non-negative array. 0 when the mean is 0.

    The same definition and the same implementation shape as the simulation's
    `sim/mutual_sim/metrics.py`, so the two halves of the project report the same number
    for the same data.
    """
    array = np.sort(np.asarray(values, dtype=float))
    n = array.size
    if n == 0:
        return float("nan")
    total = array.sum()
    if total == 0:
        return 0.0
    index = np.arange(1, n + 1)
    return float((2 * index - n - 1).dot(array) / (n * total))


def bootstrap_ci(
    values: Sequence[float] | np.ndarray,
    statistic: Callable[[np.ndarray], float],
    *,
    resamples: int = BOOTSTRAP_RESAMPLES,
    seed: int = BOOTSTRAP_SEED,
    ci: float = CI,
) -> tuple[float, float]:
    """A percentile bootstrap interval for `statistic` over `values`."""
    array = np.asarray(values, dtype=float)
    if array.size == 0:
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    draws = rng.integers(0, array.size, size=(resamples, array.size))
    estimates = np.array([statistic(array[row]) for row in draws])
    lower = (1 - ci) / 2 * 100
    return (
        float(np.percentile(estimates, lower)),
        float(np.percentile(estimates, 100 - lower)),
    )


def _mean(array: np.ndarray) -> float:
    return float(np.mean(array)) if array.size else float("nan")


def _fmt(value: float, places: int = 3) -> str:
    # math.isnan rather than `value != value`: same test, and it says what it means.
    return "—" if math.isnan(value) else f"{value:.{places}f}"


def _interval(point: float, bounds: tuple[float, float], places: int = 3) -> str:
    return (
        f"{_fmt(point, places)} [{_fmt(bounds[0], places)}, {_fmt(bounds[1], places)}]"
    )


# ------------------------------------------------------------------------------- loading


class ExportError(Exception):
    """The export does not have the schema the analysis was written against."""


REQUIRED_COLUMNS = {
    "row_type",
    "participant",
    "block",
    "policy",
    "week",
    "active",
    "matches",
    "messages_sent",
    "unmatches",
    "match_id",
    "peer",
    "reveal_reached",
    "messages_a",
    "messages_b",
    "ended_within_24h_of_reveal",
    "s1_comfortable",
    "s2_frustrated_no_photo",
    "s3_satisfied",
}


def load(path: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Reads the export and splits it into user-week, match and survey frames."""
    frame = pd.read_csv(path)
    missing = REQUIRED_COLUMNS - set(frame.columns)
    if missing:
        raise ExportError(f"export is missing columns: {', '.join(sorted(missing))}")

    # A real export must never carry anything identifying. Checked here as well as in the
    # exporter, because this is the file a human will actually open (SPEC §16).
    forbidden = {
        "email",
        "name",
        "first_name",
        "dob",
        "date_of_birth",
        "message",
        "body",
        "prompt",
    }
    leaked = {column for column in frame.columns if column.lower() in forbidden}
    if leaked:
        raise ExportError(
            f"export carries columns that must never be exported: {', '.join(sorted(leaked))}"
        )

    user_weeks = frame[frame["row_type"] == "user_week"].copy()
    matches = frame[frame["row_type"] == "match"].copy()
    surveys = frame[frame["row_type"] == "survey"].copy()

    for column in ("active", "matches", "messages_sent", "unmatches", "week", "block"):
        user_weeks[column] = (
            pd.to_numeric(user_weeks[column], errors="coerce").fillna(0).astype(int)
        )
    for column in (
        "reveal_reached",
        "messages_a",
        "messages_b",
        "ended_within_24h_of_reveal",
        "block",
    ):
        matches[column] = (
            pd.to_numeric(matches[column], errors="coerce").fillna(0).astype(int)
        )
    for column in ("s1_comfortable", "s2_frustrated_no_photo", "s3_satisfied", "block"):
        surveys[column] = pd.to_numeric(surveys[column], errors="coerce")

    return user_weeks, matches, surveys


def _is_synthetic(path: Path, user_weeks: pd.DataFrame) -> bool:
    """True when this is obviously the synthetic export rather than real data."""
    if "synthetic" in path.name:
        return True
    return bool(
        user_weeks["participant"].astype(str).str.startswith("synthetic-").any()
    )


# -------------------------------------------------------------------------------- tables


def table_1_gini_of_matches(user_weeks: pd.DataFrame) -> pd.DataFrame:
    """Outcome 1 (primary): Gini of matches received among active users, per block."""
    rows = []
    for (block, policy), group in user_weeks.groupby(["block", "policy"], sort=True):
        per_user = group[group["active"] == 1].groupby("participant")["matches"].sum()
        values = per_user.to_numpy(dtype=float)
        rows.append(
            {
                "block": block,
                "policy": policy,
                "active_users": int(per_user.size),
                "gini": gini(values),
                "ci": bootstrap_ci(values, gini),
            }
        )
    return pd.DataFrame(rows)


def table_2_unmatch_after_reveal(matches: pd.DataFrame) -> pd.DataFrame:
    """Outcome 2 (primary): unmatch within 24 h of reveal, among matches that revealed."""
    rows = []
    for (block, policy), group in matches.groupby(["block", "policy"], sort=True):
        revealed = group[group["reveal_reached"] == 1]
        values = revealed["ended_within_24h_of_reveal"].to_numpy(dtype=float)
        rows.append(
            {
                "block": block,
                "policy": policy,
                "matches_revealed": int(values.size),
                "share": _mean(values),
                "ci": bootstrap_ci(values, _mean),
            }
        )
    return pd.DataFrame(rows)


def table_3_matches_per_active_user_week(user_weeks: pd.DataFrame) -> pd.DataFrame:
    """Outcome 3: matches per active user-week."""
    rows = []
    for (block, policy), group in user_weeks.groupby(["block", "policy"], sort=True):
        active = group[group["active"] == 1]
        values = active["matches"].to_numpy(dtype=float)
        rows.append(
            {
                "block": block,
                "policy": policy,
                "active_user_weeks": int(values.size),
                "mean": _mean(values),
                "ci": bootstrap_ci(values, _mean),
            }
        )
    return pd.DataFrame(rows)


def table_4_messages_per_match(matches: pd.DataFrame) -> pd.DataFrame:
    """Outcome 4: messages per match, mean and median."""
    rows = []
    for (block, policy), group in matches.groupby(["block", "policy"], sort=True):
        values = (group["messages_a"] + group["messages_b"]).to_numpy(dtype=float)
        rows.append(
            {
                "block": block,
                "policy": policy,
                "matches": int(values.size),
                "mean": _mean(values),
                "ci": bootstrap_ci(values, _mean),
                "median": float(np.median(values)) if values.size else float("nan"),
            }
        )
    return pd.DataFrame(rows)


def table_5_deep_conversations(matches: pd.DataFrame) -> pd.DataFrame:
    """Outcome 5: share of matches reaching at least 10 messages in total."""
    rows = []
    for (block, policy), group in matches.groupby(["block", "policy"], sort=True):
        total = group["messages_a"] + group["messages_b"]
        values = (total >= 10).to_numpy(dtype=float)
        rows.append(
            {
                "block": block,
                "policy": policy,
                "matches": int(values.size),
                "share": _mean(values),
                "ci": bootstrap_ci(values, _mean),
            }
        )
    return pd.DataFrame(rows)


def table_6_weekly_retention(user_weeks: pd.DataFrame) -> pd.DataFrame:
    """Outcome 6: share of users active in week w who are also active in week w+1."""
    active = (
        user_weeks[user_weeks["active"] == 1]
        .groupby(["participant", "week"])
        .size()
        .reset_index(name="n")
    )
    by_week: dict[int, set[str]] = {
        int(week): set(group["participant"]) for week, group in active.groupby("week")
    }
    policy_of_week = (
        user_weeks.groupby("week")["policy"].agg(lambda s: s.mode().iat[0]).to_dict()
    )

    rows = []
    for week in sorted(by_week):
        following = by_week.get(week + 1)
        if following is None:
            continue
        this_week = by_week[week]
        if not this_week:
            continue
        values = np.array(
            [1.0 if person in following else 0.0 for person in sorted(this_week)]
        )
        rows.append(
            {
                "week": week,
                "policy": policy_of_week.get(week, "?"),
                "active_users": int(values.size),
                "retained": _mean(values),
                "ci": bootstrap_ci(values, _mean),
            }
        )
    return pd.DataFrame(rows)


def table_7_survey(surveys: pd.DataFrame) -> pd.DataFrame:
    """The three optional Likert items, per block. Medians and distributions only."""
    items = ("s1_comfortable", "s2_frustrated_no_photo", "s3_satisfied")
    rows = []
    for (block, policy), group in surveys.groupby(["block", "policy"], sort=True):
        row: dict[str, object] = {
            "block": block,
            "policy": policy,
            "responses": len(group),
        }
        for item in items:
            values = group[item].dropna()
            row[f"{item}_median"] = (
                float(values.median()) if len(values) else float("nan")
            )
            row[f"{item}_dist"] = "/".join(
                str(int((values == level).sum())) for level in (1, 2, 3, 4, 5)
            )
        rows.append(row)
    return pd.DataFrame(rows)


def table_8_policy_comparison(
    user_weeks: pd.DataFrame, matches: pd.DataFrame
) -> pd.DataFrame:
    """M versus C on both primary outcomes, pooled and per block pair.

    Pooled **and** per pair, because study/PREREGISTRATION.md §3 states that the two M
    blocks are not exchangeable (block and calendar time are confounded), so a pooled
    estimate alone would overstate what the design supports.
    """
    rows: list[dict[str, object]] = []

    def gini_for(frame: pd.DataFrame) -> np.ndarray:
        per_user = frame[frame["active"] == 1].groupby("participant")["matches"].sum()
        return per_user.to_numpy(dtype=float)

    comparisons: list[tuple[str, list[int], list[int]]] = [
        ("pooled (M 1,3 vs C 2,4)", [1, 3], [2, 4]),
        ("blocks 1 vs 2", [1], [2]),
        ("blocks 3 vs 4", [3], [4]),
    ]

    for label, m_blocks, c_blocks in comparisons:
        m_values = gini_for(user_weeks[user_weeks["block"].isin(m_blocks)])
        c_values = gini_for(user_weeks[user_weeks["block"].isin(c_blocks)])
        difference = gini(m_values) - gini(c_values)
        rows.append(
            {
                "comparison": label,
                "outcome": "Gini of matches (M − C)",
                "estimate": difference,
                "ci": _difference_ci(m_values, c_values, gini),
            }
        )

        m_unmatch = matches[
            matches["block"].isin(m_blocks) & (matches["reveal_reached"] == 1)
        ]["ended_within_24h_of_reveal"].to_numpy(dtype=float)
        c_unmatch = matches[
            matches["block"].isin(c_blocks) & (matches["reveal_reached"] == 1)
        ]["ended_within_24h_of_reveal"].to_numpy(dtype=float)
        rows.append(
            {
                "comparison": label,
                "outcome": "Unmatch within 24 h of reveal (M − C)",
                "estimate": _mean(m_unmatch) - _mean(c_unmatch),
                "ci": _difference_ci(m_unmatch, c_unmatch, _mean),
            }
        )

    return pd.DataFrame(rows)


def _difference_ci(
    a: np.ndarray,
    b: np.ndarray,
    statistic: Callable[[np.ndarray], float],
    *,
    resamples: int = BOOTSTRAP_RESAMPLES,
    seed: int = BOOTSTRAP_SEED,
) -> tuple[float, float]:
    """A percentile bootstrap interval for `statistic(a) - statistic(b)`."""
    if a.size == 0 or b.size == 0:
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    estimates = np.empty(resamples)
    for i in range(resamples):
        draw_a = a[rng.integers(0, a.size, a.size)]
        draw_b = b[rng.integers(0, b.size, b.size)]
        estimates[i] = statistic(draw_a) - statistic(draw_b)
    lower = (1 - CI) / 2 * 100
    return (
        float(np.percentile(estimates, lower)),
        float(np.percentile(estimates, 100 - lower)),
    )


def model_unmatch_after_reveal(matches: pd.DataFrame) -> str:
    """Mixed-effects logistic regression: unmatch-after-reveal ~ policy + (1 | participant).

    One participant can contribute several matches, so treating matches as independent
    would understate the uncertainty. The random intercept is what accounts for that.

    Returns a human-readable report. It declines to fit, with a reason, when the data is
    too small or `statsmodels` is not installed -- an estimate from 12 matches would be
    worse than no estimate, and the pre-registration already says this pilot is
    underpowered.
    """
    revealed = matches[matches["reveal_reached"] == 1].copy()
    if len(revealed) < MIN_MATCHES_FOR_REGRESSION:
        return (
            f"not fitted: only {len(revealed)} matches reached a reveal "
            f"(minimum {MIN_MATCHES_FOR_REGRESSION}). Reported as a pre-registered "
            "limitation, not as a null result."
        )

    try:
        import statsmodels.formula.api as smf
    except ImportError:
        return (
            "not fitted: statsmodels is not installed. Install it with "
            "`pip install -r study/analysis/requirements.txt` and re-run. The descriptive "
            "tables above are unaffected."
        )

    revealed["is_c"] = (revealed["policy"] == "C").astype(int)
    try:
        # A binomial GEE with an exchangeable correlation per participant: the practical
        # stand-in for a random intercept that statsmodels fits reliably on pilot-sized
        # binary data, where a full GLMM often fails to converge.
        import statsmodels.api as sm

        model = smf.gee(
            "ended_within_24h_of_reveal ~ is_c",
            groups="participant",
            data=revealed,
            family=sm.families.Binomial(),
            cov_struct=sm.cov_struct.Exchangeable(),
        ).fit()
    except ImportError as error:
        # statsmodels imports but one of its compiled dependencies cannot load. Seen on a
        # Windows machine whose Application Control policy blocks an unsigned scipy DLL.
        return (
            f"not fitted: a dependency failed to load ({error}). The descriptive tables "
            "above are unaffected; this is an environment problem, not a result."
        )
    except Exception as error:  # noqa: BLE001 - any fit failure is reported, never hidden
        return (
            f"not fitted: the model did not converge ({type(error).__name__}: {error})."
        )

    coefficient = float(model.params.get("is_c", float("nan")))
    conf = model.conf_int()
    low, high = (float(conf.loc["is_c", 0]), float(conf.loc["is_c", 1]))
    return (
        f"policy C versus M, log-odds of ending within 24 h of reveal: "
        f"{coefficient:+.3f} [{low:+.3f}, {high:+.3f}] "
        f"(odds ratio {np.exp(coefficient):.3f}); "
        f"n = {len(revealed)} matches from {revealed['participant'].nunique()} participants. "
        "No significance claim is made (pre-registration §6)."
    )


# ------------------------------------------------------------------------------ printing


def _print_table(
    title: str, outcome: str, frame: pd.DataFrame, interval_places: int = 3
) -> None:
    print(f"\n{title}")
    print(f"  (pre-registered outcome: {outcome})")
    if frame.empty:
        print("  no rows")
        return
    display = frame.copy()
    for column in display.columns:
        if column == "ci":
            continue
        if pd.api.types.is_float_dtype(display[column]):
            display[column] = display[column].map(lambda v: _fmt(v, interval_places))
    if "ci" in display.columns:
        display["95% CI"] = frame["ci"].map(
            lambda bounds: (
                f"[{_fmt(bounds[0], interval_places)}, {_fmt(bounds[1], interval_places)}]"
            )
        )
        display = display.drop(columns=["ci"])
    print(display.to_string(index=False))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("study/analysis/synthetic_export.csv"),
        help="the export CSV to analyse",
    )
    args = parser.parse_args()

    user_weeks, matches, surveys = load(args.input)
    synthetic = _is_synthetic(args.input, user_weeks)

    print("=" * 78)
    print("Mutual field pilot — pre-registered analysis (study/PREREGISTRATION.md §6)")
    print("=" * 78)
    if synthetic:
        print()
        print("*** SYNTHETIC DATA. Every number below is invented. ***")
        print(
            "*** This run tests the pipeline. It is not a result and must not be reported. ***"
        )
    print()
    print(f"input: {args.input}")
    print(
        f"participants: {user_weeks['participant'].nunique()}  "
        f"user-weeks: {len(user_weeks)}  matches: {len(matches)}  "
        f"survey responses: {len(surveys)}"
    )
    print(
        f"bootstrap: {BOOTSTRAP_RESAMPLES} resamples, {int(CI * 100)}% percentile interval, "
        f"seed {BOOTSTRAP_SEED}"
    )
    print(
        "No p-values and no significance claims: a pilot this size cannot support a "
        "decision rule (pre-registration §6)."
    )

    _print_table(
        "Table 1 — Gini of matches received, among active users",
        "outcome 1 (primary)",
        table_1_gini_of_matches(user_weeks),
    )
    _print_table(
        "Table 2 — Unmatch within 24 hours of reveal",
        "outcome 2 (primary)",
        table_2_unmatch_after_reveal(matches),
    )
    _print_table(
        "Table 3 — Matches per active user-week",
        "outcome 3",
        table_3_matches_per_active_user_week(user_weeks),
    )
    _print_table(
        "Table 4 — Messages per match",
        "outcome 4",
        table_4_messages_per_match(matches),
        interval_places=2,
    )
    _print_table(
        "Table 5 — Share of matches reaching 10 or more messages",
        "outcome 5",
        table_5_deep_conversations(matches),
    )
    _print_table(
        "Table 6 — Weekly retention",
        "outcome 6",
        table_6_weekly_retention(user_weeks),
    )
    _print_table(
        "Table 7 — Survey responses (median, and the 1/2/3/4/5 distribution)",
        "self-reported items S1-S3",
        table_7_survey(surveys),
        interval_places=2,
    )
    _print_table(
        "Table 8 — Policy comparison, M versus C",
        "pre-registered analysis step 2",
        table_8_policy_comparison(user_weeks, matches),
    )

    print("\nModel — unmatch after reveal, with a per-participant random effect")
    print("  (pre-registered analysis step 3)")
    print(f"  {model_unmatch_after_reveal(matches)}")

    print("\n" + "-" * 78)
    print("Eight tables and one model: every pre-registered output (AC-T3-3).")
    if synthetic:
        print("Reminder: this was SYNTHETIC data. Nothing above is a finding.")
    print("-" * 78)


if __name__ == "__main__":
    main()
