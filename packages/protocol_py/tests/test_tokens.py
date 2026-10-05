import hashlib
import secrets
import uuid

import pytest

from mutual_protocol.constants import INTENTS, SIGNAL_SET_SIZE
from mutual_protocol.encoding import ProtocolError
from mutual_protocol.keys import generate_identity_keypair, pair_key
from mutual_protocol.tokens import interest_token, padded_set, shuffle

EPOCHS = ["2026-10-05", "2026-10-06", "2026-12-31"]


def _pair() -> bytes:
    sk_a, pk_a = generate_identity_keypair()
    _, pk_b = generate_identity_keypair()
    return pair_key(sk_a, pk_a, uuid.uuid4(), pk_b, uuid.uuid4())


def test_tokens_differ_across_pairs_epochs_intents_5000_no_collisions() -> None:
    seen = set()
    for _ in range(340):  # 340 pairs × 3 epochs × 5 intents = 5 100 tokens
        k = _pair()
        for epoch in EPOCHS:
            for intent in INTENTS:
                seen.add(interest_token(k, epoch, intent))
    assert len(seen) == 340 * len(EPOCHS) * len(INTENTS)


def test_token_is_deterministic_and_32_bytes() -> None:
    k = _pair()
    t = interest_token(k, "2026-10-05", "study")
    assert t == interest_token(k, "2026-10-05", INTENTS["study"])
    assert len(t) == 32


def test_different_intent_gives_different_token() -> None:
    k = _pair()
    tokens = {interest_token(k, "2026-10-05", i) for i in INTENTS}
    assert len(tokens) == len(INTENTS)


def test_token_message_layout() -> None:
    # Recompute by hand: data = epoch(10) || intent(1), keyed BLAKE2b, "mutual-interest1".
    k = bytes(range(32))
    expected = hashlib.blake2b(
        b"2026-10-05" + bytes([INTENTS["date"]]), key=k, digest_size=32, person=b"mutual-interest1"
    ).digest()
    assert interest_token(k, "2026-10-05", "date") == expected


@pytest.mark.parametrize("bad", ["love", 0, 6, 255])
def test_unknown_intent_rejected(bad: str | int) -> None:
    with pytest.raises(ProtocolError):
        interest_token(bytes(32), "2026-10-05", bad)


def test_bad_pair_key_or_epoch_rejected() -> None:
    with pytest.raises(ProtocolError):
        interest_token(bytes(31), "2026-10-05", "study")
    with pytest.raises(ProtocolError):
        interest_token(bytes(32), "2026-10-5", "study")


@pytest.mark.parametrize("n_real", [0, 1, 7, SIGNAL_SET_SIZE])
def test_padded_set_shape(n_real: int) -> None:
    real = [secrets.token_bytes(32) for _ in range(n_real)]
    s = padded_set(real)
    assert len(s) == SIGNAL_SET_SIZE
    assert all(len(t) == 32 for t in s)
    assert set(real) <= set(s)
    assert len(set(s)) == SIGNAL_SET_SIZE


def test_padded_set_raises_on_too_many_or_bad_tokens() -> None:
    with pytest.raises(ProtocolError):
        padded_set([secrets.token_bytes(32) for _ in range(SIGNAL_SET_SIZE + 1)])
    with pytest.raises(ProtocolError):
        padded_set([b"\x00" * 31])
    t = secrets.token_bytes(32)
    with pytest.raises(ProtocolError):
        padded_set([t, t])


def test_real_token_position_is_spread_out() -> None:
    # The real token must not sit in a fixed slot; over 2000 sets it lands in every slot.
    t = secrets.token_bytes(32)
    positions = {padded_set([t]).index(t) for _ in range(2000)}
    assert positions == set(range(SIGNAL_SET_SIZE))


class _CountingRng:
    """Deterministic stand-in RNG for checking the shuffle logic only (never used in production)."""

    def __init__(self) -> None:
        self.n = 0

    def token_bytes(self, nbytes: int) -> bytes:
        self.n += 1
        return hashlib.blake2b(self.n.to_bytes(4, "big"), digest_size=nbytes).digest()

    def randbelow(self, bound: int) -> int:
        self.n += 1
        return (
            int.from_bytes(hashlib.blake2b(self.n.to_bytes(4, "big")).digest()[:4], "big") % bound
        )


def test_shuffle_is_a_permutation() -> None:
    items = [bytes([i]) * 32 for i in range(20)]
    shuffled = list(items)
    shuffle(shuffled, _CountingRng())
    assert sorted(shuffled) == sorted(items)
    assert shuffled != items
