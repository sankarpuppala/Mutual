"""Seeds one fictional campus with synthetic students, for showing the app.

    python -m mutual_server.demo_seed

**Every person this creates is synthetic** (CLAUDE.md invariant 9): a first name
from a fixed list, no surname, no real email address, no real photo. Nothing
here touches a real account, and this must never be pointed at anything but a
throwaway dev database.

What it does, against an already-running dev server (``MUTUAL_ENV=dev``):

 1. Approves one fictional campus directly through the same service function
    ``python -m mutual_server.admin`` uses -- "Example College", key
    ``example.ac.in``. This is the **only** campus that exists: the server's
    ``campuses:`` config list must be empty (see ``server/config.yaml``), so
    nothing is pre-approved behind this script's back.
 2. Seeds a round of synthetic students via ``POST /dev/seed``, and writes every
    seeded account's full credentials to ``server/demo_accounts.json`` (gitignored),
    so a device can log in *as* one of them through the dev panel's "log in as a
    seeded account" field instead of only crossing paths with it.
 3. Records a handful of crossings among them over the last several days
    (``POST /dev/crossing``), so the Today screen has something to show
    tomorrow without any clock travel: a crossing is just a dated row, and
    the digest reads whatever is within its lookback window at request time.
 4. Drives two pairs to a complete, *notified* mutual match, using the real
    protocol (``mutual_protocol.keys``/``tokens``) to build each side's
    signal set exactly as a device would -- the same construction
    ``server/tests/conftest.py`` uses for its own match fixture, run here over
    the live HTTP API instead of an in-process test client. This needs
    ``POST /dev/clock`` to move the server through an epoch's signal window,
    its batch time, and the next day's digest release -- and this script
    **always restores the clock offset to zero before exiting**, including on
    a failure, so the live server is back on real time afterwards.
 5. Posts a short exchange of messages in one of the two matches.

Idempotent in the sense that matters: running it again approves the same
campus (a no-op) and adds another round of synthetic students on top, rather
than erroring. It does not delete anything.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
from mutual_protocol.encoding import b64url_decode, b64url_encode
from mutual_protocol.keys import pair_key
from mutual_protocol.tokens import interest_token, padded_set

from mutual_server.clock import SystemClock
from mutual_server.config import load_settings
from mutual_server.db import make_engine, make_session_factory
from mutual_server.ids import UuidIds
from mutual_server.services import campus as campus_service

CAMPUS_KEY = "example.ac.in"
CAMPUS_NAME = "Example College"

# Where this run's full seeded credentials are written (gitignored: session tokens, even
# for synthetic accounts, do not belong in git). The app's dev panel has a "log in as a
# seeded account" field that takes one object from this file's "users" list, pasted in --
# that is how a device gets to *be* one of these students instead of just crossing paths
# with them, since onboarding a real device account is a separate, slower path.
ACCOUNTS_FILE = Path(__file__).resolve().parents[1] / "demo_accounts.json"

# A few made-up two-person exchanges, so the chat tab has something real-looking
# in it. Nobody's business but two synthetic accounts talking to each other.
DEMO_MESSAGES = [
    ("a", "hi! did you end up going to the thing on Friday?"),
    ("b", "not yet, still deciding -- is it worth the trek across campus?"),
    ("a", "honestly yes, the filter coffee alone is worth it"),
    ("b", "okay you've convinced me, see you there"),
]


def _approve_campus() -> None:
    """Same path as `python -m mutual_server.admin campuses approve`, direct to the DB."""
    settings = load_settings()
    session_factory = make_session_factory(make_engine(settings.database_url))
    clock, ids = SystemClock(), UuidIds()
    with session_factory() as db:
        campus_service.approve(db, CAMPUS_KEY, CAMPUS_NAME, ids, clock)
    print(f"campus: {CAMPUS_KEY} ({CAMPUS_NAME}) open")


def _seed_students(client: httpx.Client, count: int) -> list[dict]:
    r = client.post("/dev/seed", json={"campus_key": CAMPUS_KEY, "count": count})
    r.raise_for_status()
    users = r.json()
    print(f"seeded {len(users)} synthetic students")
    return users


def _record_crossings(client: httpx.Client, users: list[dict], today: date) -> None:
    """A handful of crossings over the last few days, so there is something to
    show in the Today screen as soon as the digest is next fetched -- no clock
    travel needed, since a crossing is just a dated row (services.digest reads
    whatever falls in its lookback window at request time, not at insert time).
    """
    pairs = [
        (0, 1, 1),
        (0, 2, 2),
        (1, 2, 1),
        (3, 4, 2),
        (3, 5, 3),
        (4, 5, 1),
        (0, 3, 4),
        (2, 5, 2),
    ]
    made = 0
    for ai, bi, days_ago in pairs:
        if ai >= len(users) or bi >= len(users):
            continue
        day = (today - timedelta(days=days_ago)).isoformat()
        r = client.post(
            "/dev/crossing",
            json={"user_a": users[ai]["user_id"], "user_b": users[bi]["user_id"], "day": day},
        )
        r.raise_for_status()
        made += 1
    print(f"recorded {made} crossings over the last few days")


def _offset_for(client: httpx.Client, target: datetime) -> None:
    """Points the server's clock at `target` (UTC-aware) by setting the offset
    POST /dev/clock reads, computed against real now at the moment of the call.

    The direct `datetime.now(UTC)` here is the documented exception in
    `test_no_datetime_now_outside_clock`: this script is not server request-handling logic,
    it is the thing telling a separate process what offset to apply to *its* injected
    clock, so a real wall-clock read is the point rather than the violation CLAUDE.md §6
    guards against.
    """
    offset = (target - datetime.now(UTC)).total_seconds()
    r = client.post("/dev/clock", json={"offset_seconds": offset})
    r.raise_for_status()


def _drive_match(
    client: httpx.Client,
    a: dict,
    b: dict,
    intents: list[str],
    config: dict,
    epoch: date,
) -> str:
    """Builds and uploads a real mutual signal set for `a` and `b` addressed to
    `epoch`, advances the server clock through that epoch's batch and the next
    day's release, and returns the match_id once GET /matches shows it
    notified. Mirrors server/tests/conftest.py's `make_match`, over HTTP
    instead of in-process.

    Each call should use its own `epoch`: two calls sharing one epoch would
    both land in the same batch pass, which the matching logic tolerates fine,
    but reasoning about two independent demo matches is simpler when they are.
    """
    tz_offset_minutes = 330  # Asia/Kolkata, the project's only deployment timezone (SPEC §2)

    def local_midnight(d: date) -> datetime:
        return datetime(d.year, d.month, d.day, tzinfo=UTC) - timedelta(minutes=tz_offset_minutes)

    def at_local(d: date, hhmm: str) -> datetime:
        h, m = (int(x) for x in hhmm.split(":"))
        return local_midnight(d) + timedelta(hours=h, minutes=m)

    sk_a, pk_a = b64url_decode(a["identity_sk"]), b64url_decode(a["identity_pk"])
    sk_b, pk_b = b64url_decode(b["identity_sk"]), b64url_decode(b["identity_pk"])
    k_ab = pair_key(sk_a, pk_a, a["user_id"], pk_b, b["user_id"])
    k_ba = pair_key(sk_b, pk_b, b["user_id"], pk_a, a["user_id"])
    epoch_str = epoch.isoformat()
    real_a = [interest_token(k_ab, epoch_str, i) for i in intents]
    real_b = [interest_token(k_ba, epoch_str, i) for i in intents]

    _offset_for(client, at_local(epoch, config["signal_upload_window"]["start"]))
    for acct, real in ((a, real_a), (b, real_b)):
        tokens = [b64url_encode(t) for t in padded_set(real)]
        r = client.put(
            f"/signals/{epoch_str}",
            json={"tokens": tokens},
            headers={"Authorization": f"Bearer {acct['session_token']}"},
        )
        r.raise_for_status()

    _offset_for(client, at_local(epoch, config["match_batch_time"]))
    _offset_for(client, at_local(epoch + timedelta(days=1), config["digest_release_time"]))

    r = client.get("/matches", headers={"Authorization": f"Bearer {a['session_token']}"})
    r.raise_for_status()
    matches = r.json()
    for m in matches:
        if m["peer"]["peer_id"] == b["user_id"]:
            return m["match_id"]
    raise RuntimeError(
        "the signal exchange did not produce a notified match -- check that "
        "signal_upload_window / match_batch_time / digest_release_time weren't "
        "edited in server/config.yaml without updating this script"
    )


def _send_messages(client: httpx.Client, match_id: str, a: dict, b: dict) -> None:
    by_speaker = {"a": a, "b": b}
    for speaker, body in DEMO_MESSAGES:
        acct = by_speaker[speaker]
        r = client.post(
            f"/matches/{match_id}/messages",
            json={"body": body},
            headers={"Authorization": f"Bearer {acct['session_token']}"},
        )
        r.raise_for_status()
    print(f"posted {len(DEMO_MESSAGES)} messages in match {match_id}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000/v1")
    parser.add_argument("--count", type=int, default=12, help="synthetic students to seed")
    args = parser.parse_args(argv)

    _approve_campus()

    with httpx.Client(base_url=args.base_url, timeout=10.0) as client:
        try:
            r = client.get("/config")
            r.raise_for_status()
            config = r.json()

            # The server's own notion of today (SPEC §6.11: "never its own clock" -- that
            # rule is for app clients, but it is exactly as true of this script. Using
            # date.today() here would be the operator's machine's day, which can disagree
            # with the deployment's if the two are ever in different timezones.
            today = date.fromisoformat(config["epoch"])

            users = _seed_students(client, args.count)
            _record_crossings(client, users, today)

            matches: list[str] = []
            if len(users) >= 6:
                match_id = _drive_match(
                    client, users[0], users[1], ["study", "project"], config, today
                )
                _send_messages(client, match_id, users[0], users[1])
                matches.append(match_id)
                matches.append(
                    _drive_match(
                        client, users[3], users[4], ["friend"], config, today - timedelta(days=1)
                    )
                )
            else:
                print("fewer than 6 students seeded; skipping the match demo", file=sys.stderr)

            ACCOUNTS_FILE.write_text(
                json.dumps({"campus": CAMPUS_KEY, "matches": matches, "users": users}, indent=2),
                encoding="utf-8",
            )
            print(f"wrote {len(users)} accounts' credentials to {ACCOUNTS_FILE}")
        finally:
            # However it went, the live server must be back on real time afterwards.
            client.post("/dev/clock", json={"offset_seconds": 0})
            print("server clock restored to real time")

    print("\ndone. open the app against this server; sign in is not needed to look --")
    print(f"the campus is {CAMPUS_NAME} ({CAMPUS_KEY}), every account above is synthetic.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
