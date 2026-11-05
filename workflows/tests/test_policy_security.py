import unittest
from lib.policy import CapabilityToken, Action, PolicyContext, evaluate, _is_safe_path

class TestPolicySecurity(unittest.TestCase):
    def test_directory_traversal_denied(self):
        t = CapabilityToken(mission_id="ks-1", tool="aider", capability="write_files", scope=["*"], expires_at="2030-01-01T00:00:00Z")
        d = evaluate(t, Action("write_files", ["src/../secrets/token"]), PolicyContext())
        self.assertFalse(d)
        self.assertIn("unsafe directory traversal", d.reasons[0])

    def test_absolute_path_denied(self):
        t = CapabilityToken(mission_id="ks-1", tool="aider", capability="write_files", scope=["*"], expires_at="2030-01-01T00:00:00Z")
        d = evaluate(t, Action("write_files", ["/etc/passwd"]), PolicyContext())
        self.assertFalse(d)
        self.assertIn("unsafe directory traversal", d.reasons[0])

    def test_safe_path_allowed(self):
        t = CapabilityToken(mission_id="ks-1", tool="aider", capability="write_files", scope=["src/*"], expires_at="2030-01-01T00:00:00Z")
        d = evaluate(t, Action("write_files", ["src/main.py"]), PolicyContext())
        self.assertTrue(d)

    def test_windows_absolute_path_denied(self):
        t = CapabilityToken(mission_id="ks-1", tool="aider", capability="write_files", scope=["*"], expires_at="2030-01-01T00:00:00Z")
        self.assertFalse(evaluate(t, Action("write_files", ["C:\\Windows\\System32"]), PolicyContext()))
        self.assertFalse(evaluate(t, Action("write_files", ["D:/secrets/token"]), PolicyContext()))

    def test_env_files_denied(self):
        t = CapabilityToken(mission_id="ks-1", tool="aider", capability="write_files", scope=["*"], expires_at="2030-01-01T00:00:00Z")
        self.assertFalse(evaluate(t, Action("write_files", [".env"]), PolicyContext()))
        self.assertFalse(evaluate(t, Action("write_files", [".env.production"]), PolicyContext()))
        self.assertFalse(evaluate(t, Action("write_files", ["backend/.env"]), PolicyContext()))

    def test_scope_star_does_not_override_protected(self):
        t = CapabilityToken(mission_id="ks-1", tool="aider", capability="write_files", scope=["*"], expires_at="2030-01-01T00:00:00Z")
        d = evaluate(t, Action("write_files", [".env"]), PolicyContext())
        self.assertFalse(d)
        self.assertIn("is a forbidden path", d.reasons[0])

if __name__ == "__main__":
    unittest.main()

    def test_advanced_path_bypasses_denied(self):
        t = CapabilityToken(mission_id="ks-1", tool="aider", capability="write_files", scope=["*"], expires_at="2030-01-01T00:00:00Z")
        self.assertFalse(evaluate(t, Action("write_files", ["c:rel.txt"]), PolicyContext()))
        self.assertFalse(evaluate(t, Action("write_files", ["%SYSTEMROOT%/x"]), PolicyContext()))
        self.assertFalse(evaluate(t, Action("write_files", ["~/x"]), PolicyContext()))
        self.assertFalse(evaluate(t, Action("write_files", ["src/.env "]), PolicyContext()))
        self.assertFalse(evaluate(t, Action("write_files", [".env::$DATA"]), PolicyContext()))
