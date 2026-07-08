"""Workspace Lease Manager (CLAUDE.md §5 — the lock-breaker).

No tool gets raw write access without a lease. This makes "Aider edits a file
while OpenHands compiles it" structurally impossible: a write lease and a
test-env lease on overlapping scope cannot be held at once.

Lease kinds: read, write, test_env, vault, migration.
Conflict rule: two leases conflict iff their scopes overlap AND at least one is
exclusive (write / test_env / migration). Reads never conflict with reads.

This is an in-process authority used by the workers and the tests. The Rust
control-plane (§1) holds the canonical, durable version; the conflict logic is
identical so behaviour matches.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Dict, List, Optional

EXCLUSIVE = {"write", "test_env", "migration"}
_VALID = {"read", "write", "test_env", "vault", "migration"}

_seq = itertools.count(1)


@dataclass(frozen=True)
class Lease:
    token: str
    mission_id: str
    kind: str
    scope: str  # a path or directory prefix, e.g. "src/" or "src/auth/jwt.py"


def _overlap(a: str, b: str) -> bool:
    """True if two scope paths overlap (prefix containment, either direction)."""
    a = a.rstrip("/")
    b = b.rstrip("/")
    if a == b:
        return True
    return a.startswith(b + "/") or b.startswith(a + "/")


@dataclass
class LeaseManager:
    _held: Dict[str, Lease] = field(default_factory=dict)
    _queue: List[dict] = field(default_factory=list)

    def _conflicts(self, kind: str, scope: str) -> Optional[Lease]:
        for lease in self._held.values():
            if not _overlap(scope, lease.scope):
                continue
            if kind in EXCLUSIVE or lease.kind in EXCLUSIVE:
                return lease
        return None

    def acquire(self, mission_id: str, kind: str, scope: str) -> Optional[Lease]:
        """Return a Lease, or None if the request was queued (scope busy)."""
        if kind not in _VALID:
            raise ValueError(f"invalid lease kind '{kind}'")
        if self._conflicts(kind, scope) is not None:
            self._queue.append({"mission_id": mission_id, "kind": kind, "scope": scope})
            return None
        lease = Lease(token=f"lease-{next(_seq)}", mission_id=mission_id, kind=kind, scope=scope)
        self._held[lease.token] = lease
        return lease

    def release(self, token: str) -> None:
        """Release a lease and promote the first queued request it unblocks."""
        self._held.pop(token, None)
        for i, req in enumerate(list(self._queue)):
            if self._conflicts(req["kind"], req["scope"]) is None:
                self._queue.pop(i)
                self.acquire(req["mission_id"], req["kind"], req["scope"])
                break

    def held(self) -> List[Lease]:
        return list(self._held.values())

    def queued(self) -> List[dict]:
        return list(self._queue)
