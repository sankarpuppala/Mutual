"""Digest ranking (SPEC.md §11.1).

``random`` (Tier 1 default): a stable per-(viewer, day) shuffle seeded by an HMAC of the
pair. Ranking never uses signal, match or attention data (D18), and is identical across
reveal policies — this module takes only a viewer id, a day and a peer-id list.
"""

from __future__ import annotations

import hashlib
import hmac


def random_order(viewer_id: str, day: str, peer_ids: list[str]) -> list[str]:
    """A deterministic order, stable for this (viewer, day), unpredictable without the ids."""
    key = f"{viewer_id}:{day}".encode()
    return sorted(peer_ids, key=lambda pid: hmac.new(key, pid.encode(), hashlib.sha256).digest())
