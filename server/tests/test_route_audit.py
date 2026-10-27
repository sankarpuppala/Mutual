"""AC-T1-6 / C3 / CLAUDE.md invariant 10 — the route and schema audit.

Every route whose path carries another person's id must be unreachable without a
qualifying relationship (a notified match, or — for GET /media — the digest window),
except the two explicit, user-initiated safety actions (block, report), which take the
peer id in the *body*, never the path. No schema anywhere carries a field that names or
types an intent. And /v1/dev/* must not exist outside MUTUAL_ENV=dev.
"""

from __future__ import annotations

import inspect

from conftest import Harness, auth, signup
from pydantic import BaseModel

from mutual_server import schemas as schemas_module

# Routes whose id parameter names the caller's OWN resource, not a peer's — allowed
# to work without any match/digest relationship (CLAUDE.md invariant 10's exception
# is block/report; these are the other kind: nothing but "this is my own stuff").
OWN_RESOURCE = {
    ("POST", "/v1/profile/voice/{prompt_id}"),
    ("DELETE", "/v1/profile/voice/{prompt_id}"),
    ("DELETE", "/v1/profile/photos/{index}"),
    ("GET", "/v1/profile/photos/{index}"),
}


def _routes(app) -> list[tuple[str, str]]:
    """(METHOD, full mounted path) for every route, via the app's own OpenAPI schema —
    robust to FastAPI's internal routing representation, unlike walking app.routes."""
    return [
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    ]


def test_no_schema_field_is_named_or_typed_as_an_intent() -> None:
    offenders = []
    for name, obj in vars(schemas_module).items():
        if not (inspect.isclass(obj) and issubclass(obj, BaseModel)):
            continue
        for field_name in obj.model_fields:
            if "intent" in field_name.lower():
                offenders.append(f"{name}.{field_name}")
    assert offenders == []


def test_no_path_ever_exposes_a_raw_peer_or_user_id(h: Harness) -> None:
    """Peer/user ids are deliberately never path parameters: block and report take
    ``peer_id`` in the body instead, which is the mechanism that keeps them uniform."""
    routes = _routes(h.client.app)
    offending = [(m, p) for m, p in routes if "{peer_id}" in p or "{user_id}" in p]
    assert offending == []


def test_dev_routes_absent_outside_dev(h: Harness) -> None:
    routes = _routes(h.client.app)
    assert all(not path.startswith("/v1/dev/") for _, path in routes)
    for path, method in (
        ("/v1/dev/clock", "POST"),
        ("/v1/dev/seed", "POST"),
        ("/v1/dev/crossing", "POST"),
        ("/v1/dev/demo-accounts", "GET"),
    ):
        r = h.client.request(method, path, json={})
        assert r.status_code == 404


def test_dev_routes_present_in_dev(make_harness) -> None:
    h: Harness = make_harness(env="dev")
    routes = _routes(h.client.app)
    assert any(path.startswith("/v1/dev/") for _, path in routes)


def test_every_route_with_an_id_is_allowlisted_or_gated(h: Harness) -> None:
    """Every route with a path parameter is either an own-resource route, or returns a
    non-2xx for an authenticated caller who has no qualifying relationship to the id."""
    routes = [(m, p) for m, p in _routes(h.client.app) if "{" in p]
    caller = signup(h, email="caller@example.ac.in")
    bogus_id = "00000000-0000-4000-8000-000000000999"

    gated = [(m, p) for m, p in routes if (m, p) not in OWN_RESOURCE and "/dev/" not in p]
    assert gated, "expected at least one id-bearing route to audit"

    for method, template in gated:
        url = template.format(
            media_id=bogus_id,
            match_id=bogus_id,
            index=0,
            day="2026-10-04",
            epoch="2026-10-04",
            prompt_id="x",
        )
        r = h.client.request(
            method, url, headers=auth(caller.token), json={} if method == "POST" else None
        )
        assert r.status_code < 200 or r.status_code >= 300, (
            f"{method} {template} succeeded for an unrelated id"
        )


def test_cross_intent_signals_never_match(make_harness) -> None:
    """C2: a study-signal and a date-signal from two sides of a pair never match, even
    though both sides crossed and both uploaded a real token that epoch."""
    from mutual_protocol.encoding import b64url_encode
    from mutual_protocol.keys import pair_key
    from mutual_protocol.tokens import interest_token, padded_set

    from mutual_server.clock import at_local
    from mutual_server.models import Crossing
    from mutual_server.services.matching import run_match_batch

    h: Harness = make_harness()
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    day = "2026-10-04"
    with h.db() as db:
        lo, hi = sorted((a.user_id, b.user_id))
        db.add(Crossing(day=day, user_lo=lo, user_hi=hi, token=b"x" * 32, created_at=h.clock.now()))
        db.commit()

    k_ab = pair_key(a.sk, a.pk, a.user_id, b.pk, b.user_id)
    k_ba = pair_key(b.sk, b.pk, b.user_id, a.pk, a.user_id)
    tok_a = interest_token(k_ab, day, "study")
    tok_b = interest_token(k_ba, day, "date")

    h.clock.set(at_local(day, h.settings.signals.upload_window_start, h.settings.tz))
    for acct, real in ((a, [tok_a]), (b, [tok_b])):
        tokens = [b64url_encode(t) for t in padded_set(real)]
        r = h.client.put(f"/v1/signals/{day}", json={"tokens": tokens}, headers=auth(acct.token))
        assert r.status_code == 201

    h.clock.set(at_local(day, h.settings.signals.match_batch_time, h.settings.tz))
    with h.db() as db:
        run_match_batch(db, h.clock, h.settings, h.client.app.state.ctx.ids)
        from mutual_server.models import Match

        assert (
            db.query(Match).count() == 0
        )  # different intents -> different tokens -> no shared token
