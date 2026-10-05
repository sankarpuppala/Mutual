"""Interest tokens and the padded signal set (SPEC.md §6.6, §6.7)."""

from __future__ import annotations

import hashlib
import secrets
from collections.abc import Sequence
from typing import Protocol

from mutual_protocol.constants import (
    INTENTS,
    PAIR_KEY_BYTES,
    PERSON_INTEREST,
    SIGNAL_SET_SIZE,
    TOKEN_BYTES,
)
from mutual_protocol.encoding import ProtocolError, day_bytes


class RandomSource(Protocol):
    """A CSPRNG with the interface of the ``secrets`` module."""

    def token_bytes(self, nbytes: int) -> bytes: ...

    def randbelow(self, exclusive_upper_bound: int) -> int: ...


def intent_code(intent: str | int) -> int:
    """Return the one-byte intent code for a name or code from ``constants.json``."""
    if isinstance(intent, str):
        if intent not in INTENTS:
            raise ProtocolError(f"unknown intent {intent!r}")
        return INTENTS[intent]
    if intent not in INTENTS.values():
        raise ProtocolError(f"unknown intent code {intent!r}")
    return intent


def interest_token(pair_key: bytes, epoch: str, intent: str | int) -> bytes:
    """T = BLAKE2b(epoch(10) || intent(1), key = K_AB, person = "mutual-interest1")."""
    if len(pair_key) != PAIR_KEY_BYTES:
        raise ProtocolError("pair key must be 32 bytes")
    data = day_bytes(epoch) + bytes([intent_code(intent)])
    return hashlib.blake2b(
        data, key=pair_key, digest_size=TOKEN_BYTES, person=PERSON_INTEREST
    ).digest()


def shuffle(items: list[bytes], rng: RandomSource) -> None:
    """In-place Fisher–Yates shuffle driven by a CSPRNG."""
    for i in range(len(items) - 1, 0, -1):
        j = rng.randbelow(i + 1)
        items[i], items[j] = items[j], items[i]


def padded_set(real: Sequence[bytes], rng: RandomSource = secrets) -> list[bytes]:
    """Return exactly ``signal_set_size`` tokens: the real ones plus CSPRNG dummies, shuffled."""
    if len(real) > SIGNAL_SET_SIZE:
        raise ProtocolError(f"more than {SIGNAL_SET_SIZE} real tokens")
    if any(len(t) != TOKEN_BYTES for t in real):
        raise ProtocolError("every token must be 32 bytes")
    if len(set(real)) != len(real):
        raise ProtocolError("duplicate real tokens")
    tokens = list(real) + [rng.token_bytes(TOKEN_BYTES) for _ in range(SIGNAL_SET_SIZE - len(real))]
    shuffle(tokens, rng)
    return tokens
