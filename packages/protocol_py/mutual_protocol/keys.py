"""Identity keys, key validity and the pair key (SPEC.md §6.4, §6.5)."""

from __future__ import annotations

import hashlib
import hmac
import uuid

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey

from mutual_protocol.constants import PAIR_KEY_BYTES, PERSON_PAIR_KEY
from mutual_protocol.encoding import ProtocolError, uid_bytes

KEY_BYTES = 32  # X25519 private and public key size (RFC 7748)
_FIELD_PRIME = 2**255 - 19  # Curve25519 field prime (RFC 7748)
# Canonical u-coordinates of the Curve25519 points of order 1, 2, 4 and 8.
_LOW_ORDER_U = frozenset(
    {
        0,
        1,
        325606250916557431795983626356110631294008115727848805560023387167927233504,
        39382357235489614581723060781553021112529911719440698176882885853963445705823,
        _FIELD_PRIME - 1,
    }
)


def generate_identity_keypair() -> tuple[bytes, bytes]:
    """Return a new X25519 ``(private_key, public_key)``, 32 bytes each, from the OS CSPRNG."""
    sk = X25519PrivateKey.generate()
    return sk.private_bytes_raw(), sk.public_key().public_bytes_raw()


def public_key(private_key: bytes) -> bytes:
    """Return the X25519 public key (32 bytes) for a 32-byte private key."""
    if len(private_key) != KEY_BYTES:
        raise ProtocolError("private key must be 32 bytes")
    return X25519PrivateKey.from_private_bytes(private_key).public_key().public_bytes_raw()


def is_valid_public_key(pk: bytes) -> bool:
    """SPEC.md §6.5 validity, without the server-side uniqueness rule.

    Valid means: 32 bytes, canonical (top bit clear and u < 2^255 − 19), and
    not one of the low-order points.
    """
    if not isinstance(pk, bytes) or len(pk) != KEY_BYTES or pk[31] & 0x80:
        return False
    u = int.from_bytes(pk, "little")
    return u < _FIELD_PRIME and u not in _LOW_ORDER_U


def x25519(private_key: bytes, peer_public_key: bytes) -> bytes:
    """X25519 shared secret (32 bytes); rejects invalid keys and an all-zero result."""
    if not is_valid_public_key(peer_public_key):
        raise ProtocolError("invalid peer public key")
    try:
        shared = X25519PrivateKey.from_private_bytes(private_key).exchange(
            X25519PublicKey.from_public_bytes(peer_public_key)
        )
    except ValueError as exc:  # the library refuses an all-zero result itself
        raise ProtocolError("all-zero shared secret") from exc
    if hmac.compare_digest(shared, bytes(KEY_BYTES)):
        raise ProtocolError("all-zero shared secret")
    return shared


def pair_key(
    sk_self: bytes,
    pk_self: bytes,
    uid_self: str | uuid.UUID,
    pk_peer: bytes,
    uid_peer: str | uuid.UUID,
) -> bytes:
    """K_AB (SPEC.md §6.5): BLAKE2b(ss || lo_pk || hi_pk || uid(lo) || uid(hi)).

    Public keys are sorted as raw bytes; each uid stays with its own key.
    """
    if public_key(sk_self) != pk_self:
        raise ProtocolError("pk_self does not belong to sk_self")
    if pk_self == pk_peer:
        raise ProtocolError("identical public keys")
    self_uid, peer_uid = uid_bytes(uid_self), uid_bytes(uid_peer)
    if self_uid == peer_uid:
        raise ProtocolError("identical user ids")
    shared = x25519(sk_self, pk_peer)
    (lo_pk, lo_uid), (hi_pk, hi_uid) = sorted([(pk_self, self_uid), (pk_peer, peer_uid)])
    return hashlib.blake2b(
        shared + lo_pk + hi_pk + lo_uid + hi_uid,
        digest_size=PAIR_KEY_BYTES,
        person=PERSON_PAIR_KEY,
    ).digest()
