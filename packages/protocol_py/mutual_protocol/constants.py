"""Protocol constants (SPEC.md §6.2), loaded from ``packages/protocol-spec/constants.json``.

The JSON file is the single source of truth; nothing here duplicates a value.
It is located relative to this package (``packages/protocol_py/mutual_protocol``
→ ``packages/protocol-spec``), which works for the editable install used in
this repository. Set ``MUTUAL_CONSTANTS_PATH`` to load it from elsewhere.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Mapping
from pathlib import Path
from types import MappingProxyType
from typing import Any


def constants_path() -> Path:
    """Return the path of ``constants.json`` (environment override first)."""
    override = os.environ.get("MUTUAL_CONSTANTS_PATH")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[2] / "protocol-spec" / "constants.json"


def validate(data: Mapping[str, Any]) -> None:
    """Raise ``ValueError`` if ``data`` breaks a structural rule of SPEC.md §6.2."""
    person_size = hashlib.blake2b.PERSON_SIZE  # 16 bytes
    for name, value in data["personalization"].items():
        raw = value.encode("ascii")  # non-ASCII raises UnicodeEncodeError (a ValueError)
        if len(raw) != person_size:
            raise ValueError(
                f"personalization {name!r} must be exactly {person_size} ASCII bytes, "
                f"got {len(raw)}"
            )
    codes = list(data["intents"].values())
    if len(set(codes)) != len(codes) or not all(isinstance(c, int) and 0 < c < 256 for c in codes):
        raise ValueError("intent codes must be distinct integers in 1..255")
    minutes_per_day = 24 * 60
    if data["eid_intervals_per_day"] * data["eid_interval_minutes"] != minutes_per_day:
        raise ValueError("eid_intervals_per_day × eid_interval_minutes must equal one day")
    if data["encounter_max_entries"] % data["encounter_pad_block"] != 0:
        raise ValueError("encounter_max_entries must be a multiple of encounter_pad_block")


def load(path: Path | None = None) -> dict[str, Any]:
    """Load and validate ``constants.json``."""
    data: dict[str, Any] = json.loads((path or constants_path()).read_text(encoding="utf-8"))
    validate(data)
    return data


_DATA = load()

PROTOCOL_VERSION: int = _DATA["protocol_version"]
SIGNAL_SET_SIZE: int = _DATA["signal_set_size"]
TOKEN_BYTES: int = _DATA["token_bytes"]
PAIR_KEY_BYTES: int = _DATA["pair_key_bytes"]
DAILY_KEY_BYTES: int = _DATA["daily_key_bytes"]
EID_BYTES: int = _DATA["eid_bytes"]
EID_INTERVAL_MINUTES: int = _DATA["eid_interval_minutes"]
EID_INTERVALS_PER_DAY: int = _DATA["eid_intervals_per_day"]
ENCOUNTER_BYTES: int = _DATA["encounter_bytes"]
ENCOUNTER_PAD_BLOCK: int = _DATA["encounter_pad_block"]
ENCOUNTER_MAX_ENTRIES: int = _DATA["encounter_max_entries"]
UID_BYTES: int = _DATA["uid_bytes"]

PERSON_PAIR_KEY: bytes = _DATA["personalization"]["pair_key"].encode("ascii")
PERSON_INTEREST: bytes = _DATA["personalization"]["interest"].encode("ascii")
PERSON_EID: bytes = _DATA["personalization"]["eid"].encode("ascii")
PERSON_ENCOUNTER: bytes = _DATA["personalization"]["encounter"].encode("ascii")

INTENTS: Mapping[str, int] = MappingProxyType(dict(_DATA["intents"]))
