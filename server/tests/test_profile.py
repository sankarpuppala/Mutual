import io
import json
import struct
from pathlib import Path

from conftest import Harness, auth, signup
from PIL import Image

PROMPTS = [
    {"prompt_id": "looking_for", "text": "Someone to argue thermodynamics with."},
    {"prompt_id": "simple_pleasures", "text": "Filter coffee before an 8 am lab."},
    {"prompt_id": "ask_me_about", "text": "Why textbooks need podcasts."},
]
WAVE = json.dumps([i % 101 for i in range(48)])


def _put(h: Harness, token: str, prompts=PROMPTS, **extra):
    body = {"first_name": "Ananya", "year_of_study": 3, "prompts": prompts, **extra}
    return h.client.put("/v1/profile", json=body, headers=auth(token))


def _box(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", 8 + len(payload)) + kind + payload


def m4a(seconds: float, handler: bytes = b"soun") -> bytes:
    """A minimal MP4/M4A container: ftyp + moov(mvhd, trak/mdia/hdlr) + mdat."""
    mvhd = _box(
        b"mvhd", bytes(4) + struct.pack(">IIII", 0, 0, 1000, int(seconds * 1000)) + bytes(80)
    )
    hdlr = _box(b"hdlr", bytes(8) + handler + bytes(12) + b"\0")
    moov = _box(b"moov", mvhd + _box(b"trak", _box(b"mdia", hdlr)))
    return _box(b"ftyp", b"M4A \0\0\0\0M4A isom") + moov + _box(b"mdat", bytes(64))


def _voice(h: Harness, token: str, data: bytes, prompt: str = "ask_me_about", wave: str = WAVE):
    return h.client.post(
        f"/v1/profile/voice/{prompt}",
        files={"audio": ("note.m4a", data, "audio/mp4")},
        data={"waveform": wave},
        headers=auth(token),
    )


def _jpeg_with_gps() -> bytes:
    img = Image.new("RGB", (64, 48), (200, 120, 80))
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90°
    exif[0x8825] = {1: "N", 2: (19.0, 7.0, 0.0), 3: "E", 4: (72.0, 54.0, 0.0)}
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif, xmp=b"<x:xmpmeta>secret</x:xmpmeta>")
    return buf.getvalue()


def _photo(h: Harness, token: str, data: bytes):
    return h.client.post(
        "/v1/profile/photos", files={"image": ("p.jpg", data, "image/jpeg")}, headers=auth(token)
    )


def test_prompt_library_has_looking_for(h: Harness) -> None:
    lib = h.client.get("/v1/prompts").json()
    assert lib["looking_for"] == "looking_for"
    assert any(p["id"] == "looking_for" for p in lib["prompts"])


def test_put_profile_and_read_back(h: Harness) -> None:
    a = signup(h)
    assert _put(h, a.token, tags=["Quiz club"]).status_code == 204
    me = h.client.get("/v1/account/me", headers=auth(a.token)).json()
    assert [p["prompt_id"] for p in me["profile"]["prompts"]] == [p["prompt_id"] for p in PROMPTS]
    assert me["profile"]["tags"] == ["Quiz club"]


def test_profile_rules(h: Harness) -> None:
    a = signup(h)
    cases = {
        "invalid_prompts": [
            PROMPTS[:2],
            [PROMPTS[0], PROMPTS[0], PROMPTS[1]],
            [*PROMPTS[:2], {"prompt_id": "nope", "text": "x"}],
        ],
        "looking_for_required": [[*PROMPTS[1:], {"prompt_id": "geek_out", "text": "x"}]],
        "invalid_answer": [
            [*PROMPTS[:2], {"prompt_id": "ask_me_about", "text": "x" * 301}],
            [*PROMPTS[:2], {"prompt_id": "ask_me_about", "text": "   "}],
        ],
    }
    for code, variants in cases.items():
        for prompts in variants:
            r = _put(h, a.token, prompts=prompts)
            assert r.status_code == 422 and r.json()["error"] == code, (code, prompts)
    r = _put(h, a.token, tags=[f"t{i}" for i in range(9)])
    assert r.status_code == 422 and r.json()["error"] == "invalid_tags"


