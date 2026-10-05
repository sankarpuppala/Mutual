import datetime

import pytest

from mutual_protocol.constants import EID_INTERVALS_PER_DAY
from mutual_protocol.eid import (
    eid,
    eid_schedule,
    ephemeral_private_key,
    interval_for,
    is_midnight_interval,
    new_daily_key,
)
from mutual_protocol.encoding import ProtocolError
from mutual_protocol.keys import is_valid_public_key, public_key


def test_96_distinct_valid_eids_per_daily_key() -> None:
    for _ in range(20):
        schedule = eid_schedule(new_daily_key())
        assert [i for i, _ in schedule] == list(range(EID_INTERVALS_PER_DAY))
        eids = [e for _, e in schedule]
        assert len(set(eids)) == EID_INTERVALS_PER_DAY
        assert all(len(e) == 32 and is_valid_public_key(e) for e in eids)


def test_eid_is_public_key_of_ephemeral_private_key() -> None:
    dk = new_daily_key()
    for i in (0, 1, 47, 95):
        assert eid(dk, i) == public_key(ephemeral_private_key(dk, i))


def test_eids_differ_across_daily_keys() -> None:
    assert eid(new_daily_key(), 10) != eid(new_daily_key(), 10)


@pytest.mark.parametrize("bad", [-1, 96, 1000])
def test_interval_out_of_range(bad: int) -> None:
    with pytest.raises(ProtocolError):
        eid(new_daily_key(), bad)


def test_bad_daily_key_length() -> None:
    with pytest.raises(ProtocolError):
        eid(b"\x00" * 31, 0)


@pytest.mark.parametrize(
    ("hh", "mm", "expected"),
    [
        (0, 0, 0),
        (0, 14, 0),
        (0, 15, 1),
        (8, 0, 32),
        (12, 59, 51),
        (23, 44, 94),
        (23, 45, 95),
        (23, 59, 95),
    ],
)
def test_interval_for(hh: int, mm: int, expected: int) -> None:
    assert interval_for(datetime.time(hh, mm)) == expected


def test_midnight_rule() -> None:
    assert is_midnight_interval(0) and is_midnight_interval(95)
    assert not any(is_midnight_interval(i) for i in range(1, 95))
