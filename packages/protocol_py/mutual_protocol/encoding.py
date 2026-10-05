"""Byte encodings (SPEC.md §6.3): base64url, day strings, uint16, user ids."""

from __future__ import annotations

import base64
import datetime
import re
import uuid

from mutual_protocol.constants import UID_BYTES


class ProtocolError(ValueError):
    """Raised when an input violates SPEC.md §6."""


_B64URL_CHARS = re.compile(r"[A-Za-z0-9_-]*")
_DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_UINT16_MAX = 0xFFFF


def b64url_encode(data: bytes) -> str:
    """Encode bytes as base64url without padding."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
    """Decode strict, canonical base64url without padding.

    Rejects padding, characters outside the URL-safe alphabet, impossible
    lengths, and non-canonical encodings (non-zero unused trailing bits).
    """
    if not _B64URL_CHARS.fullmatch(text) or len(text) % 4 == 1:
        raise ProtocolError("invalid base64url")
    data = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    if b64url_encode(data) != text:
        raise ProtocolError("non-canonical base64url")
    return data


def day_bytes(day: str) -> bytes:
    """Return the 10 ASCII bytes of a ``YYYY-MM-DD`` day or epoch, validating it."""
    if not isinstance(day, str) or not _DAY.fullmatch(day):
        raise ProtocolError(f"day must be YYYY-MM-DD, got {day!r}")
    try:
        datetime.date.fromisoformat(day)
    except ValueError as exc:
        raise ProtocolError(f"not a calendar date: {day!r}") from exc
    return day.encode("ascii")


def uint16_be(value: int) -> bytes:
    """Encode 0 ≤ value ≤ 65535 as 2 big-endian bytes."""
    if not 0 <= value <= _UINT16_MAX:
        raise ProtocolError(f"uint16 out of range: {value}")
    return value.to_bytes(2, "big")


def uid_bytes(uid: str | uuid.UUID) -> bytes:
    """Return a user id as 16 raw bytes in RFC 4122 order (SPEC.md §6.3)."""
    try:
        raw = (uid if isinstance(uid, uuid.UUID) else uuid.UUID(uid)).bytes
    except (ValueError, AttributeError, TypeError) as exc:
        raise ProtocolError(f"invalid user id: {uid!r}") from exc
    if len(raw) != UID_BYTES:
        raise ProtocolError("user id must be 16 bytes")
    return raw
