import unittest
import asyncio
from unittest.mock import patch, MagicMock

import activities

class TestActivitiesMock(unittest.IsolatedAsyncioTestCase):
    @patch('shutil.which', return_value=None)
    def test_run_aider_mock(self, mock_which):
        # When aider is not installed, it should return a mock diff
        diff = activities._run_aider("/tmp", ["src/"], {}, None)
        self.assertIn("diff --git a/mock b/mock", diff)
        self.assertIn("+mock updated", diff)

    @patch('shutil.which', return_value="/usr/bin/aider")
    @patch('subprocess.run')
    @patch('lib.clients.git')
    def test_run_aider_real(self, mock_git, mock_run, mock_which):
        mock_git.return_value = "fake diff"
        diff = activities._run_aider("/tmp", ["src/"], {"debugger_hint": "fix it"}, None)
        self.assertEqual(diff, "fake diff")
        mock_run.assert_called_once_with(
            ["aider", "--no-auto-commits", "--message", "fix it", "--", "src/"],
            cwd="/tmp", check=True, capture_output=True, text=True
        )

    @patch('shutil.which', return_value=None)
    @patch('activities._append_ledger')
    async def test_graph_reindex_mock(self, mock_ledger, mock_which):
        inp = MagicMock()
        inp.branch = "test-branch"
        inp.mission_id = "ks-123"
        await activities.graph_reindex(inp)
        mock_ledger.assert_called_once_with({"mission": "ks-123", "event": "graph_reindex_mock"})

    @patch('shutil.which', return_value="/usr/bin/understand-anything")
    @patch('subprocess.run')
    async def test_graph_reindex_real(self, mock_run, mock_which):
        inp = MagicMock()
        inp.branch = "test-branch"
        inp.mission_id = "ks-123"
        await activities.graph_reindex(inp)
        mock_run.assert_called_once_with(
            ["understand-anything", "index", "--branch", "test-branch"],
            check=True, capture_output=True, text=True
        )

if __name__ == "__main__":
    unittest.main()
