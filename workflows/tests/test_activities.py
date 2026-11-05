import unittest
import asyncio
from unittest.mock import patch, MagicMock

import activities
from temporalio import exceptions

class TestActivities(unittest.IsolatedAsyncioTestCase):
    @patch('activities.evaluate')
    @patch('activities._mint')
    async def test_code_edit_policy_deny(self, mock_mint, mock_evaluate):
        # Mock policy evaluation to return False
        mock_evaluate.return_value = MagicMock(allow=False, reasons=["test deny"])
        mock_evaluate.return_value.__bool__ = lambda self: False

        arg = {
            "mission": "ks-1",
            "context": {"capability_request": {"scope": ["src/"]}}
        }

        with self.assertRaises(exceptions.ApplicationError) as context:
            await activities.code_edit(arg)

        self.assertIn("policy denied edit", str(context.exception))

if __name__ == "__main__":
    unittest.main()
