"""Reveal policy selection by date (SPEC.md §11.2).

Named "arms" because the field-pilot switchback design (Tier 3, §16) is a two-armed
experiment between policies M and C; this module is where "which arm is active today"
is decided, for both the live server and (eventually) the pilot's pre-registered schedule.
"""

from __future__ import annotations

from datetime import date

from mutual_server.config import Settings


def policy_for_day(settings: Settings, day: str) -> tuple[str, str | None]:
    """The reveal policy active on ``day``, and the next date it changes, if any."""
    d = date.fromisoformat(day)
    active = settings.reveal.default_policy
    upcoming: list[str] = []
    for w in settings.reveal.policy_schedule:
        start, end = date.fromisoformat(w.start), date.fromisoformat(w.end)
        if start <= d <= end:
            active = w.policy
            upcoming.append(date.fromordinal(end.toordinal() + 1).isoformat())
        elif start > d:
            upcoming.append(w.start)
    return active, (min(upcoming) if upcoming else None)
