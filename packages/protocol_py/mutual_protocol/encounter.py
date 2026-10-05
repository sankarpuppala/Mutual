"""Secret-keyed encounter tokens and the padded presence set (SPEC.md §6.13)."""

from __future__ import annotations

import hashlib
import secrets
from collections.abc import Sequence

from mutual_protocol.constants import (
    ENCOUNTER_BYTES,
    ENCOUNTER_MAX_ENTRIES,
    ENCOUNTER_PAD_BLOCK,
    PERSON_ENCOUNTER,
)
from mutual_protocol.encoding import ProtocolError, day_bytes
from mutual_protocol.keys import public_key, x25519
from mutual_protocol.tokens import RandomSource, shuffle


def encounter_token(day: str, esk_own: bytes, eid_own: bytes, eid_heard: bytes) -> bytes:
    """E = BLAKE2b(day(10) || lo || hi, key = X25519(esk_own, eid_heard), "mutual-encount01").

    ``lo``/``hi`` are the two EIDs sorted as raw bytes. Both devices compute the
    same value; anyone without one of the two private keys cannot.
    """
    if eid_own == eid_heard:
        raise ProtocolError("own and heard EID are identical")
    if public_key(esk_own) != eid_own:
        raise ProtocolError("eid_own does not belong to esk_own")
    shared = x25519(esk_own, eid_heard)  # rejects invalid or low-order EIDs and all-zero secrets
    lo, hi = sorted((eid_own, eid_heard))
    return hashlib.blake2b(
        day_bytes(day) + lo + hi, key=shared, digest_size=ENCOUNTER_BYTES, person=PERSON_ENCOUNTER
    ).digest()


def padded_size(n_real: int) -> int:
    """Smallest multiple of ``encounter_pad_block`` that holds ``n_real`` (at least one block)."""
    if not 0 <= n_real <= ENCOUNTER_MAX_ENTRIES:
        raise ProtocolError(f"real encounter count out of range: {n_real}")
    blocks = max(1, -(-n_real // ENCOUNTER_PAD_BLOCK))
    return blocks * ENCOUNTER_PAD_BLOCK


def padded_encounter_set(real: Sequence[bytes], rng: RandomSource = secrets) -> list[bytes]:
    """Real tokens plus CSPRNG dummies, padded to a multiple of 256 and shuffled.

    The caller (the device) chooses which real tokens to keep if it has more
    than ``encounter_max_entries`` (those with the most windows, §6.13); this
    function raises instead of choosing.
    """
    if any(len(t) != ENCOUNTER_BYTES for t in real):
        raise ProtocolError("every encounter token must be 32 bytes")
    if len(set(real)) != len(real):
        raise ProtocolError("duplicate encounter tokens")
    size = padded_size(len(real))
    entries = list(real) + [rng.token_bytes(ENCOUNTER_BYTES) for _ in range(size - len(real))]
    shuffle(entries, rng)
    return entries
