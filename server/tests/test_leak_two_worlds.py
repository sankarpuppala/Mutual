"""AC-T1-5 / C1 — the most important test in the repository (CLAUDE.md §7).

Three worlds, built from byte-identical setup (same deterministic ids, same clock):

  A — U signals V for "date". V never signals back.
  B — U signals no one.
  C — U signals V for "date", and V signals U back for "date" (reciprocates).

C1 claims that, except for the random bytes of ``epoch_tokens.token`` while it still
exists, worlds A and B are indistinguishable to *every* account's request log, stored
rows and response bodies — and that this holds *before* the nightly batch runs too
(fair delivery removes timing as a channel). World C exists only to prove the harness
can tell the difference when there genuinely is one: before ``notify_after`` it must
look exactly like B; after it, a match must appear.

Everything is observed from the *client's own* request/response objects — this test
adds no server-side logging of its own (CLAUDE.md §9: request-path logging stays off).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from conftest import Account, Harness, auth, login
from mutual_protocol.encoding import b64url_encode
from mutual_protocol.keys import pair_key, public_key
from mutual_protocol.tokens import interest_token, padded_set

from mutual_server.clock import add_days, at_local
from mutual_server.services.matching import release_due_tokens, run_match_batch

EMAILS = {"U": "u@example.ac.in", "V": "v@example.ac.in", "W": "w@example.ac.in"}
DAY = "2026-10-04"  # the epoch under test; crossed and signalled on this local day
REDACT = "<REDACTED>"


def _deterministic_keypair(seed: str) -> tuple[bytes, bytes]:
    """A fixed, non-random key pair for a given name, so worlds differ only in the one
    thing under test — never in incidental CSPRNG output (test input, not server output)."""
    sk = hashlib.blake2b(seed.encode("ascii"), digest_size=32, person=b"leak-test-seed01").digest()
    return sk, public_key(sk)


def _signup(h: Harness, name: str, email: str) -> Account:
    """Like conftest.signup, but with a deterministic identity key (see above)."""
    token = login(h, email)
    sk, pk = _deterministic_keypair(name)
    r = h.client.post(
        "/v1/account",
        json={
            "date_of_birth": "2004-05-01",
            "identity_pk": b64url_encode(pk),
            "first_name": "Ananya",
            "year_of_study": 3,
        },
        headers=auth(token),
    )
    assert r.status_code == 201, r.text
    return Account(token=token, user_id=r.json()["user_id"], sk=sk, pk=pk)


# ---------------------------------------------------------------------------
# A client that observes exactly what a passive network sniffer would: method,
# path, query, request body length, and status — nothing the server computed.
# ---------------------------------------------------------------------------
@dataclass
class RequestLog:
    entries: list[tuple[str, str, str, int, int]] = field(default_factory=list)
    bodies: list[Any] = field(default_factory=list)


class LoggedClient:
    def __init__(self, harness: Harness, log: RequestLog) -> None:
        self._h = harness
        self._log = log

    def _call(self, method: str, url: str, **kw: Any) -> Any:
        json_body = kw.get("json")
        body_len = len(json.dumps(json_body).encode()) if json_body is not None else 0
        path, _, query = url.partition("?")
        r = self._h.client.request(method, url, **kw)
        self._log.entries.append((method, path, query, body_len, r.status_code))
        try:
            parsed = r.json()
        except ValueError:
            parsed = None
        self._log.bodies.append(_redact(parsed))
        return r

    def get(self, url: str, **kw: Any) -> Any:
        return self._call("GET", url, **kw)

    def post(self, url: str, **kw: Any) -> Any:
        return self._call("POST", url, **kw)

    def put(self, url: str, **kw: Any) -> Any:
        return self._call("PUT", url, **kw)


def _redact(value: Any) -> Any:
    """Mask fields that are genuinely random every run, in any world (session tokens).

    Nothing privacy-relevant is masked: a real leak would show up as a difference in
    the *shape*, *presence*, or *content* of some other field, none of which this touches.
    """
    if isinstance(value, dict):
        return {k: (REDACT if k == "session_token" else _redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


# ---------------------------------------------------------------------------
# The world builder: byte-identical setup and request sequence for every world,
# differing only in which real tokens (if any) go into each account's padded set.
# ---------------------------------------------------------------------------
@dataclass
class World:
    harness: Harness
    log: RequestLog
    accounts: dict[str, Account]
    epoch_token_counts_before_batch: dict[str, int]
    pre_release_matches: dict[str, Any]


def _real_tokens(world: str, mover: str, accounts: dict[str, Account]) -> list[bytes]:
    """The real (non-dummy) tokens this account includes in its epoch's signal set."""
    if mover == "U" and world in ("A", "C"):
        k = pair_key(
            accounts["U"].sk,
            accounts["U"].pk,
            accounts["U"].user_id,
            accounts["V"].pk,
            accounts["V"].user_id,
        )
        return [interest_token(k, DAY, "date")]
    if mover == "V" and world == "C":
        k = pair_key(
            accounts["V"].sk,
            accounts["V"].pk,
            accounts["V"].user_id,
            accounts["U"].pk,
            accounts["U"].user_id,
        )
        return [interest_token(k, DAY, "date")]
    return []


