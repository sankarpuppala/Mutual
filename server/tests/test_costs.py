"""AC-T1-8: measure the protocol's real costs and keep docs/SECURITY_ARGUMENT.md honest.

Every number here is produced by sending a genuine request through the real app and
measuring the bytes the server received -- never by hand arithmetic. The costs block in
``docs/SECURITY_ARGUMENT.md`` is then asserted to match, so the document cannot drift away
from the code (CLAUDE.md §8 rule 4: never invent results).

Run ``python -m pytest server/tests/test_costs.py -s -k print_costs`` to see the table.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable

import pytest
from conftest import Harness, auth, make_shared_token, signup
from mutual_protocol.encoding import b64url_encode
from mutual_protocol.keys import pair_key
from mutual_protocol.tokens import interest_token, padded_set

from mutual_server.clock import add_days, at_local
from mutual_server.config import REPO_ROOT

SECURITY_ARGUMENT = REPO_ROOT / "docs" / "SECURITY_ARGUMENT.md"
COSTS_BLOCK = re.compile(r"```measured-costs\n(.*?)```", re.DOTALL)


def _compact(body: dict[str, object]) -> bytes:
    """The bytes a client puts on the wire: compact JSON, as ``api/client.ts`` sends it."""
    return json.dumps(body, separators=(",", ":")).encode("utf-8")


def _measure_signal_upload(h: Harness) -> int:
    """Bytes in one epoch's padded signal set upload (SPEC §6.7, §6.11)."""
    a = signup(h, "cost-a@example.ac.in", name="Asha")
    b = signup(h, "cost-b@example.ac.in", name="Bela")
    day = "2026-10-05"
    k = pair_key(a.sk, a.pk, a.user_id, b.pk, b.user_id)
    real = [interest_token(k, day, "date")]
    body = {"tokens": [b64url_encode(t) for t in padded_set(real)]}
    content = _compact(body)

    h.clock.set(at_local(day, h.settings.signals.upload_window_start, h.settings.tz))
    r = h.client.put(
        f"/v1/signals/{day}",
        content=content,
        headers={**auth(a.token), "Content-Type": "application/json"},
    )
    assert r.status_code == 201, r.text
    return len(content)


def _measure_presence_upload(h: Harness, sightings: int) -> int:
    """Bytes in one night's padded encounter-token upload for ``sightings`` real sightings."""
    account = signup(h, f"cost-p{sightings}@example.ac.in", name="Priya")
    day = "2026-10-04"
    real = [make_shared_token(day, interval=i % 96) for i in range(sightings)]
    from mutual_protocol.encounter import padded_encounter_set

    body = {"encounters": [b64url_encode(t) for t in padded_encounter_set(real)]}
    content = _compact(body)

    h.clock.set(at_local(add_days(day, 1), h.settings.presence.upload_window_start, h.settings.tz))
    r = h.client.post(
        f"/v1/presence/{day}",
        content=content,
        headers={**auth(account.token), "Content-Type": "application/json"},
    )
    assert r.status_code == 201, r.text
    return len(content)


def _worst_case_match_latency_hours(h: Harness) -> float:
    """Hours from tapping a signal to both sides being told, in the worst case.

    The worst case is a tap that arrives a moment after this epoch's single upload has
    already gone out (SPEC §6.11: exactly once per epoch, at a random time in the window).
    The signal then waits for the next epoch: next night's upload, that night's batch, and
    the release time on the morning after. Measured against the real clock helpers and the
    configured times, not assumed.
    """
    tz = h.settings.tz
    day = "2026-10-05"
    # Earliest possible "too late" tap: the epoch's upload happened at the window's start.
    tap = at_local(day, h.settings.signals.upload_window_start, tz)
    # The signal rides the next epoch (day + 1); its batch runs that night...
    batch = at_local(add_days(day, 1), h.settings.signals.match_batch_time, tz)
    # ...and the match is notified at the next release time (SPEC §6.9 fair delivery).
    notified = at_local(add_days(day, 2), h.settings.digest.release_time, tz)
    assert batch < notified
    return (notified - tap).total_seconds() / 3600.0


