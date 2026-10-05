"""Daily keys and one-time broadcast keys (EIDs) (SPEC.md §6.8, §6.3)."""

from __future__ import annotations

import datetime
import hashlib
import secrets

from mutual_protocol.constants import (
    DAILY_KEY_BYTES,
    EID_INTERVAL_MINUTES,
    EID_INTERVALS_PER_DAY,
    PERSON_EID,
)
from mutual_protocol.encoding import ProtocolError, uint16_be
from mutual_protocol.keys import public_key
from mutual_protocol.tokens import RandomSource

_ESK_BYTES = 32  # X25519 private key size


def new_daily_key(rng: RandomSource = secrets) -> bytes:
    """A fresh random daily key DK_d (32 bytes). It never leaves the device."""
    return rng.token_bytes(DAILY_KEY_BYTES)


def _check(daily_key: bytes, interval: int) -> None:
    if len(daily_key) != DAILY_KEY_BYTES:
        raise ProtocolError("daily key must be 32 bytes")
    if not 0 <= interval < EID_INTERVALS_PER_DAY:
        raise ProtocolError(f"interval out of range: {interval}")


def ephemeral_private_key(daily_key: bytes, interval: int) -> bytes:
    """esk(d, i) = BLAKE2b(uint16_be(i), key = DK_d, person = "mutual-eid-v0001")."""
    _check(daily_key, interval)
    return hashlib.blake2b(
        uint16_be(interval), key=daily_key, digest_size=_ESK_BYTES, person=PERSON_EID
    ).digest()


def eid(daily_key: bytes, interval: int) -> bytes:
    """EID(d, i): the X25519 public key of esk(d, i), 32 bytes, broadcast during interval i."""
    return public_key(ephemeral_private_key(daily_key, interval))


def eid_schedule(daily_key: bytes) -> list[tuple[int, bytes]]:
    """All ``(interval, EID)`` pairs for one day, in interval order."""
    return [(i, eid(daily_key, i)) for i in range(EID_INTERVALS_PER_DAY)]


def interval_for(local_time: datetime.time) -> int:
    """i = floor(minutes since local midnight / 15). The caller supplies local time (§6.3)."""
    return (local_time.hour * 60 + local_time.minute) // EID_INTERVAL_MINUTES


def is_midnight_interval(interval: int) -> bool:
    """True for the first and last interval of the day, where no sightings are recorded (§6.13)."""
    if not 0 <= interval < EID_INTERVALS_PER_DAY:
        raise ProtocolError(f"interval out of range: {interval}")
    return interval in (0, EID_INTERVALS_PER_DAY - 1)
