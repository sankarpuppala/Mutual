"""Generate a synthetic study export (SPEC.md §16, PLAN.md Phase 12).

This exists so the analysis pipeline can be written, tested and reviewed **before any real
participant exists** -- which is the only way to be sure, on the first real day, that
`analyze.py` works and that nobody has to touch live data to debug it.

What it is not: evidence. Every number this produces is made up, and
`study/PREREGISTRATION.md` §2 is the honest account of what the pilot can show. The
generator deliberately builds in a small policy effect so the analysis has something to
find; **a run on this file proves the pipeline works and nothing about reveal policies.**
Every table `analyze.py` prints from it carries that warning.

The schema here is the contract `export.py` will have to produce. `export.py` itself is
**not written**: CLAUDE.md invariant 9 forbids writing code that exports real-user data
until `study.approval_reference` is set and `study/APPROVAL.md` exists.

Run:
    python study/analysis/make_synthetic_export.py --out study/analysis/synthetic_export.csv
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

# Four two-week blocks, in the order fixed by study/PREREGISTRATION.md §3.
BLOCKS: tuple[tuple[int, str], ...] = ((1, "M"), (2, "C"), (3, "M"), (4, "C"))
WEEKS_PER_BLOCK = 2

# The columns export.py must produce. One row per (participant, week) and one row per
# match, distinguished by `row_type`, so a single CSV carries both and the analysis never
# has to join two files that could disagree.
COLUMNS: tuple[str, ...] = (
    "row_type",  # "user_week" | "match" | "survey"
    "participant",  # HMAC of the user id under the study salt, never a user id
    "block",
    "policy",  # M | C
    "week",  # 1..8, for user_week rows
    "active",  # 0/1, for user_week rows: opened the digest at least once
    "matches",  # count, for user_week rows
    "messages_sent",  # count, for user_week rows
    "unmatches",  # count, for user_week rows
    "match_id",  # HMAC, for match rows
    "peer",  # HMAC of the other participant, for match rows
    "reveal_reached",  # 0/1, for match rows
    "messages_a",  # count from this participant, for match rows
    "messages_b",  # count from the peer, for match rows
    "ended_within_24h_of_reveal",  # 0/1, for match rows
    "s1_comfortable",  # 1..5, for survey rows
    "s2_frustrated_no_photo",  # 1..5
    "s3_satisfied",  # 1..5
)


@dataclass
class Assumptions:
    """Made-up parameters. Changing them changes nothing about reality."""

    participants: int = 40
    seed: int = 7
    #: Weekly chance a participant is active at all, and how it decays over the pilot.
    base_activity: float = 0.82
    weekly_decay: float = 0.04
    #: Expected matches per active participant-week, by policy.
    match_rate: dict[str, float] = field(default_factory=lambda: {"M": 0.55, "C": 0.40})
    #: Concentration of matches: higher means a few participants take most of them.
    concentration: dict[str, float] = field(
        default_factory=lambda: {"M": 1.9, "C": 1.3}
    )
    #: Chance a match is ended within 24 h of its reveal, by policy.
    unmatch_after_reveal: dict[str, float] = field(
        default_factory=lambda: {"M": 0.22, "C": 0.11}
    )
    #: Mean messages each side sends in a match, by policy.
    messages_each: dict[str, float] = field(
        default_factory=lambda: {"M": 5.0, "C": 9.0}
    )


def _weeks_of(block: int) -> list[int]:
    first = (block - 1) * WEEKS_PER_BLOCK + 1
    return [first + i for i in range(WEEKS_PER_BLOCK)]


def generate(assumptions: Assumptions) -> list[dict[str, object]]:
    """Build the rows. Deterministic for a given seed, like everything else in this repo."""
    rng = np.random.default_rng(assumptions.seed)
    # Pseudonymous ids. In a real export these are HMACs; here they are obviously fake, so
    # nobody can mistake this file for real data.
    people = [f"synthetic-{i:03d}" for i in range(assumptions.participants)]

    # A per-participant "appeal" weight, which is what produces concentration. It is a
    # modelling device, not a measurement of anybody.
    appeal = rng.gamma(shape=2.0, scale=1.0, size=assumptions.participants)
    appeal /= appeal.mean()

    rows: list[dict[str, object]] = []
    match_counter = 0

    for block, policy in BLOCKS:
        for week in _weeks_of(block):
            activity = max(
                0.1, assumptions.base_activity - assumptions.weekly_decay * (week - 1)
            )
            active_flags = rng.random(assumptions.participants) < activity

            # Matches for the week, concentrated by appeal raised to a policy-dependent power.
            weights = appeal ** assumptions.concentration[policy]
            weights = weights / weights.mean()
            lam = assumptions.match_rate[policy] * weights * active_flags
            match_counts = rng.poisson(lam)

            for index, person in enumerate(people):
                active = bool(active_flags[index])
                matches = int(match_counts[index])
                messages = (
                    int(rng.poisson(assumptions.messages_each[policy] * matches))
                    if matches
                    else 0
                )
                unmatches = int(rng.binomial(matches, 0.18)) if matches else 0

                rows.append(
                    {
                        "row_type": "user_week",
                        "participant": person,
                        "block": block,
                        "policy": policy,
                        "week": week,
                        "active": int(active),
                        "matches": matches,
                        "messages_sent": messages,
                        "unmatches": unmatches,
                    }
                )

                for _ in range(matches):
                    match_counter += 1
                    peer = people[int(rng.integers(assumptions.participants))]
                    if peer == person:
                        continue
                    reveal = int(rng.random() < (0.95 if policy == "M" else 0.6))
                    a = int(rng.poisson(assumptions.messages_each[policy]))
                    b = int(rng.poisson(assumptions.messages_each[policy]))
                    ended = (
                        int(rng.random() < assumptions.unmatch_after_reveal[policy])
                        if reveal
                        else 0
                    )
                    rows.append(
                        {
                            "row_type": "match",
                            "participant": person,
                            "block": block,
                            "policy": policy,
                            "week": week,
                            "match_id": f"synthetic-match-{match_counter:05d}",
                            "peer": peer,
                            "reveal_reached": reveal,
                            "messages_a": a,
                            "messages_b": b,
                            "ended_within_24h_of_reveal": ended,
                        }
                    )

        # One optional survey response per participant per block, with a response rate.
        for index, person in enumerate(people):
            if rng.random() > 0.65:
                continue
            # Frustration at not seeing a photo is higher under C, by construction.
            frustration_mean = 3.6 if policy == "C" else 2.2
            rows.append(
                {
                    "row_type": "survey",
                    "participant": person,
                    "block": block,
                    "policy": policy,
                    "s1_comfortable": _likert(rng, 4.0),
                    "s2_frustrated_no_photo": _likert(rng, frustration_mean),
                    "s3_satisfied": _likert(rng, 3.8 if policy == "M" else 3.4),
                }
            )

    return rows


def _likert(rng: np.random.Generator, mean: float) -> int:
    """A 1-5 response clustered around `mean`."""
    return int(np.clip(round(rng.normal(mean, 0.9)), 1, 5))


def write_csv(rows: list[dict[str, object]], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(COLUMNS), extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in COLUMNS})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("study/analysis/synthetic_export.csv"),
        help="where to write the CSV",
    )
    parser.add_argument("--participants", type=int, default=40)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    assumptions = Assumptions(participants=args.participants, seed=args.seed)
    rows = generate(assumptions)
    write_csv(rows, args.out)

    kinds = {
        kind: sum(1 for r in rows if r["row_type"] == kind)
        for kind in ("user_week", "match", "survey")
    }
    print(f"wrote {len(rows)} synthetic rows to {args.out}")
    print(
        f"  {kinds['user_week']} user-week, {kinds['match']} match, {kinds['survey']} survey"
    )
    print(
        "These numbers are invented. They are for testing the pipeline, not for reporting."
    )


if __name__ == "__main__":
    main()