def _digest_to_notification_hours(h: Harness) -> float:
    """Hours from seeing a crossing in the digest to being told about the match."""
    tz = h.settings.tz
    day = "2026-10-05"
    seen = at_local(day, h.settings.digest.release_time, tz)
    notified = at_local(add_days(day, 1), h.settings.digest.release_time, tz)
    return (notified - seen).total_seconds() / 3600.0


def _crossing_to_notification_hours(h: Harness) -> float:
    """Hours from the crossing itself to the match notification, in the worst case.

    Worst case because the crossing happens at the very start of the day, so it waits the
    longest for that day's digest. A crossing just before midnight costs 24 hours less.
    """
    tz = h.settings.tz
    day = "2026-10-05"
    crossed = at_local(day, "00:00", tz)
    notified = at_local(add_days(day, 2), h.settings.digest.release_time, tz)
    return (notified - crossed).total_seconds() / 3600.0


def measure_all(make_harness: Callable[..., Harness]) -> dict[str, float]:
    """Every AC-T1-8 cost, each from a fresh app instance."""
    return {
        "signal_upload_bytes": float(_measure_signal_upload(make_harness())),
        "presence_upload_bytes_50_sightings": float(_measure_presence_upload(make_harness(), 50)),
        "presence_upload_bytes_500_sightings": float(_measure_presence_upload(make_harness(), 500)),
        "worst_case_match_latency_hours": _worst_case_match_latency_hours(make_harness()),
        "digest_to_notification_hours": _digest_to_notification_hours(make_harness()),
        "crossing_to_notification_hours": _crossing_to_notification_hours(make_harness()),
    }


def _fmt(value: float) -> str:
    return str(int(value)) if value == int(value) else f"{value:.1f}"


def test_print_costs(make_harness: Callable[..., Harness]) -> None:
    """Human-readable table, and a sanity floor on each number."""
    costs = measure_all(make_harness)
    print("\nAC-T1-8 measured costs")
    for key, value in costs.items():
        print(f"  {key} = {_fmt(value)}")
    assert costs["signal_upload_bytes"] > 20 * 43  # 20 tokens, 43 base64url chars each
    assert (
        costs["presence_upload_bytes_500_sightings"] > costs["presence_upload_bytes_50_sightings"]
    )
    assert costs["worst_case_match_latency_hours"] > costs["digest_to_notification_hours"]


def test_security_argument_records_the_measured_costs(
    make_harness: Callable[..., Harness],
) -> None:
    """The document's costs block must equal what the code actually does (AC-T1-8)."""
    assert SECURITY_ARGUMENT.exists(), "docs/SECURITY_ARGUMENT.md is required by AC-T1-10"
    block = COSTS_BLOCK.search(SECURITY_ARGUMENT.read_text(encoding="utf-8"))
    assert block, "docs/SECURITY_ARGUMENT.md must contain a ```measured-costs``` block"

    recorded: dict[str, str] = {}
    for line in block.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        recorded[key.strip()] = value.strip()

    measured = {key: _fmt(value) for key, value in measure_all(make_harness).items()}
    assert recorded == measured, (
        "docs/SECURITY_ARGUMENT.md has drifted from the code. Measured now:\n"
        + "\n".join(f"{k} = {v}" for k, v in measured.items())
    )


def test_padding_hides_how_many_sightings_a_small_night_had(
    make_harness: Callable[..., Harness],
) -> None:
    """The cost of privacy, measured: 1 and 50 sightings cost exactly the same bytes."""
    one = _measure_presence_upload(make_harness(), 1)
    fifty = _measure_presence_upload(make_harness(), 50)
    assert one == fifty


def _minutes(hhmm: str) -> int:
    hours, minutes = (int(part) for part in hhmm.split(":"))
    return hours * 60 + minutes


def test_upload_window_is_long_enough_to_hide_the_upload_time(h: Harness) -> None:
    """A random upload time is only cover if the window is wide (SPEC §6.11, D4).

    Minutes-of-day arithmetic rather than datetimes: these are wall-clock times in the
    configured timezone, not instants, and parsing them into naive datetimes would invite
    exactly the timezone confusion CLAUDE.md §6 warns about.
    """
    width = _minutes(h.settings.signals.upload_window_end) - _minutes(
        h.settings.signals.upload_window_start
    )
    assert width >= 60


if __name__ == "__main__":  # pragma: no cover - convenience for a one-off measurement
    pytest.main([__file__, "-s", "-k", "print_costs"])
