"""
KeyStoneOS — Mission workflow (Temporal).

This is the SPINE. It encodes the One Rule: agents propose, tools execute, only
this workflow commits. Each step is a sequential, idempotent, compensatable
activity. Activities live in /workflows/activities and are thin wrappers around
the real tools — they must NOT call each other.

Extend the activity bodies; do NOT change the control flow without re-reading
CLAUDE.md §4 and §7.

    pip install temporalio
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from activities import (
        acquire_workspace_lease, release_lease,
        create_worktree, delete_worktree,
        agent_plan,
        build_context_pack,
        code_edit, discard_worktree_changes,
        sandbox_run,
        qa_review,
        git_commit, revert_commit,
        graph_reindex, mark_index_stale,
        obsidian_sync,
        skill_candidate,
        check_skill_cache,
        debugger_subagent,
    )

MAX_ATTEMPTS = 3        # CLAUDE.md §7 hard ceiling
MAX_SAME_ERROR = 2      # identical fingerprint => break

# Activities never silently retry side effects; the workflow owns retry logic.
NO_AUTO_RETRY = RetryPolicy(maximum_attempts=1)


@dataclass
class MissionInput:
    mission_id: str
    request: str
    branch: str


@dataclass
class MissionResult:
    status: str                       # "complete" | "human_review"
    commit: str | None = None
    failures: list[str] = field(default_factory=list)


def _fingerprint(err: dict) -> str:
    """hash(error_type + top_stack_frame + file + failing_test + command)."""
    key = "|".join(str(err.get(k, "")) for k in
                   ("error_type", "top_frame", "file", "failing_test", "command"))
    return hashlib.sha256(key.encode()).hexdigest()[:16]


@workflow.defn
class MissionWorkflow:
    @workflow.run
    async def run(self, inp: MissionInput) -> MissionResult:
        a_opts = dict(start_to_close_timeout=timedelta(minutes=10),
                      retry_policy=NO_AUTO_RETRY)
        completed: list = []   # for compensation in reverse order

        async def do(activity, arg, compensation=None):
            res = await workflow.execute_activity(activity, arg, **a_opts)
            if compensation:
                completed.append((compensation, arg))
            return res

        async def compensate():
            for comp, arg in reversed(completed):
                await workflow.execute_activity(comp, arg, **a_opts)

        try:
            # 1-2  Lease + isolated worktree (copy-on-write; CLAUDE.md §5)
            await do(acquire_workspace_lease, inp.mission_id, release_lease)
            await do(create_worktree, inp, delete_worktree)

            # 3-4  Plan (LangGraph -> intent JSON) + graph-first context pack (§6)
            plan = await do(agent_plan, inp)
            ctx = await do(build_context_pack, {"mission": inp.mission_id, "plan": plan})

            # 5-7  Bounded repair loop (§7). Aider edits, OpenHands tests on a
            #      SNAPSHOT, QA reviews. Loop Governor lives here, not in agents.
            seen: dict[str, int] = {}
            green = False
            for attempt in range(1, MAX_ATTEMPTS + 1):
                # Short-circuit: reuse a validated skill if one matches (§7).
                skill = await workflow.execute_activity(
                    check_skill_cache, ctx, **a_opts)

                edit_arg = {"mission": inp.mission_id, "context": ctx,
                            "attempt": attempt, "skill": skill}
                await do(code_edit, edit_arg, discard_worktree_changes)

                run = await workflow.execute_activity(sandbox_run, inp, **a_opts)
                if run["passed"]:
                    await workflow.execute_activity(qa_review, run, **a_opts)
                    green = True
                    break

                fp = _fingerprint(run["error"])
                seen[fp] = seen.get(fp, 0) + 1
                self_log = f"attempt {attempt} failed fp={fp} count={seen[fp]}"
                workflow.logger.info(self_log)

                # Circuit breaker: same error twice => stuck, not converging.
                if seen[fp] >= MAX_SAME_ERROR or attempt == MAX_ATTEMPTS:
                    break

                # Don't blindly re-edit: route the FAILED LOG to a debugger.
                ctx = await workflow.execute_activity(
                    debugger_subagent, {"context": ctx, "run": run}, **a_opts)

            if not green:
                await compensate()
                return MissionResult(status="human_review",
                                     failures=[f"{k}:{v}" for k, v in seen.items()])

            # 8  Commit — ONLY the workflow commits (§0, §1).
            commit = await do(git_commit, inp, revert_commit)

            # 9  Reindex. If this fails AFTER a green commit, keep the commit and
            #    mark the index stale — do NOT rerun the edit (§4).
            try:
                await workflow.execute_activity(graph_reindex, inp, **a_opts)
            except Exception:
                await workflow.execute_activity(mark_index_stale, inp, **a_opts)

            # 10  Human-facing docs, derived from the now-canonical state.
            await workflow.execute_activity(obsidian_sync, inp, **a_opts)

            # 11  Skill capture — terminal, green-only. Hermes never learns
            #     broken intermediate states (§7).
            await workflow.execute_activity(skill_candidate, inp, **a_opts)

            # 12  Release.
            await workflow.execute_activity(release_lease, inp.mission_id, **a_opts)
            return MissionResult(status="complete", commit=commit)

        except Exception:
            await compensate()
            raise
