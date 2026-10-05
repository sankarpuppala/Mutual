import json

import pytest

from mutual_protocol import constants as c


def test_constants_come_from_json() -> None:
    data = json.loads(c.constants_path().read_text(encoding="utf-8"))
    assert c.SIGNAL_SET_SIZE == data["signal_set_size"]
    assert c.EID_BYTES == data["eid_bytes"]
    assert c.ENCOUNTER_PAD_BLOCK == data["encounter_pad_block"]
    assert dict(c.INTENTS) == data["intents"]
    assert c.PERSON_ENCOUNTER == data["personalization"]["encounter"].encode("ascii")


def test_every_personalization_is_16_bytes() -> None:
    for person in (c.PERSON_PAIR_KEY, c.PERSON_INTEREST, c.PERSON_EID, c.PERSON_ENCOUNTER):
        assert len(person) == 16


def _valid() -> dict:
    return json.loads(c.constants_path().read_text(encoding="utf-8"))


def test_wrong_personalization_length_rejected() -> None:
    data = _valid()
    data["personalization"]["eid"] = "short"
    with pytest.raises(ValueError, match="exactly 16"):
        c.validate(data)


def test_duplicate_intent_codes_rejected() -> None:
    data = _valid()
    data["intents"]["date"] = 1
    with pytest.raises(ValueError, match="distinct"):
        c.validate(data)


def test_interval_layout_must_cover_one_day() -> None:
    data = _valid()
    data["eid_intervals_per_day"] = 95
    with pytest.raises(ValueError, match="one day"):
        c.validate(data)
