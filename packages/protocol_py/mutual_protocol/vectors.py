"""Deterministic cross-language test vectors (SPEC.md §19 AC-T1-2).

Usage: ``python -m mutual_protocol.vectors --out packages/protocol-spec/vectors.json``

Every input is derived from a fixed seed with BLAKE2b, never from a CSPRNG,
so regeneration is byte-identical. Bytes are written as lowercase hex.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import uuid
from pathlib import Path
from typing import Any

from mutual_protocol.constants import EID_INTERVALS_PER_DAY, INTENTS, PROTOCOL_VERSION
from mutual_protocol.eid import eid, ephemeral_private_key
from mutual_protocol.encoding import ProtocolError, b64url_encode, uid_bytes
from mutual_protocol.encounter import encounter_token
from mutual_protocol.keys import (
    _FIELD_PRIME,
    _LOW_ORDER_U,
    is_valid_public_key,
    pair_key,
    public_key,
)
from mutual_protocol.tokens import interest_token

_SEED = b"mutual-test-vectors-v1"
_DAYS = ["2026-01-01", "2026-10-05", "2027-02-28", "2028-02-29", "2026-12-31"]


def _det(label: str, index: int, size: int = 32) -> bytes:
    """Deterministic bytes from the fixed seed (test inputs only, never keys in use)."""
    return hashlib.blake2b(
        label.encode("ascii") + index.to_bytes(4, "big"), key=_SEED, digest_size=size
    ).digest()


def _uid(index: int) -> str:
    return str(uuid.UUID(bytes=_det("uid", index, 16), version=4))


def _b64url_cases() -> list[dict[str, str]]:
    return [
        {
            "bytes": _det("b64", n, n or 1)[:n].hex(),
            "b64url": b64url_encode(_det("b64", n, n or 1)[:n]),
        }
        for n in (0, 1, 2, 3, 4, 5, 15, 16, 31, 32, 33, 64)
    ]


def _pair_key_cases() -> list[dict[str, str]]:
    cases = []
    for n in range(30):
        sk_a, sk_b = _det("sk_a", n), _det("sk_b", n)
        pk_a, pk_b = public_key(sk_a), public_key(sk_b)
        uid_a, uid_b = _uid(2 * n), _uid(2 * n + 1)
        k = pair_key(sk_a, pk_a, uid_a, pk_b, uid_b)
        assert k == pair_key(sk_b, pk_b, uid_b, pk_a, uid_a)
        cases.append(
            {
                "sk_a": sk_a.hex(),
                "pk_a": pk_a.hex(),
                "uid_a": uid_a,
                "sk_b": sk_b.hex(),
                "pk_b": pk_b.hex(),
                "uid_b": uid_b,
                "pair_key": k.hex(),
            }
        )
    return cases


def _token_cases() -> list[dict[str, Any]]:
    intents = list(INTENTS)
    return [
        {
            "pair_key": _det("pk", n).hex(),
            "epoch": _DAYS[n % len(_DAYS)],
            "intent": intents[n % len(intents)],
            "intent_code": INTENTS[intents[n % len(intents)]],
            "token": interest_token(
                _det("pk", n), _DAYS[n % len(_DAYS)], intents[n % len(intents)]
            ).hex(),
        }
        for n in range(30)
    ]


def _eid_cases() -> list[dict[str, Any]]:
    cases = []
    for n in range(20):
        dk = _det("dk", n)
        i = (n * 7) % EID_INTERVALS_PER_DAY
        cases.append(
            {
                "daily_key": dk.hex(),
                "interval": i,
                "esk": ephemeral_private_key(dk, i).hex(),
                "eid": eid(dk, i).hex(),
            }
        )
    return cases


def _encounter_cases() -> list[dict[str, str]]:
    cases = []
    for n in range(20):
        esk_a, esk_b = _det("esk_a", n), _det("esk_b", n)
        eid_a, eid_b = public_key(esk_a), public_key(esk_b)
        day = _DAYS[n % len(_DAYS)]
        e = encounter_token(day, esk_a, eid_a, eid_b)
        assert e == encounter_token(day, esk_b, eid_b, eid_a)
        cases.append(
            {
                "day": day,
                "esk_a": esk_a.hex(),
                "eid_a": eid_a.hex(),
                "esk_b": esk_b.hex(),
                "eid_b": eid_b.hex(),
                "token": e.hex(),
            }
        )
    return cases


def _key_validity_cases() -> list[dict[str, Any]]:
    def u(v: int) -> str:
        return (v % 2**256).to_bytes(32, "little").hex()

    invalid = [u(v) for v in sorted(_LOW_ORDER_U)] + [
        u(_FIELD_PRIME),
        u(_FIELD_PRIME + 1),
        u(2**255),
        u(2**256 - 1),
    ]
    valid_pk = public_key(_det("valid", 0))
    alias = (valid_pk[:31] + bytes([valid_pk[31] | 0x80])).hex()
    cases = [{"public_key": h, "valid": False} for h in invalid + [alias]]
    cases += [{"public_key": public_key(_det("valid", n)).hex(), "valid": True} for n in range(5)]
    for c in cases:
        assert is_valid_public_key(bytes.fromhex(c["public_key"])) == c["valid"]
    return cases


def _error_cases() -> list[dict[str, Any]]:
    """Inputs both implementations must reject."""
    sk = _det("err", 0)
    pk = public_key(sk)
    other = public_key(_det("err", 1))
    cases = [
        {
            "op": "pair_key",
            "why": "identical public keys",
            "sk_self": sk.hex(),
            "pk_self": pk.hex(),
            "uid_self": _uid(100),
            "pk_peer": pk.hex(),
            "uid_peer": _uid(101),
        },
        {
            "op": "pair_key",
            "why": "identical user ids",
            "sk_self": sk.hex(),
            "pk_self": pk.hex(),
            "uid_self": _uid(100),
            "pk_peer": other.hex(),
            "uid_peer": _uid(100),
        },
        {
            "op": "pair_key",
            "why": "low-order peer key",
            "sk_self": sk.hex(),
            "pk_self": pk.hex(),
            "uid_self": _uid(100),
            "pk_peer": bytes(32).hex(),
            "uid_peer": _uid(101),
        },
        {
            "op": "encounter_token",
            "why": "low-order heard EID",
            "day": "2026-10-05",
            "esk_own": sk.hex(),
            "eid_own": pk.hex(),
            "eid_heard": (1).to_bytes(32, "little").hex(),
        },
        {
            "op": "interest_token",
            "why": "invalid epoch",
            "pair_key": _det("pk", 0).hex(),
            "epoch": "2026-02-30",
            "intent": "study",
        },
    ]
    for c in cases:  # every case must really fail in this implementation
        try:
            if c["op"] == "pair_key":
                pair_key(
                    bytes.fromhex(c["sk_self"]),
                    bytes.fromhex(c["pk_self"]),
                    c["uid_self"],
                    bytes.fromhex(c["pk_peer"]),
                    c["uid_peer"],
                )
            elif c["op"] == "encounter_token":
                encounter_token(
                    c["day"],
                    bytes.fromhex(c["esk_own"]),
                    bytes.fromhex(c["eid_own"]),
                    bytes.fromhex(c["eid_heard"]),
                )
            else:
                interest_token(bytes.fromhex(c["pair_key"]), c["epoch"], c["intent"])
        except ProtocolError:
            continue
        raise AssertionError(f"error case did not fail: {c['why']}")
    return cases


def build() -> dict[str, Any]:
    """Build the full vector document."""
    return {
        "protocol_version": PROTOCOL_VERSION,
        "generated_by": "python -m mutual_protocol.vectors",
        "encoding": "all byte values are lowercase hex; uids are UUID strings",
        "base64url": _b64url_cases(),
        "pair_key": _pair_key_cases(),
        "interest_token": _token_cases(),
        "eid": _eid_cases(),
        "encounter_token": _encounter_cases(),
        "public_key_validity": _key_validity_cases(),
        "errors": _error_cases(),
        "uid_bytes": [{"uid": _uid(n), "bytes": uid_bytes(_uid(n)).hex()} for n in range(3)],
    }


def render() -> str:
    """Serialize deterministically (sorted keys, 2-space indent, LF, trailing newline)."""
    return json.dumps(build(), indent=2, sort_keys=True) + "\n"


def count_cases(doc: dict[str, Any]) -> int:
    return sum(len(v) for v in doc.values() if isinstance(v, list))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True, help="where to write vectors.json")
    args = parser.parse_args()
    text = render()
    args.out.write_bytes(text.encode("utf-8"))
    print(f"wrote {count_cases(json.loads(text))} cases to {args.out}")


if __name__ == "__main__":
    main()