def _build_world(make_harness: Any, world: str) -> World:
    h: Harness = make_harness()
    log = RequestLog()
    c = LoggedClient(h, log)

    accounts = {name: _signup(h, name, email) for name, email in EMAILS.items()}
    for acct in accounts.values():
        c.get("/v1/config", headers=auth(acct.token))

    # The same crossing exists in every world: U-V (so U can signal V) and U-W, V-W
    # (so a bystander relationship exists too; W never signals anyone in any world).
    with h.db() as db:
        from mutual_server.models import Crossing

        for a, b in (("U", "V"), ("U", "W"), ("V", "W")):
            lo, hi = sorted((accounts[a].user_id, accounts[b].user_id))
            db.add(
                Crossing(day=DAY, user_lo=lo, user_hi=hi, token=b"x" * 32, created_at=h.clock.now())
            )
        db.commit()

    window_start = at_local(DAY, h.settings.signals.upload_window_start, h.settings.tz)
    h.clock.set(window_start)

    for name in ("U", "V", "W"):
        real = _real_tokens(world, name, accounts)
        tokens = [b64url_encode(t) for t in padded_set(real)]
        c.put(f"/v1/signals/{DAY}", json={"tokens": tokens}, headers=auth(accounts[name].token))

    epoch_counts = {}
    with h.db() as db:
        from mutual_server.models import EpochToken

        for name in ("U", "V", "W"):
            epoch_counts[name] = (
                db.query(EpochToken).filter_by(epoch=DAY, user_id=accounts[name].user_id).count()
            )

    # Still inside the same epoch, well before match_batch_time: every account's
    # behaviour must be unobservable right now, in every world (fair delivery).
    pre_release = {}
    for name in ("U", "V", "W"):
        r = c.get("/v1/matches", headers=auth(accounts[name].token))
        pre_release[name] = _redact(r.json())

    return World(
        harness=h,
        log=log,
        accounts=accounts,
        epoch_token_counts_before_batch=epoch_counts,
        pre_release_matches=pre_release,
    )


def _run_batch(world: World) -> None:
    h = world.harness
    h.clock.set(
        at_local(DAY, h.settings.signals.match_batch_time, h.settings.tz) + timedelta(seconds=1)
    )
    with h.db() as db:
        run_match_batch(db, h.clock, h.settings, _ids(h))


def _matches_now(world: World, name: str) -> Any:
    r = world.harness.client.get("/v1/matches", headers=auth(world.accounts[name].token))
    return _redact(r.json())


def _run_release(world: World) -> None:
    h = world.harness
    h.clock.set(at_local(add_days(DAY, 1), h.settings.digest.release_time, h.settings.tz))
    with h.db() as db:
        release_due_tokens(db, h.clock)


def _ids(h: Harness) -> Any:
    # The harness's app already owns an IdFactory; reuse it so match ids stay
    # deterministic (SequentialIds), matching the rest of this world's objects.
    return h.client.app.state.ctx.ids


