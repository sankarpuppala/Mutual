import secrets

import pytest

from mutual_protocol.constants import ENCOUNTER_MAX_ENTRIES, ENCOUNTER_PAD_BLOCK
from mutual_protocol.eid import eid, ephemeral_private_key, new_daily_key
from mutual_protocol.encoding import ProtocolError
from mutual_protocol.encounter import encounter_token, padded_encounter_set, padded_size
from mutual_protocol.keys import generate_identity_keypair

DAY = "2026-10-05"


def _device(interval: int = 40) -> tuple[bytes, bytes]:
    dk = new_daily_key()
    return ephemeral_private_key(dk, interval), eid(dk, interval)


def test_both_devices_compute_the_same_token() -> None:
    for _ in range(200):
        esk_a, a = _device()
        esk_b, b = _device()
        t = encounter_token(DAY, esk_a, a, b)
        assert t == encounter_token(DAY, esk_b, b, a)
        assert len(t) == 32


def test_listener_without_a_private_key_cannot_reproduce() -> None:
    # A sniffer heard a and b but owns neither private key. Whatever key it uses,
    # it gets a different token (here: its own device key, and a random key).
    esk_a, a = _device()
    _, b = _device()
    real = encounter_token(DAY, esk_a, a, b)
    esk_m, m = _device()
    assert encounter_token(DAY, esk_m, m, b) != real
    assert encounter_token(DAY, esk_m, m, a) != real


def test_token_changes_with_day_and_eids() -> None:
    esk_a, a = _device()
    _, b = _device()
    _, c = _device()
    t = encounter_token(DAY, esk_a, a, b)
    assert encounter_token("2026-10-06", esk_a, a, b) != t
    assert encounter_token(DAY, esk_a, a, c) != t


def test_rejects_low_order_or_invalid_heard_eid() -> None:
    esk_a, a = _device()
    for bad in (bytes(32), (1).to_bytes(32, "little"), b"\xff" * 32):
        with pytest.raises(ProtocolError):
            encounter_token(DAY, esk_a, a, bad)


def test_rejects_identical_or_foreign_own_eid() -> None:
    esk_a, a = _device()
    _, b = _device()
    with pytest.raises(ProtocolError, match="identical"):
        encounter_token(DAY, esk_a, a, a)
    with pytest.raises(ProtocolError, match="does not belong"):
        encounter_token(DAY, esk_a, b, a)


def test_identity_keys_also_work_as_inputs() -> None:
    # Any valid X25519 key pair works; EIDs are just one-time key pairs.
    sk1, pk1 = generate_identity_keypair()
    sk2, pk2 = generate_identity_keypair()
    assert encounter_token(DAY, sk1, pk1, pk2) == encounter_token(DAY, sk2, pk2, pk1)


@pytest.mark.parametrize(
    ("n", "size"),
    [(0, 256), (1, 256), (256, 256), (257, 512), (700, 768), (ENCOUNTER_MAX_ENTRIES, 1024)],
)
def test_padded_size(n: int, size: int) -> None:
    assert padded_size(n) == size


@pytest.mark.parametrize("n_real", [0, 3, 256, 300])
def test_padded_encounter_set_shape(n_real: int) -> None:
    real = [secrets.token_bytes(32) for _ in range(n_real)]
    s = padded_encounter_set(real)
    assert len(s) % ENCOUNTER_PAD_BLOCK == 0 and len(s) >= ENCOUNTER_PAD_BLOCK
    assert set(real) <= set(s)
    assert len(set(s)) == len(s)


def test_padded_encounter_set_limits() -> None:
    with pytest.raises(ProtocolError):
        padded_encounter_set([secrets.token_bytes(32) for _ in range(ENCOUNTER_MAX_ENTRIES + 1)])
    with pytest.raises(ProtocolError):
        padded_encounter_set([b"\x00" * 31])
    t = secrets.token_bytes(32)
    with pytest.raises(ProtocolError):
        padded_encounter_set([t, t])
