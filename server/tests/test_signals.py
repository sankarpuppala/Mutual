from datetime import timedelta

from conftest import Harness, auth, signup
from mutual_protocol.encoding import b64url_encode
from mutual_protocol.tokens import padded_set

from mutual_server.clock import at_local


def _put(h: Harness, token: str, epoch: str, real: list[bytes] | None = None):
    tokens = [b64url_encode(t) for t in padded_set(real or [])]
    return h.client.put(f"/v1/signals/{epoch}", json={"tokens": tokens}, headers=auth(token))


def test_requires_auth(h: Harness) -> None:
    r = h.client.put("/v1/signals/2026-10-05", json={"tokens": []})
    assert r.status_code == 401


def test_epoch_must_be_today(h: Harness) -> None:
    a = signup(h)
    h.clock.set(at_local("2026-10-05", h.settings.signals.upload_window_start, h.settings.tz))
    assert _put(h, a.token, "2026-10-04").status_code == 400
    assert _put(h, a.token, "2026-10-06").status_code == 400


def test_rejected_before_window_start(h: Harness) -> None:
    a = signup(h)
    day = "2026-10-05"
    h.clock.set(at_local(day, "00:00", h.settings.tz))  # well before 18:00
    r = _put(h, a.token, day)
    assert r.status_code == 425


def test_rejected_at_or_after_match_batch_time(h: Harness) -> None:
    a = signup(h)
    day = "2026-10-05"
    h.clock.set(at_local(day, h.settings.signals.match_batch_time, h.settings.tz))
    r = _put(h, a.token, day)
    assert r.status_code == 400 and r.json()["error"] == "window_closed"


def test_accepted_inside_the_window_and_once_per_epoch(h: Harness) -> None:
    a = signup(h)
    day = "2026-10-05"
    h.clock.set(at_local(day, h.settings.signals.upload_window_start, h.settings.tz))
    assert _put(h, a.token, day).status_code == 201
    assert _put(h, a.token, day).status_code == 409


def test_count_and_length_validation(h: Harness) -> None:
    a = signup(h)
    day = "2026-10-05"
    h.clock.set(at_local(day, h.settings.signals.upload_window_start, h.settings.tz))
    too_few = h.client.put(
        f"/v1/signals/{day}",
        json={"tokens": [b64url_encode(b"x" * 32)] * 19},
        headers=auth(a.token),
    )
    assert too_few.status_code == 422
    bad_length = h.client.put(
        f"/v1/signals/{day}",
        json={"tokens": [b64url_encode(b"x" * 31)] * 20},
        headers=auth(a.token),
    )
    assert bad_length.status_code == 422
    dup = b64url_encode(b"y" * 32)
    duplicate = h.client.put(
        f"/v1/signals/{day}", json={"tokens": [dup] * 20}, headers=auth(a.token)
    )
    assert duplicate.status_code == 422


def test_schema_has_only_tokens_no_intent_field(h: Harness) -> None:
    from mutual_server.schemas import SignalsUploadIn

    assert set(SignalsUploadIn.model_fields) == {"tokens"}
    a = signup(h)
    day = "2026-10-05"
    h.clock.set(at_local(day, h.settings.signals.upload_window_start, h.settings.tz))
    tokens = [b64url_encode(t) for t in padded_set([])]
    r = h.client.put(
        f"/v1/signals/{day}", json={"tokens": tokens, "intent": "date"}, headers=auth(a.token)
    )
    assert r.status_code == 422  # extra='forbid'


def test_next_opportunity_before_match_batch_time_still_works(h: Harness) -> None:
    """A late (but still-before-batch) upload is accepted; right at batch time it is not."""
    a = signup(h)
    day = "2026-10-05"
    cutoff = at_local(day, h.settings.signals.match_batch_time, h.settings.tz)
    h.clock.set(cutoff - timedelta(seconds=1))
    assert _put(h, a.token, day).status_code == 201
