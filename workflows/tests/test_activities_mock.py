import unittest
import asyncio
import os
from unittest.mock import patch, MagicMock

import activities

class TestActivitiesMock(unittest.IsolatedAsyncioTestCase):
    @patch('shutil.which', return_value=None)
    @patch.dict(os.environ, {"KEYSTONE_MOCK": "1"})
    def test_run_aider_mock(self, mock_which):
        diff = activities._run_aider("/tmp", ["src/"], {}, None)
        self.assertTrue(diff.startswith("MOCKED: "), "Mock fallback must be labelled clearly")

    @patch('shutil.which', return_value=None)
    @patch.dict(os.environ, {}, clear=True)
    def test_run_aider_no_mock(self, mock_which):
        with self.assertRaisesRegex(RuntimeError, "aider CLI not found"):
            activities._run_aider("/tmp", ["src/"], {}, None)

    @patch('shutil.which', return_value=None)
    @patch.dict(os.environ, {"KEYSTONE_MOCK": "1"})
    @patch('activities._append_ledger')
    async def test_graph_reindex_mock(self, mock_ledger, mock_which):
        inp = MagicMock()
        inp.branch = "test-branch"
        inp.mission_id = "ks-123"
        await activities.graph_reindex(inp)
        mock_ledger.assert_called_once_with({"mission": "ks-123", "event": "graph_reindex_mock", "mock": True})

    @patch('shutil.which', return_value=None)
    @patch.dict(os.environ, {}, clear=True)
    async def test_graph_reindex_no_mock(self, mock_which):
        inp = MagicMock()
        with self.assertRaisesRegex(RuntimeError, "understand-anything CLI not found"):
            await activities.graph_reindex(inp)

if __name__ == "__main__":
    unittest.main()
