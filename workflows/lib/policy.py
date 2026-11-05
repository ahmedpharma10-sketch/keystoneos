"""OPA-style capability + policy engine (CLAUDE.md §8 and §3 "Forbidden").

Every tool action carries a scoped, expiring Capability Token. Before a worker
mutates anything, the policy engine must allow the action. This is the single
chokepoint that makes the §3 forbidden list unrepresentable, not merely
discouraged.

Pure logic, no I/O — so it is identical whether called from a Python activity or
mirrored by the Rust control-plane, and is fully unit-testable.
"""

from __future__ import annotations
import re

import fnmatch
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Sequence


# Paths no agent may ever touch (CLAUDE.md §3, §8).
FORBIDDEN_GLOBS = (
    ".keystone/policies/*",
    "**/.keystone/policies/*",
    "secrets/*",
    "**/secrets/*",
    "*.pem",
    "*.key",
    "**/id_rsa*",
    ".env",
    ".env.*",
    "**/.env",
    "**/.env.*",
)

VALID_CAPABILITIES = {"read_files", "write_files", "delete_files", "run_tests", "network"}


@dataclass(frozen=True)
class CapabilityToken:
    """The §8 token. `scope` is a list of path globs the action may touch."""
    mission_id: str
    tool: str
    capability: str
    scope: Sequence[str]
    expires_at: str  # RFC 3339 UTC
    approved_by: str = "orchestrator"

    def expired(self, now: datetime | None = None) -> bool:
        now = now or datetime.now(timezone.utc)
        try:
            exp = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
        except ValueError:
            return True
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        return now >= exp


@dataclass
class Action:
    """A concrete thing a tool wants to do."""
    capability: str
    paths: Sequence[str] = field(default_factory=list)
    skill_id: str | None = None          # for use_skill checks
    delete_count: int = 0


@dataclass
class PolicyContext:
    """Run-scoped facts the policy needs (CLAUDE.md §3, §7, §11)."""
    airgap: bool = True
    files_under_test: frozenset = frozenset()       # may not be edited (§3)
    skills_created_this_run: frozenset = frozenset()  # may not be activated (§10)
    max_delete_without_approval: int = 5
    has_human_approval: bool = False


@dataclass
class Decision:
    allow: bool
    reasons: List[str] = field(default_factory=list)

    def __bool__(self) -> bool:  # `if decision:` reads naturally
        return self.allow


def _matches_any(path: str, globs: Sequence[str]) -> bool:
    return any(fnmatch.fnmatch(path, g) for g in globs)


def _is_safe_path(path: str) -> bool:
    if ".." in path or path.startswith("/"):
        return False
    if len(path) >= 3 and path[1] == ":" and (path[2] == "/" or path[2] == chr(92)):
        if path[0].isalpha():
            return False
    if path.startswith(chr(92)):
        return False
    return True
def evaluate(token: CapabilityToken, action: Action, ctx: PolicyContext) -> Decision:
    """Allow/deny an action under a capability token and run context."""
    reasons: List[str] = []

    for p in action.paths:
        if not _is_safe_path(p):
            return Decision(False, [f"'{p}' contains unsafe directory traversal or is absolute"])

    if token.capability not in VALID_CAPABILITIES:
        return Decision(False, [f"unknown capability '{token.capability}'"])
    if action.capability != token.capability:
        return Decision(False, [f"token grants '{token.capability}', action needs '{action.capability}'"])
    if token.expired():
        return Decision(False, [f"capability expired at {token.expires_at}"])

    # §11 airgap: no network unless airgap is explicitly off.
    if action.capability == "network" and ctx.airgap:
        return Decision(False, ["airgap on: outbound network forbidden (§11)"])

    # §10: a skill may not be activated in the run that created it.
    if action.skill_id and action.skill_id in ctx.skills_created_this_run:
        return Decision(False, [f"skill '{action.skill_id}' was created this run (§10)"])

    for p in action.paths:
        # §3/§8 hard forbidden paths.
        if _matches_any(p, FORBIDDEN_GLOBS):
            return Decision(False, [f"'{p}' is a forbidden path (§3/§8)"])
        # Must be inside the granted scope.
        if not _matches_any(p, token.scope):
            return Decision(False, [f"'{p}' is outside capability scope {list(token.scope)}"])
        # §3: no editing a file currently under test.
        if action.capability in ("write_files", "delete_files") and p in ctx.files_under_test:
            return Decision(False, [f"'{p}' is under test — cannot mutate (§3)"])

    # §8: bulk deletes need human approval.
    if action.capability == "delete_files":
        n = action.delete_count or len(action.paths)
        if n > ctx.max_delete_without_approval and not ctx.has_human_approval:
            return Decision(False, [f"deleting {n} files needs approval (> {ctx.max_delete_without_approval})"])

    reasons.append("allowed")
    return Decision(True, reasons)
