"""The IP rate limiter on /auth/request-otp and /auth/verify-otp (CLAUDE.md §9).

Added 2026-10-09: CLAUDE.md §9 had always described "rate limits keyed on IP, an in-memory
hash with a salt that rotates hourly", but nothing implemented it -- `request-otp` had only
the per-email 60-second resend cooldown, so a source could request codes for as many
different college addresses as it liked, as fast as it liked. See
`services/rate_limit.py` and `docs/DECISIONS_LOG.md` for the full account.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

from conftest import Harness

from mutual_server.clock import FixedClock
from mutual_server.services.rate_limit import RateLimiter


def test_hit_allows_up_to_the_limit_then_rejects() -> None:
    clock = FixedClock(datetime(2026, 10, 9, 0, 0, tzinfo=UTC))
    limiter = RateLimiter(clock=clock)
    for _ in range(3):
        assert limiter.hit("bucket", "1.2.3.4", 3) is True
    assert limiter.hit("bucket", "1.2.3.4", 3) is False
    assert limiter.hit("bucket", "1.2.3.4", 3) is False


def test_buckets_are_independent() -> None:
    clock = FixedClock(datetime(2026, 10, 9, 0, 0, tzinfo=UTC))
    limiter = RateLimiter(clock=clock)
    for _ in range(2):
        assert limiter.hit("request_otp", "1.2.3.4", 2) is True
    # A different bucket for the same address starts its own count.
    assert limiter.hit("verify_otp", "1.2.3.4", 2) is True


def test_ips_are_independent() -> None:
    clock = FixedClock(datetime(2026, 10, 9, 0, 0, tzinfo=UTC))
    limiter = RateLimiter(clock=clock)
    for _ in range(2):
        assert limiter.hit("bucket", "1.2.3.4", 2) is True
    assert limiter.hit("bucket", "1.2.3.4", 2) is False
    # A second address has not touched this window's budget at all.
    assert limiter.hit("bucket", "5.6.7.8", 2) is True


def test_window_rotation_resets_the_count() -> None:
    clock = FixedClock(datetime(2026, 10, 9, 0, 0, tzinfo=UTC))
    limiter = RateLimiter(clock=clock, window_seconds=3600)
    for _ in range(2):
        assert limiter.hit("bucket", "1.2.3.4", 2) is True
    assert limiter.hit("bucket", "1.2.3.4", 2) is False
    clock.advance(seconds=3600)
    assert limiter.hit("bucket", "1.2.3.4", 2) is True


def test_old_window_key_is_unreachable_after_rotation() -> None:
    """The reset is a salt swap, not a per-key expiry: nothing is ever deleted from
    `_counts`, so the only thing proving the old entries are inert is that counting
    against them again is impossible -- the key computed under the new salt differs."""
    clock = FixedClock(datetime(2026, 10, 9, 0, 0, tzinfo=UTC))
    limiter = RateLimiter(clock=clock, window_seconds=60)
    limiter.hit("bucket", "1.2.3.4", 1)
    assert len(limiter._counts) == 1
    clock.advance(seconds=60)
    limiter.hit("bucket", "1.2.3.4", 1)
    assert len(limiter._counts) == 1


def test_request_otp_is_rate_limited_per_ip(make_harness: Callable[..., Harness]) -> None:
    h = make_harness(auth={"otp_request_ip_limit_per_hour": 3})
    for n in range(3):
        r = h.client.post("/v1/auth/request-otp", json={"email": f"student{n}@example.ac.in"})
        assert r.status_code == 204, r.text
    r = h.client.post("/v1/auth/request-otp", json={"email": "one-more@example.ac.in"})
    assert r.status_code == 429 and r.json()["error"] == "rate_limited"
    # The address this all happened under appears nowhere in the database -- the limiter
    # counted it in memory only (invariant 5).
    assert "testclient" not in h.dump()


def test_request_otp_limit_resets_after_the_window(
    make_harness: Callable[..., Harness],
) -> None:
    h = make_harness(auth={"otp_request_ip_limit_per_hour": 1})
    assert (
        h.client.post("/v1/auth/request-otp", json={"email": "a@example.ac.in"}).status_code == 204
    )
    assert (
        h.client.post("/v1/auth/request-otp", json={"email": "b@example.ac.in"}).status_code == 429
    )
    h.clock.advance(seconds=3600)
    assert (
        h.client.post("/v1/auth/request-otp", json={"email": "c@example.ac.in"}).status_code == 204
    )


def test_verify_otp_is_rate_limited_per_ip_independently_of_request_otp(
    make_harness: Callable[..., Harness],
) -> None:
    h = make_harness(auth={"otp_verify_ip_limit_per_hour": 2})
    email = "ananya@example.ac.in"
    assert h.client.post("/v1/auth/request-otp", json={"email": email}).status_code == 204
    wrong = {"email": email, "code": "000000"}
    for _ in range(2):
        r = h.client.post("/v1/auth/verify-otp", json=wrong)
        assert r.status_code == 400  # wrong code, but under the IP budget
    r = h.client.post("/v1/auth/verify-otp", json=wrong)
    assert r.status_code == 429 and r.json()["error"] == "rate_limited"


def test_rate_limit_is_checked_before_the_campus_lookup(
    make_harness: Callable[..., Harness],
) -> None:
    """A source already over budget gets 429 even for an address that would otherwise be
    refused for an unrelated reason -- the limit is not a courtesy extended only to
    requests that were going to succeed anyway."""
    h = make_harness(auth={"otp_request_ip_limit_per_hour": 1})
    assert (
        h.client.post("/v1/auth/request-otp", json={"email": "a@example.ac.in"}).status_code == 204
    )
    r = h.client.post("/v1/auth/request-otp", json={"email": "not-a-college-email"})
    assert r.status_code == 429  # not 400 "not_a_college_email"
