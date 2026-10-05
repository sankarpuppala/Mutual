"""Photo cleaning, voice-note checks and media files on disk (SPEC.md §11 Profile).

Photos are decoded, rotated by their EXIF orientation, rebuilt from raw pixels (so no
EXIF, GPS, XMP or ICC data can survive), downscaled and re-encoded as JPEG.
Voice notes must be MP4/M4A audio no longer than ``media.voice_max_seconds``; the
duration is read from the container's ``mvhd`` box.
"""

from __future__ import annotations

import hashlib
import io
import struct
from collections.abc import Iterator
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from mutual_server.config import MediaConfig

_MAX_PIXELS = 50_000_000  # decompression-bomb guard (pixels) before decoding
_CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"udta", b"edts"}


class MediaError(ValueError):
    """The upload is not acceptable; the message is safe to show to the user."""


def clean_photo(raw: bytes, config: MediaConfig) -> bytes:
    """Return a metadata-free JPEG of the photo, at most ``photo_max_dimension`` pixels wide/high."""
    Image.MAX_IMAGE_PIXELS = _MAX_PIXELS
    try:
        with Image.open(io.BytesIO(raw)) as img:
            if img.format not in ("JPEG", "PNG", "WEBP", "HEIF", "MPO"):
                raise MediaError("photo must be JPEG, PNG or WebP")
            img.load()
            oriented = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise MediaError("could not read the photo") from exc
    oriented.thumbnail((config.photo_max_dimension, config.photo_max_dimension))
    clean = Image.frombytes("RGB", oriented.size, oriented.tobytes())  # drops every metadata key
    out = io.BytesIO()
    clean.save(out, "JPEG", quality=config.photo_jpeg_quality, optimize=True)
    return out.getvalue()


def _boxes(data: bytes, start: int = 0, end: int | None = None) -> Iterator[tuple[bytes, int, int]]:
    """Yield ``(type, payload_start, payload_end)`` for each MP4 box in ``data[start:end]``."""
    end = len(data) if end is None else end
    pos = start
    while pos + 8 <= end:
        size, kind = struct.unpack(">I4s", data[pos : pos + 8])
        header = 8
        if size == 1:
            if pos + 16 > end:
                raise MediaError("voice note is not a valid audio file")
            size = struct.unpack(">Q", data[pos + 8 : pos + 16])[0]
            header = 16
        elif size == 0:
            size = end - pos
        if size < header or pos + size > end:
            raise MediaError("voice note is not a valid audio file")
        yield kind, pos + header, pos + size
        pos += size


def _walk(data: bytes, start: int = 0, end: int | None = None) -> Iterator[tuple[bytes, int, int]]:
    for kind, s, e in _boxes(data, start, end):
        yield kind, s, e
        if kind in _CONTAINERS:
            yield from _walk(data, s, e)


def voice_duration_seconds(raw: bytes) -> float:
    """Validate an M4A/MP4 audio file and return its duration in seconds."""
    boxes = list(_walk(raw))
    if not boxes or boxes[0][0] != b"ftyp":
        raise MediaError("voice note must be an M4A (AAC) file")
    handlers = set()
    duration: float | None = None
    for kind, s, e in boxes:
        if kind == b"mvhd" and e - s >= 20:
            version = raw[s]
            if version == 1 and e - s >= 32:
                timescale, dur = struct.unpack(">IQ", raw[s + 20 : s + 32])
            else:
                timescale, dur = struct.unpack(">II", raw[s + 12 : s + 20])
            if timescale == 0:
                raise MediaError("voice note is not a valid audio file")
            duration = dur / timescale
        elif kind == b"hdlr" and e - s >= 12:
            handlers.add(raw[s + 8 : s + 12])
    if duration is None:
        raise MediaError("voice note is not a valid audio file")
    if b"soun" not in handlers or b"vide" in handlers:
        raise MediaError("voice note must contain audio only")
    return duration


def check_waveform(values: object, config: MediaConfig) -> list[int]:
    """Exactly ``waveform_points`` integers in 0..100 (SPEC.md §11)."""
    if (
        not isinstance(values, list)
        or len(values) != config.waveform_points
        or not all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 100 for v in values)
    ):
        raise MediaError(f"waveform must be {config.waveform_points} integers from 0 to 100")
    return values


def store(storage_dir: Path, name: str, data: bytes) -> tuple[int, str]:
    """Write ``data`` to ``storage_dir/name``; return ``(size_bytes, sha256_hex)``."""
    storage_dir.mkdir(parents=True, exist_ok=True)
    (storage_dir / name).write_bytes(data)
    return len(data), hashlib.sha256(data).hexdigest()


def remove(storage_dir: Path, name: str) -> None:
    (storage_dir / name).unlink(missing_ok=True)
