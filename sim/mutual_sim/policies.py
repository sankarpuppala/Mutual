"""Reveal policies P, M, C (SPEC.md §11.2, §15.4).

- **P** (photo at discovery): the photo is visible while browsing, before any signal.
  Simulation-only (decision D9) — the real server never implements it.
- **M** (photo at match, the server default): photos become visible the moment a
  match is notified.
- **C** (photo after conversation): photos become visible once both sides have sent
  ``n_reveal`` messages each (or both consented; the simulation only has the message
  count, so it uses that).
"""

from __future__ import annotations

from enum import StrEnum

POLICIES: tuple[str, ...] = ("P", "M", "C")


class Policy(StrEnum):
    P = "P"
    M = "M"
    C = "C"


def photo_visible_at_discovery(policy: str) -> bool:
    """§15.3: "Photos are visible at discovery only under policy P."""
    return policy == Policy.P


def rounds_to_reveal(policy: str, n_reveal: int) -> int:
    """How many pre-reveal conversation rounds this policy requires (§15.4).

    M and P both reveal "immediately" (M at notification; P trivially, since the
    photo was already seen at discovery) — zero additional rounds either way.
    """
    return n_reveal if policy == Policy.C else 0


def reveal_progress(policy: str) -> float:
    """The ``progress`` term in the reveal continuation sigmoid (§15.4): the fraction
    of ``n_reveal`` rounds completed at the moment of the reveal check. For M and P
    the reveal happens with zero rounds elapsed; for C, by definition all of them have.
    """
    return 1.0 if policy == Policy.C else 0.0
