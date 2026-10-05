import os
import uuid

import pytest

from mutual_protocol.encoding import (
    ProtocolError,
    b64url_decode,
    b64url_encode,
    day_bytes,
    uid_bytes,
    uint16_be,
)


@pytest.mark.parametrize("length", range(40))
def test_b64url_round_trip(length: int) -> None:
    data = os.urandom(length)
    text = b64url_encode(data)
    assert "=" not in text and "+" not in text and "/" not in text
    assert b64url_decode(text) == data


@pytest.mark.parametrize("bad", ["AA==", "AB+/", "A", "AAA=", "a b", "AB"])
def test_b64url_rejects_padding_bad_chars_and_non_canonical(bad: str) -> None:
    # "AB" is non-canonical: its unused trailing bits are not zero (canonical is "AA").
    with pytest.raises(ProtocolError):
        b64url_decode(bad)


def test_day_bytes() -> None:
    assert day_bytes("2026-10-05") == b"2026-10-05"
    assert len(day_bytes("2026-10-05")) == 10


@pytest.mark.parametrize(
    "bad", ["2026-13-01", "2026-02-30", "26-10-05", "2026/10/05", "２０２６-10-05", ""]
)
def test_day_bytes_rejects(bad: str) -> None:
    with pytest.raises(ProtocolError):
        day_bytes(bad)


def test_uint16_be() -> None:
    assert uint16_be(0) == b"\x00\x00"
    assert uint16_be(95) == b"\x00\x5f"
    assert uint16_be(0xFFFF) == b"\xff\xff"
    for bad in (-1, 0x10000):
        with pytest.raises(ProtocolError):
            uint16_be(bad)


def test_uid_bytes_rfc4122_order() -> None:
    text = "12345678-1234-4234-8234-123456789abc"
    assert uid_bytes(text).hex() == "12345678123442348234123456789abc"
    assert uid_bytes(uuid.UUID(text)) == uid_bytes(text)
    with pytest.raises(ProtocolError):
        uid_bytes("not-a-uuid")
