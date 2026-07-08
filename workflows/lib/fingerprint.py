"""Failure fingerprinting (CLAUDE.md §7).

The Loop Governor breaks the Aider->OpenHands->fail->Aider loop by detecting a
repeated *identical* failure. The fingerprint is the identity of a failure:

    hash(error_type + top_stack_frame + file + failing_test + command)

Identical fingerprint twice => the agent is stuck, not converging => break.
"""

from __future__ import annotations

import hashlib
from typing import Mapping

_FIELDS = ("error_type", "top_frame", "file", "failing_test", "command")


def fingerprint(err: Mapping[str, object]) -> str:
    """Stable 16-char fingerprint for a failure record."""
    key = "|".join(str(err.get(k, "")) for k in _FIELDS)
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def is_stuck(seen: Mapping[str, int], max_same_error: int = 2) -> bool:
    """True if any single failure fingerprint has recurred >= max_same_error."""
    return any(count >= max_same_error for count in seen.values())