def test_photo_is_rotated_and_stripped_of_all_metadata(h: Harness) -> None:
    a = signup(h)
    r = _photo(h, a.token, _jpeg_with_gps())
    assert r.status_code == 201 and r.json()["index"] == 0
    stored = Path(h.settings.media.storage_dir) / f"{r.json()['media_id']}.jpg"
    data = stored.read_bytes()
    assert b"Exif" not in data and b"secret" not in data
    img = Image.open(io.BytesIO(data))
    assert len(img.getexif()) == 0
    assert img.size == (48, 64)  # orientation applied before stripping


def test_photo_limits_and_reindexing(h: Harness) -> None:
    a = signup(h)
    ids = [_photo(h, a.token, _jpeg_with_gps()).json()["media_id"] for _ in range(4)]
    r = _photo(h, a.token, _jpeg_with_gps())
    assert r.status_code == 409 and r.json()["error"] == "photos_full"
    assert h.client.delete("/v1/profile/photos/1", headers=auth(a.token)).status_code == 204
    me = h.client.get("/v1/account/me", headers=auth(a.token)).json()
    _put(h, a.token)
    me = h.client.get("/v1/account/me", headers=auth(a.token)).json()
    assert me["profile"]["photos"] == [ids[0], ids[2], ids[3]]
    assert h.client.delete("/v1/profile/photos/3", headers=auth(a.token)).status_code == 404
    assert _photo(h, a.token, b"not an image").status_code == 422


def test_photo_size_limit(make_harness) -> None:
    h = make_harness(media={"photo_max_bytes": 100})
    a = signup(h)
    r = _photo(h, a.token, _jpeg_with_gps())
    assert r.status_code == 413


def test_voice_upload_rules(h: Harness) -> None:
    a = signup(h)
    assert _voice(h, a.token, m4a(12)).status_code == 422  # no profile yet
    _put(h, a.token)
    r = _voice(h, a.token, m4a(12))
    assert r.status_code == 201
    first = r.json()["media_id"]
    assert _voice(h, a.token, m4a(31)).json()["error"] == "voice_too_long"
    assert _voice(h, a.token, m4a(5, handler=b"vide")).json()["error"] == "invalid_voice"
    assert _voice(h, a.token, b"garbage" * 10).json()["error"] == "invalid_voice"
    assert _voice(h, a.token, m4a(5), wave=json.dumps([1] * 47)).json()["error"] == "invalid_voice"
    assert (
        _voice(h, a.token, m4a(5), wave=json.dumps([101] * 48)).json()["error"] == "invalid_voice"
    )
    assert _voice(h, a.token, m4a(5), prompt="geek_out").json()["error"] == "prompt_not_in_profile"

    second = _voice(h, a.token, m4a(20)).json()["media_id"]
    media = Path(h.settings.media.storage_dir)
    assert not (media / f"{first}.m4a").exists() and (media / f"{second}.m4a").exists()
    me = h.client.get("/v1/account/me", headers=auth(a.token)).json()
    ask = next(p for p in me["profile"]["prompts"] if p["prompt_id"] == "ask_me_about")
    assert ask["voice_media_id"] == second and len(ask["waveform"]) == 48

    assert (
        h.client.delete("/v1/profile/voice/ask_me_about", headers=auth(a.token)).status_code == 204
    )
    assert (
        h.client.delete("/v1/profile/voice/ask_me_about", headers=auth(a.token)).status_code == 404
    )
    assert not (media / f"{second}.m4a").exists()


def test_changing_prompts_removes_orphaned_voice(h: Harness) -> None:
    a = signup(h)
    _put(h, a.token)
    vid = _voice(h, a.token, m4a(10)).json()["media_id"]
    _put(h, a.token, prompts=[*PROMPTS[:2], {"prompt_id": "geek_out", "text": "Keyboards."}])
    assert not (Path(h.settings.media.storage_dir) / f"{vid}.m4a").exists()
