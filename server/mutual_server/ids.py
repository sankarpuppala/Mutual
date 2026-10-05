"""Injectable id factories. Production uses UUIDv4; tests use a deterministic sequence
(the Phase 5 two-worlds leak test compares rows across runs, so ids must be reproducible)."""

from __future__ import annotations

import uuid


class UuidIds:
    """Random UUIDv4 strings (SPEC.md §12)."""

    def new(self) -> str:
        return str(uuid.uuid4())


class SequentialIds:
    """Deterministic UUIDv4-shaped ids 1, 2, 3, … for tests."""

    def __init__(self, start: int = 1) -> None:
        self._next = start

    def new(self) -> str:
        value = uuid.UUID(int=self._next, version=4)
        self._next += 1
        return str(value)


IdFactory = UuidIds | SequentialIds
