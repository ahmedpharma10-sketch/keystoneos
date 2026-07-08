"""KeyStoneOS Temporal worker.

Registers the MissionWorkflow (the §4 saga + §7 Loop Governor) and every
activity, then polls the task queue. Workflow state lives in Temporal/Postgres
(§2.2): crash here → resume from the last completed activity on restart.

    pip install -r requirements.txt
    python worker.py
"""

from __future__ import annotations

import asyncio

from temporalio.client import Client
from temporalio.worker import Worker

from lib import config
from mission_workflow import MissionWorkflow
import activities as A

ACTIVITIES = [
    A.acquire_workspace_lease, A.release_lease,
    A.create_worktree, A.delete_worktree,
    A.agent_plan,
    A.build_context_pack,
    A.check_skill_cache,
    A.code_edit, A.discard_worktree_changes,
    A.sandbox_run,
    A.qa_review, A.debugger_subagent,
    A.git_commit, A.revert_commit,
    A.graph_reindex, A.mark_index_stale,
    A.obsidian_sync,
    A.skill_candidate,
]


async def main() -> None:
    client = await Client.connect(config.TEMPORAL_ADDRESS)
    worker = Worker(
        client,
        task_queue=config.TEMPORAL_TASK_QUEUE,
        workflows=[MissionWorkflow],
        activities=ACTIVITIES,
    )
    print(f"KeyStoneOS worker on {config.TEMPORAL_ADDRESS} queue={config.TEMPORAL_TASK_QUEUE}")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
