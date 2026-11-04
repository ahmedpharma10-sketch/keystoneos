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

if __name__ == "__main__":
    unittest.main()