def _dump(h: Harness, mask_tables: dict[str, set[str]]) -> dict[str, list[tuple]]:
    """Every table's rows as sorted tuples, with the named columns masked per table."""
    from sqlalchemy import inspect as sa_inspect

    out: dict[str, list[tuple]] = {}
    insp = sa_inspect(h.engine)
    with h.engine.connect() as conn:
        from sqlalchemy import text

        for table in insp.get_table_names():
            cols = [c["name"] for c in insp.get_columns(table)]
            masked = mask_tables.get(table, set())
            rows = []
            for row in conn.execute(text(f'SELECT * FROM "{table}"')):
                rows.append(tuple(REDACT if cols[i] in masked else v for i, v in enumerate(row)))
            out[table] = sorted(rows, key=repr)
    return out


MASK = {"epoch_tokens": {"token"}, "sessions": {"token_hash"}}


def test_worlds_a_and_b_are_indistinguishable_and_c_is_not_vacuous(make_harness: Any) -> None:
    a = _build_world(make_harness, "A")
    b = _build_world(make_harness, "B")
    c = _build_world(make_harness, "C")

    # --- every account's request log is byte-identical between A and B ------
    assert a.log.entries == b.log.entries

    # --- every account's response bodies are identical (session tokens masked) ---
    assert a.log.bodies == b.log.bodies

    # --- before match_batch_time, every account still holds exactly 20 tokens ---
    assert a.epoch_token_counts_before_batch == {"U": 20, "V": 20, "W": 20}
    assert b.epoch_token_counts_before_batch == {"U": 20, "V": 20, "W": 20}
    assert c.epoch_token_counts_before_batch == {"U": 20, "V": 20, "W": 20}

    # --- before notify_after, A, B and C all look the same: no match, anywhere ---
    assert (
        a.pre_release_matches
        == b.pre_release_matches
        == c.pre_release_matches
        == {
            "U": [],
            "V": [],
            "W": [],
        }
    )

    # --- stored rows: identical between A and B, right up to the batch --------
    dump_a = _dump(a.harness, MASK)
    dump_b = _dump(b.harness, MASK)
    assert dump_a == dump_b

    # --- and structurally: a one-sided signal leaves no match artifact at all ---
    with a.harness.db() as db:
        from mutual_server.models import Match, MatchToken

        assert db.query(Match).count() == 0
        assert db.query(MatchToken).count() == 0
    with b.harness.db() as db:
        from mutual_server.models import Match, MatchToken

        assert db.query(Match).count() == 0
        assert db.query(MatchToken).count() == 0

    # --- run the batch in all three worlds --------------------------------------
    _run_batch(a)
    _run_batch(b)
    _run_batch(c)

    # --- the batch has now created pending rows in world C, but notify_after
    #     hasn't arrived yet: every account must still see nothing, everywhere ---
    after_batch_before_release = {
        world_name: {name: _matches_now(w, name) for name in ("U", "V", "W")}
        for world_name, w in (("A", a), ("B", b), ("C", c))
    }
    assert after_batch_before_release["A"] == {"U": [], "V": [], "W": []}
    assert after_batch_before_release["B"] == {"U": [], "V": [], "W": []}
    assert after_batch_before_release["C"] == {"U": [], "V": [], "W": []}

    # --- release in all three worlds --------------------------------------------
    _run_release(a)
    _run_release(b)
    _run_release(c)

    # --- A and B remain indistinguishable after the batch too ------------------
    dump_a_after = _dump(a.harness, MASK)
    dump_b_after = _dump(b.harness, MASK)
    assert dump_a_after == dump_b_after
    with a.harness.db() as db:
        from mutual_server.models import Match

        assert db.query(Match).count() == 0
    with b.harness.db() as db:
        from mutual_server.models import Match

        assert db.query(Match).count() == 0

    # --- not vacuous: C, and only C, now shows a match to both U and V ---------
    log_c = RequestLog()
    client_c = LoggedClient(c.harness, log_c)
    u_matches = client_c.get("/v1/matches", headers=auth(c.accounts["U"].token)).json()
    v_matches = client_c.get("/v1/matches", headers=auth(c.accounts["V"].token)).json()
    w_matches = client_c.get("/v1/matches", headers=auth(c.accounts["W"].token)).json()
    assert len(u_matches) == 1 and u_matches[0]["peer"]["peer_id"] == c.accounts["V"].user_id
    assert len(v_matches) == 1 and v_matches[0]["peer"]["peer_id"] == c.accounts["U"].user_id
    assert w_matches == []
    assert u_matches[0]["state"] == "active"
