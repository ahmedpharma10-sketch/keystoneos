"""Unit tests for the KeyStoneOS core decision logic (lib/).

These cover the invariants that MUST hold regardless of any tool:
  - §7 failure fingerprinting + stuck detection
  - §8/§3 capability + forbidden-path policy
  - §5 lease conflict (the lock-breaker)

Run:  python -m unittest discover -s workflows -p 'test_*.py' -t .
"""

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lib.fingerprint import fingerprint, is_stuck  # noqa: E402
from lib.leases import LeaseManager  # noqa: E402
from lib.policy import (  # noqa: E402
    Action,
    CapabilityToken,
    PolicyContext,
    evaluate,
)


def _future(seconds=600):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def _past():
    return (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()


def _tok(cap="write_files", scope=("src/*", "tests/*"), exp=None):
    return CapabilityToken(
        mission_id="ks-001", tool="aider", capability=cap,
        scope=list(scope), expires_at=exp or _future(),
    )


class TestFingerprint(unittest.TestCase):
    def test_identical_failures_match(self):
        err = {"error_type": "AssertionError", "top_frame": "jwt.py:42",
               "file": "src/auth/jwt.py", "failing_test": "test_x", "command": "pytest"}
        self.assertEqual(fingerprint(err), fingerprint(dict(err)))

    def test_different_failures_differ(self):
        a = {"error_type": "AssertionError", "failing_test": "test_x"}
        b = {"error_type": "TypeError", "failing_test": "test_x"}
        self.assertNotEqual(fingerprint(a), fingerprint(b))

    def test_stuck_detection(self):
        self.assertFalse(is_stuck({"abc": 1}))
        self.assertTrue(is_stuck({"abc": 2}))  # same error twice => stuck


class TestPolicy(unittest.TestCase):
    def test_allows_in_scope_write(self):
        d = evaluate(_tok(), Action("write_files", ["src/auth/jwt.py"]), PolicyContext())
        self.assertTrue(d, d.reasons)

    def test_denies_out_of_scope(self):
        d = evaluate(_tok(scope=("src/*",)), Action("write_files", ["docs/x.md"]), PolicyContext())
        self.assertFalse(d)

    def test_denies_forbidden_policy_path(self):
        t = _tok(scope=(".keystone/policies/*",))
        d = evaluate(t, Action("write_files", [".keystone/policies/cap.rego"]), PolicyContext())
        self.assertFalse(d)  # forbidden even if scope tries to grant it

    def test_denies_secrets(self):
        d = evaluate(_tok(scope=("secrets/*",)), Action("write_files", ["secrets/db.env"]), PolicyContext())
        self.assertFalse(d)

    def test_denies_expired_token(self):
        d = evaluate(_tok(exp=_past()), Action("write_files", ["src/x.py"]), PolicyContext())
        self.assertFalse(d)

    def test_denies_network_in_airgap(self):
        d = evaluate(_tok(cap="network", scope=("*",)), Action("network"), PolicyContext(airgap=True))
        self.assertFalse(d)

    def test_allows_network_when_airgap_off(self):
        d = evaluate(_tok(cap="network", scope=("*",)), Action("network"), PolicyContext(airgap=False))
        self.assertTrue(d, d.reasons)

    def test_denies_editing_file_under_test(self):
        ctx = PolicyContext(files_under_test=frozenset({"src/auth/jwt.py"}))
        d = evaluate(_tok(), Action("write_files", ["src/auth/jwt.py"]), ctx)
        self.assertFalse(d)

    def test_denies_self_created_skill(self):
        ctx = PolicyContext(skills_created_this_run=frozenset({"reject-alg-none"}))
        t = _tok(cap="read_files", scope=("*",))
        d = evaluate(t, Action("read_files", skill_id="reject-alg-none"), ctx)
        self.assertFalse(d)

    def test_denies_bulk_delete_without_approval(self):
        t = _tok(cap="delete_files", scope=("src/*",))
        a = Action("delete_files", [f"src/f{i}.py" for i in range(8)])
        self.assertFalse(evaluate(t, a, PolicyContext(max_delete_without_approval=5)))
        self.assertTrue(evaluate(t, a, PolicyContext(max_delete_without_approval=5, has_human_approval=True)))


class TestLeases(unittest.TestCase):
    def test_write_blocks_overlapping_test_env(self):
        m = LeaseManager()
        w = m.acquire("ks-001", "write", "src/")
        self.assertIsNotNone(w)
        # OpenHands test-env over src/auth overlaps the write lease => queued.
        t = m.acquire("ks-001", "test_env", "src/auth/")
        self.assertIsNone(t)
        self.assertEqual(len(m.queued()), 1)

    def test_reads_do_not_conflict(self):
        m = LeaseManager()
        self.assertIsNotNone(m.acquire("a", "read", "src/"))
        self.assertIsNotNone(m.acquire("b", "read", "src/"))

    def test_release_promotes_queued(self):
        m = LeaseManager()
        w = m.acquire("ks-001", "write", "src/")
        self.assertIsNone(m.acquire("ks-002", "write", "src/auth/"))  # queued
        m.release(w.token)
        self.assertEqual(m.queued(), [])  # promoted on release
        self.assertEqual(len(m.held()), 1)

    def test_non_overlapping_scopes_coexist(self):
        m = LeaseManager()
        self.assertIsNotNone(m.acquire("a", "write", "src/auth/"))
        self.assertIsNotNone(m.acquire("b", "write", "src/api/"))


if __name__ == "__main__":
    unittest.main()
