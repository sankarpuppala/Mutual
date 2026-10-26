"""Photo cleaning, voice-note checks, and media storage backends (SPEC.md §11 Profile).

Photos are decoded, rotated by their EXIF orientation, rebuilt from raw pixels (so no
EXIF, GPS, XMP or ICC data can survive), downscaled and re-encoded as JPEG.
Voice notes must be MP4/M4A audio no longer than ``media.voice_max_seconds``; the
duration is read from the container's ``mvhd`` box.

Storage is abstracted behind ``MediaStore`` (a Protocol).  ``DiskStore`` writes to the
local filesystem; ``R2Store`` writes to a Cloudflare R2 bucket via the S3-compatible API.
``make_store(settings)`` returns the right backend based on ``media.r2`` in config.
"""

from __future__ import annotations

import hashlib
import io
import os
import struct
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Protocol

from PIL import Image, ImageOps, UnidentifiedImageError

from mutual_server.config import MediaConfig, Settings

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


# ---------------------------------------------------------------------------
# Storage-backend abstraction
# ---------------------------------------------------------------------------


class MediaStore(Protocol):
    """Minimal interface both DiskStore and R2Store implement."""

    def store(self, name: str, data: bytes) -> tuple[int, str]:
        """Persist ``data`` under ``name``; return ``(size_bytes, sha256_hex)``."""
        ...

    def remove(self, name: str) -> None:
        """Delete the object at ``name``.  Idempotent — no error if already absent."""
        ...

    def read(self, name: str) -> bytes:
        """Return the full contents of the object at ``name``."""
        ...


def _safe_media_dir(directory: Path | None = None) -> Path:
    if directory is not None:
        try:
            directory.mkdir(parents=True, exist_ok=True)
            return directory
        except (PermissionError, OSError):
            pass
    fallback = Path(tempfile.gettempdir()) / "mutual_media"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


class DiskStore:
    """Stores files under a local directory.  Used in dev/test and on any self-hosted VM."""

    def __init__(self, directory: Path) -> None:
        self._dir = _safe_media_dir(directory)

    def store(self, name: str, data: bytes) -> tuple[int, str]:
        return store(self._dir, name, data)

    def remove(self, name: str) -> None:
        remove(self._dir, name)

    def read(self, name: str) -> bytes:
        return (self._dir / name).read_bytes()


class R2Store:
    """Stores files in a Cloudflare R2 bucket via the S3-compatible API.

    boto3 is an optional dependency (``pip install 'mutual-server[r2]'``).  The constructor
    raises ``ConfigError`` at startup if the package is missing or if the required
    environment variables are not set.
    """

    def __init__(
        self,
        bucket: str,
        account_id: str,
        access_key_id: str,
        secret_access_key: str,
        endpoint_url: str | None = None,
        fallback_dir: Path | None = None,
    ) -> None:
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:
            from mutual_server.config import ConfigError

            raise ConfigError("R2 storage requires boto3: pip install 'mutual-server[r2]'") from exc
        self._bucket = bucket
        fallback_path = _safe_media_dir(fallback_dir)
        self._fallback_disk = DiskStore(fallback_path)
        endpoint = (
            endpoint_url
            or os.environ.get("MUTUAL_R2_ENDPOINT")
            or f"https://{account_id}.r2.cloudflarestorage.com"
        )
        # boto3 is untyped; Any suppresses the resulting noise.
        self._client: Any = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name="auto",
            config=Config(signature_version="s3v4", connect_timeout=5, read_timeout=5),
        )

    def store(self, name: str, data: bytes) -> tuple[int, str]:
        try:
            self._client.put_object(Bucket=self._bucket, Key=name, Body=data)
            return len(data), hashlib.sha256(data).hexdigest()
        except Exception as exc:
            print(
                f"[media] WARNING: Cloudflare R2 upload to {self._bucket}/{name} failed: {exc!r}. "
                "Saving to local storage.",
                file=sys.stderr,
            )
            return self._fallback_disk.store(name, data)

    def remove(self, name: str) -> None:
        try:
            # R2's delete_object is idempotent — no error if the key does not exist.
            self._client.delete_object(Bucket=self._bucket, Key=name)
        except Exception:
            pass
        self._fallback_disk.remove(name)

    def read(self, name: str) -> bytes:
        try:
            resp = self._client.get_object(Bucket=self._bucket, Key=name)
            return resp["Body"].read()  # type: ignore[no-any-return]
        except Exception:
            return self._fallback_disk.read(name)


def make_store(settings: Settings) -> MediaStore:
    """Return the configured storage backend, validated eagerly so startup fails fast."""
    r2 = settings.media.r2
    if r2 is None:
        # Check environment variable overrides (12-factor cloud deployment, e.g. Render)
        env_bucket = os.environ.get("MUTUAL_R2_BUCKET")
        env_account = os.environ.get("MUTUAL_R2_ACCOUNT_ID")
        if env_bucket and env_account:
            from mutual_server.config import R2Config

            r2 = R2Config(bucket=env_bucket, account_id=env_account)

    if r2 is not None:
        access_key_id = os.environ.get(r2.access_key_id_env, "")
        secret_access_key = os.environ.get(r2.secret_access_key_env, "")
        if not access_key_id or not secret_access_key:
            from mutual_server.config import ConfigError

            raise ConfigError(
                f"R2 storage requires environment variables "
                f"{r2.access_key_id_env} and {r2.secret_access_key_env}"
            )
        return R2Store(
            bucket=r2.bucket,
            account_id=r2.account_id,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            fallback_dir=settings.resolve_path(settings.media.storage_dir),
        )
    return DiskStore(settings.resolve_path(settings.media.storage_dir))
