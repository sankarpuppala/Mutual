import uuid

import pytest

from mutual_protocol.encoding import ProtocolError
from mutual_protocol.keys import (
    _FIELD_PRIME,
    _LOW_ORDER_U,
    generate_identity_keypair,
    is_valid_public_key,
    pair_key,
    public_key,
    x25519,
)


def _u(value: int) -> bytes:
    return (value % 2**256).to_bytes(32, "little")


def test_pair_key_symmetry_1000_pairs() -> None:
    for _ in range(1000):
        sk_a, pk_a = generate_identity_keypair()
        sk_b, pk_b = generate_identity_keypair()
        uid_a, uid_b = uuid.uuid4(), uuid.uuid4()
        k_ab = pair_key(sk_a, pk_a, uid_a, pk_b, uid_b)
        assert k_ab == pair_key(sk_b, pk_b, uid_b, pk_a, uid_a)
        assert len(k_ab) == 32


def test_pair_key_changes_with_either_uid() -> None:
    sk_a, pk_a = generate_identity_keypair()
    _, pk_b = generate_identity_keypair()
    uid_a, uid_b = uuid.uuid4(), uuid.uuid4()
    base = pair_key(sk_a, pk_a, uid_a, pk_b, uid_b)
    assert pair_key(sk_a, pk_a, uuid.uuid4(), pk_b, uid_b) != base
    assert pair_key(sk_a, pk_a, uid_a, pk_b, uuid.uuid4()) != base


def test_swapping_uids_changes_the_key() -> None:
    # Each uid must stay bound to its own public key after sorting.
    sk_a, pk_a = generate_identity_keypair()
    _, pk_b = generate_identity_keypair()
    uid_a, uid_b = uuid.uuid4(), uuid.uuid4()
    assert pair_key(sk_a, pk_a, uid_a, pk_b, uid_b) != pair_key(sk_a, pk_a, uid_b, pk_b, uid_a)


def test_identical_keys_or_uids_rejected() -> None:
    sk_a, pk_a = generate_identity_keypair()
    _, pk_b = generate_identity_keypair()
    uid = uuid.uuid4()
    with pytest.raises(ProtocolError, match="identical public keys"):
        pair_key(sk_a, pk_a, uuid.uuid4(), pk_a, uuid.uuid4())
    with pytest.raises(ProtocolError, match="identical user ids"):
        pair_key(sk_a, pk_a, uid, pk_b, uid)


def test_mismatched_own_key_rejected() -> None:
    sk_a, _ = generate_identity_keypair()
    _, pk_other = generate_identity_keypair()
    _, pk_b = generate_identity_keypair()
    with pytest.raises(ProtocolError, match="does not belong"):
        pair_key(sk_a, pk_other, uuid.uuid4(), pk_b, uuid.uuid4())


@pytest.mark.parametrize("u", sorted(_LOW_ORDER_U))
def test_low_order_keys_invalid_and_rejected(u: int) -> None:
    pk = _u(u)
    assert not is_valid_public_key(pk)
    sk, own = generate_identity_keypair()
    with pytest.raises(ProtocolError):
        x25519(sk, pk)
    with pytest.raises(ProtocolError):
        pair_key(sk, own, uuid.uuid4(), pk, uuid.uuid4())


@pytest.mark.parametrize("u", [_FIELD_PRIME, _FIELD_PRIME + 1, 2**256 - 1])
def test_non_canonical_keys_invalid(u: int) -> None:
    assert not is_valid_public_key(_u(u))


def test_top_bit_alias_is_invalid() -> None:
    # Same shared secret as the real key, different bytes: must be rejected (SPEC §6.5).
    _, pk = generate_identity_keypair()
    alias = pk[:31] + bytes([pk[31] | 0x80])
    assert is_valid_public_key(pk)
    assert not is_valid_public_key(alias)


def test_all_zero_shared_secret_rejected_without_library_help() -> None:
    # Even a library that returned zeros instead of raising would be caught:
    # x25519() validates the key first, so a low-order key never reaches exchange().
    sk, _ = generate_identity_keypair()
    with pytest.raises(ProtocolError, match="invalid peer public key"):
        x25519(sk, bytes(32))


def test_wrong_length_inputs() -> None:
    assert not is_valid_public_key(b"\x09" * 31)
    with pytest.raises(ProtocolError):
        public_key(b"\x01" * 31)


def test_generated_keys_are_valid() -> None:
    for _ in range(100):
        sk, pk = generate_identity_keypair()
        assert is_valid_public_key(pk)
        assert public_key(sk) == pk
