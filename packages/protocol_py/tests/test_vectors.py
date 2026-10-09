import json
from pathlib import Path

from mutual_protocol import vectors
from mutual_protocol.constants import PROTOCOL_VERSION
from mutual_protocol.eid import eid, ephemeral_private_key
from mutual_protocol.encoding import b64url_decode, b64url_encode
from mutual_protocol.encounter import encounter_token
from mutual_protocol.keys import is_valid_public_key, pair_key
from mutual_protocol.tokens import interest_token

VECTORS = Path(__file__).resolve().parents[2] / "protocol-spec" / "vectors.json"


def _doc() -> dict:
    return json.loads(VECTORS.read_text(encoding="utf-8"))


def test_committed_file_equals_fresh_regeneration() -> None:
    assert VECTORS.read_bytes() == vectors.render().encode("utf-8")


def test_at_least_100_cases_and_version() -> None:
    doc = _doc()
    assert vectors.count_cases(doc) >= 100
    assert doc["protocol_version"] == PROTOCOL_VERSION


def test_vectors_reproduce() -> None:
    doc = _doc()
    for c in doc["base64url"]:
        assert b64url_encode(bytes.fromhex(c["bytes"])) == c["b64url"]
        assert b64url_decode(c["b64url"]).hex() == c["bytes"]
    for c in doc["pair_key"]:
        h = bytes.fromhex
        assert (
            pair_key(h(c["sk_a"]), h(c["pk_a"]), c["uid_a"], h(c["pk_b"]), c["uid_b"]).hex()
            == c["pair_key"]
        )
        assert (
            pair_key(h(c["sk_b"]), h(c["pk_b"]), c["uid_b"], h(c["pk_a"]), c["uid_a"]).hex()
            == c["pair_key"]
        )
    for c in doc["interest_token"]:
        assert (
            interest_token(bytes.fromhex(c["pair_key"]), c["epoch"], c["intent"]).hex()
            == c["token"]
        )
    for c in doc["eid"]:
        dk = bytes.fromhex(c["daily_key"])
        assert ephemeral_private_key(dk, c["interval"]).hex() == c["esk"]
        assert eid(dk, c["interval"]).hex() == c["eid"]
    for c in doc["encounter_token"]:
        h = bytes.fromhex
        assert (
            encounter_token(c["day"], h(c["esk_a"]), h(c["eid_a"]), h(c["eid_b"])).hex()
            == c["token"]
        )
        assert (
            encounter_token(c["day"], h(c["esk_b"]), h(c["eid_b"]), h(c["eid_a"])).hex()
            == c["token"]
        )
    for c in doc["public_key_validity"]:
        assert is_valid_public_key(bytes.fromhex(c["public_key"])) == c["valid"]


def test_error_cases_are_present() -> None:
    whys = {c["why"] for c in _doc()["errors"]}
    assert {"identical public keys", "identical user ids", "low-order peer key"} <= whys
