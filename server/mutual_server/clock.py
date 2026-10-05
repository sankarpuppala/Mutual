"""The injectable clock (CLAUDE.md §6). Nothing else in the server reads the system time.

All values are timezone-aware. "Day" and "epoch" are local dates in the
configured timezone, formatted YYYY-MM-DD (SPEC.md §6.3).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo


class Clock:
    """Base clock with a dev-only offset (set by POST /v1/dev/clock), in seconds."""

    def __init__(self) -> None:
        self.offset_seconds: float = 0.0

    def _base_now(self) -> datetime:
        raise NotImplementedError

    def now(self) -> datetime:
        """Current time, UTC, including the dev offset."""
        return self._base_now() + timedelta(seconds=self.offset_seconds)


class SystemClock(Clock):
    """Wall-clock time. The only place the server calls ``datetime.now``."""

    def _base_now(self) -> datetime:
        return datetime.now(UTC)


class FixedClock(Clock):
    """A settable clock for tests."""

    def __init__(self, start: datetime) -> None:
        super().__init__()
        if start.tzinfo is None:
            raise ValueError("FixedClock needs a timezone-aware datetime")
        self._now = start.astimezone(UTC)

    def _base_now(self) -> datetime:
        return self._now

    def set(self, when: datetime) -> None:
        self._now = when.astimezone(UTC)

    def advance(self, **delta: float) -> None:
        self._now += timedelta(**delta)


def local_now(clock: Clock, tz: ZoneInfo) -> datetime:
    return clock.now().astimezone(tz)


def local_day(clock: Clock, tz: ZoneInfo) -> str:
    """Today's local date as YYYY-MM-DD (also the current signal epoch)."""
    return local_now(clock, tz).date().isoformat()


def parse_hhmm(value: str) -> time:
    hh, mm = value.split(":")
    return time(int(hh), int(mm))


def at_local(day: str, hhmm: str, tz: ZoneInfo) -> datetime:
    """The UTC instant of local time ``hhmm`` on local date ``day``."""
    return datetime.combine(date.fromisoformat(day), parse_hhmm(hhmm), tzinfo=tz).astimezone(UTC)


def add_days(day: str, n: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=n)).isoformat()
