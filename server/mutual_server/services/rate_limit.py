"""In-memory, IP-keyed rate limiting for the auth endpoints (CLAUDE.md §9, invariant 5).

§9 has always said "rate limits keyed on IP use an in-memory hash with a salt that rotates
hourly" -- but until 2026-10-09 that sentence described nothing: no code implemented it.
`/auth/request-otp` had only the per-email 60-second resend cooldown, so a source could
request OTP codes for as many different college email addresses as it liked, as fast as it
liked -- an email bomb against any address whose domain happens to be open, and a way to
probe which domains are open at all (`campus_not_open` vs `not_a_college_email` already
differ, so request-otp quietly answers that question regardless of this limiter; the limiter
bounds how fast it can be asked, not what it answers). This file is what the sentence
describes.

The client's IP address is never logged or stored (invariant 5): it exists only as the
input to a keyed hash, held only in this process's memory, inside a window that is itself
discarded the moment the salt rotates. Nothing here reaches a log line, a response body or
the database -- the route only ever sees `True` (continue) or `False` (429).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import blake2b
from secrets import token_bytes
from threading import Lock

from mutual_server.clock import Clock


def _bucketed_key(salt: bytes, bucket: str, ip: str) -> str:
    """BLAKE2b keyed by the rotating salt -- an approved primitive (invariant 7), used here
    only to fold an IP into an opaque counter key, never to protect a real secret."""
    return blake2b(f"{bucket}:{ip}".encode(), key=salt, digest_size=16).hexdigest()


@dataclass
class RateLimiter:
    """A fixed window per (bucket, ip): `window_seconds` after the window opened, the salt
    rotates and every key computed under the old salt becomes permanently unreachable --
    which is the entire reset, with no cleanup pass and nothing to ever garbage-collect by
    hand. One instance lives on `AppContext` for the process's lifetime (not persisted, not
    shared across processes -- a restart or a second worker starts its own window, which is
    an acceptable loosening of the limit, not a hole: the limiter is a brake on abuse, not a
    security boundary invariant 5 would then also have to cover)."""

    clock: Clock
    window_seconds: int = 3600
    _lock: Lock = field(default_factory=Lock, init=False, repr=False)
    _salt: bytes = field(default_factory=lambda: token_bytes(16), init=False, repr=False)
    _window_start: float = field(default=0.0, init=False, repr=False)
    _counts: dict[str, int] = field(default_factory=dict, init=False, repr=False)

    def hit(self, bucket: str, ip: str, limit: int) -> bool:
        """Records one attempt in `bucket` for `ip`. Returns False once this window's count
        for that pair has exceeded `limit` -- the caller's job is to turn that into a 429,
        never into a message that says why (the limit itself is not secret, but confirming
        exactly when it was crossed is one more thing an enumeration attempt could read)."""
        now = self.clock.now().timestamp()
        with self._lock:
            if now - self._window_start >= self.window_seconds:
                self._salt = token_bytes(16)
                self._window_start = now
                self._counts = {}
            key = _bucketed_key(self._salt, bucket, ip)
            count = self._counts.get(key, 0) + 1
            self._counts[key] = count
            return count <= limit
