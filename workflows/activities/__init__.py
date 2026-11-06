"""
KeyStoneOS — Activity implementations.

Each activity is a THIN wrapper around one tool. Hard rules (CLAUDE.md §3):
  * Activities NEVER call each other. The workflow sequences them.
  * Every activity is idempotent: key = mission_id + activity + input_hash.
  * Side-effecting activities have a matching compensation in the workflow.
  * No tool exceeds its lane: Aider edits, OpenHands executes (logs only),
    Hermes learns (green-only), Goose may run git but never DECIDES to commit.

Bodies are filled; the boundaries are kept. The Rust control-plane (§1) holds
the canonical lease manager + model router; the in-worker LeaseManager here is
the same conflict logic so behaviour matches when running workers standalone.
True external-tool I/O is isolated behind lib/clients.py; the two integration
points that need a running tool (Aider, Understand-Anything) raise
NotImplementedError rather than fake a result.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone

from temporalio import activity, exceptions

from lib import clients, config
from lib.leases import LeaseManager
from lib.policy import Action, CapabilityToken, PolicyContext, evaluate

# Canonical lease authority lives in the Rust control-plane; this mirror lets the
# Python worker enforce §5 conflicts when run on its own.
_LEASES = LeaseManager()
_LEASE_TOKENS: dict[str, str] = {}  # mission_id -> lease token


def _idem_key(mission_id: str, name: str, payload: object) -> str:
    raw = json.dumps(payload, sort_keys=True, default=str).encode()
    return f"{mission_id}:{name}:{hashlib.sha256(raw).hexdigest()[:12]}"


def _edit_worktree(mission_id: str) -> str:
    return os.path.join(config.WORKSPACES, f"{mission_id}-edit")


def _mint(mission_id: str, tool: str, capability: str, scope: list, minutes: int = 30) -> CapabilityToken:
    exp = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
    return CapabilityToken(mission_id=mission_id, tool=tool, capability=capability,
                           scope=scope, expires_at=exp)


def _append_ledger(record: dict) -> None:
    record["ts"] = datetime.now(timezone.utc).isoformat()
    os.makedirs(os.path.dirname(config.LEDGER) or ".", exist_ok=True)
    with open(config.LEDGER, "a") as fh:
        fh.write(json.dumps(record) + "\n")


# --- Lease + worktree (Workspace Lease Manager; CLAUDE.md §5) ----------------
@activity.defn
async def acquire_workspace_lease(mission_id: str) -> str:
    """Acquire an exclusive lease. Block (queue) if held. Return lease token."""
    lease = _LEASES.acquire(mission_id, "write", "/")
    if lease is None:
        # Queued behind another mission on this scope — Temporal will retry.
        raise exceptions.ApplicationError("scope busy — mission queued", non_retryable=False)
    _LEASE_TOKENS[mission_id] = lease.token
    return lease.token


@activity.defn
async def release_lease(mission_id: str) -> None:
    token = _LEASE_TOKENS.pop(mission_id, None)
    if token:
        _LEASES.release(token)


@activity.defn
async def create_worktree(inp) -> str:
    """`git worktree add /workspaces/<id>-edit <branch>`. Cross-platform; NOT OverlayFS."""
    path = _edit_worktree(inp.mission_id)
    clients.worktree_add(inp.branch, path)
    return path


@activity.defn
async def delete_worktree(inp) -> None:
    clients.worktree_remove(_edit_worktree(inp.mission_id))


# --- Planning + context (intents only; graph-first retrieval) ----------------
@activity.defn
async def agent_plan(inp) -> dict:
    """LangGraph produces an INTENT (JSON). It must NOT touch files."""
    prompt = (
        "You are the KeyStoneOS planner. Emit ONLY a JSON intent for this request; "
        "do not write files.\n"
        f"Request: {inp.request}\n"
        'Schema: {"intent": str, "rationale": str, '
        '"proposed_edits": [{"file": str, "change": str}], '
        '"capability_request": {"tool": "aider", "capability": "write_files", "scope": [str]}}'
    )
    raw = clients.ollama_generate("qwen2.5-coder:32b", prompt, fmt="json")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"intent": "unparsed", "rationale": raw, "proposed_edits": [],
                "capability_request": {"tool": "aider", "capability": "write_files", "scope": []}}


@activity.defn
async def build_context_pack(arg) -> dict:
    """Graph-first (Memgraph) -> vector-filter (Qdrant) -> rerank -> compress
    -> cited Context Pack. Never dump the repo. See docs/context-pack.md."""
    plan = arg.get("plan", {})
    target_files = [e.get("file") for e in plan.get("proposed_edits", []) if e.get("file")]
    # Structural tier would query Memgraph for the sub-graph of these files; here we
    # seed the vector tier with the planned targets and rerank exact symbols first.
    chunks = []
    for f in target_files:
        vec = clients.ollama_embed(f)
        chunks.extend(clients.qdrant_search("code", vec, limit=6))
    return {
        "mission": arg.get("mission"),
        "targets": target_files,
        "chunks": chunks[:12],
        "capability_request": plan.get("capability_request", {}),
        "citations": [c.get("payload", {}).get("path") for c in chunks[:12]],
    }


@activity.defn
async def check_skill_cache(ctx) -> dict | None:
    """Vector-search .skills/ via Cognee for a validated skill matching the
    error fingerprint. If found, the workflow can skip the sandbox cycle."""
    fp = ctx.get("error_fingerprint")
    if not fp:
        return None
    hits = clients.qdrant_search("skills", clients.ollama_embed(fp), limit=1)
    if hits and hits[0].get("score", 0) >= 0.9:
        return hits[0].get("payload")
    return None


# --- Aider (edits ONLY; into the -edit worktree) -----------------------------
@activity.defn
async def code_edit(arg) -> dict:
    """Aider writes surgical diffs to the leased -edit worktree. Autonomous mode
    OFF. No shell, no commit, no docs, no skills. Returns the patch."""
    ctx = arg["context"]
    mission_id = arg["mission"]
    cap_req = ctx.get("capability_request", {})
    scope = cap_req.get("scope") or ctx.get("targets", [])

    # §8: mint a scoped capability and POLICY-CHECK before any write.
    token = _mint(mission_id, "aider", "write_files", scope)
    decision = evaluate(token, Action("write_files", scope), PolicyContext(airgap=config.AIRGAP))
    if not decision:
        raise exceptions.ApplicationError(f"policy denied edit: {decision.reasons}", non_retryable=True)

    patch = _run_aider(_edit_worktree(mission_id), scope, ctx, arg.get("skill"))
    return {"patch": patch, "files": scope,
            "idem": _idem_key(mission_id, "code_edit", arg.get("attempt"))}


def _run_aider(worktree: str, scope: list, ctx: dict, skill) -> str:
    """Invoke Aider in the worktree. Returns a unified diff. Integration point:
    wire to the `aider` CLI/SDK with autonomous mode OFF and writes limited to
    `scope`."""
    import shutil
    if shutil.which("aider"):
        import subprocess
        # Build safe command list, no shell=True
        cmd = ["aider", "--no-auto-commits", "--message", ctx.get("debugger_hint", "Apply changes"), "--"] + scope
        try:
            subprocess.run(cmd, cwd=worktree, check=True, capture_output=True, text=True)
            # Fetch the resulting diff to return
            return clients.git(["diff", "HEAD"], cwd=worktree)
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Aider execution failed: {e.stderr}")
    else:
        import os
        if os.environ.get("KEYSTONE_MOCK") == "1":
            return "MOCKED: diff --git a/mock b/mock\n--- a/mock\n+++ b/mock\n@@ -1,1 +1,1 @@\n-mock\n+mock updated"
        raise RuntimeError("aider CLI not found. Install aider or set KEYSTONE_MOCK=1")


@activity.defn
async def discard_worktree_changes(arg) -> None:
    clients.git(["checkout", "--", "."], cwd=_edit_worktree(arg["mission"]))


# --- OpenHands (executes ONLY; logs out, no writes) --------------------------
@activity.defn
async def sandbox_run(inp) -> dict:
    """Apply the patch to a SNAPSHOT, run in an ephemeral Docker container with
    network:none. Return {passed, error{...}, logs, artifacts}. Cannot mutate
    the canonical repo. This is why edit-during-compile cannot deadlock."""
    snapshot = f"{inp.mission_id}-test"
    result = clients.openhands_run(snapshot, "pytest -q")
    return {
        "passed": bool(result.get("passed")),
        "error": result.get("error", {}),
        "logs": result.get("logs", ""),
        "artifacts": result.get("artifacts", []),
    }


# --- QA + debugger (LangGraph sub-agents) ------------------------------------
@activity.defn
async def qa_review(run) -> dict:
    summary = run.get("logs", "")[-2000:]
    verdict = clients.ollama_generate(
        "qwen2.5-coder:32b",
        f"QA: did this run stay in scope and pass cleanly? Reply pass/concerns.\n{summary}",
    )
    return {"verdict": verdict.strip()[:200], "passed": run.get("passed", False)}


@activity.defn
async def debugger_subagent(arg) -> dict:
    """On failure, read the FAILED TEST LOG (not the source) and return an
    updated context pack. Prevents blind re-edit loops."""
    ctx, run = arg["context"], arg["run"]
    log = run.get("logs", "") + "\n" + json.dumps(run.get("error", {}))
    hint = clients.ollama_generate(
        "qwen2.5-coder:32b",
        f"Read this FAILED TEST LOG (not source) and state the minimal fix:\n{log[-3000:]}",
    )
    new_ctx = dict(ctx)
    new_ctx["debugger_hint"] = hint.strip()
    return new_ctx


# --- Git (orchestrator-owned commit; Goose may run it, never decide) ---------
@activity.defn
async def git_commit(inp) -> str:
    """Apply the validated patch to the feature branch and commit via Gitea.
    Convention: '<mission> code: <summary>'. Returns commit hash."""
    msg = f"{inp.mission_id} code: {inp.request[:64]}"
    return clients.gitea_commit(inp.branch, msg, cwd=_edit_worktree(inp.mission_id))


@activity.defn
async def revert_commit(inp) -> None:
    clients.git(["reset", "--hard", "HEAD~1"], cwd=_edit_worktree(inp.mission_id))


# --- Reindex (derived read models) -------------------------------------------
@activity.defn
async def graph_reindex(inp) -> None:
    """Understand-Anything (Tree-sitter) -> Memgraph structural edges; chunks ->
    Qdrant; Cognee memory. All point at the SHARED stores. Index, not truth.
    Integration point: run the tree-sitter pass over the committed branch."""
    import shutil
    import subprocess
    if shutil.which("understand-anything"):
        cmd = ["understand-anything", "index", "--branch", inp.branch]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    else:
        import os
        if os.environ.get("KEYSTONE_MOCK") == "1":
            _append_ledger({"mission": inp.mission_id, "event": "graph_reindex_mock", "mock": True})
        else:
            raise RuntimeError("understand-anything CLI not found. Install it or set KEYSTONE_MOCK=1")


@activity.defn
async def mark_index_stale(inp) -> None:
    _append_ledger({"mission": inp.mission_id, "event": "index_stale"})


# --- Obsidian (human-facing projection; after commit) ------------------------
@activity.defn
async def obsidian_sync(inp) -> None:
    """Write/update vault notes with strict frontmatter + [[backlinks]] under
    docs/vault. Human memory, derived from canonical state."""
    note = (
        f"---\nmission: {inp.mission_id}\nbranch: {inp.branch}\n---\n\n"
        f"# Run {inp.mission_id}\n\n{inp.request}\n\nSee [[keystoneos]].\n"
    )
    path = os.path.join("obsidian-vault", "Runs", f"{inp.mission_id}.md")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(note)


# --- Hermes (skills; GREEN-only, gated promotion) ----------------------------
@activity.defn
async def skill_candidate(inp) -> None:
    """Terminal, success-only. Wrap the final diff + error signature as a
    CANDIDATE skill. Never auto-activated; never in the run that created it."""
    path = os.path.join(".skills", f"{inp.mission_id}.candidate.yaml")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as fh:
        fh.write(
            f"name: {inp.mission_id}\nstatus: candidate          # gated promotion (§7); never activated this run (§10)\n"
            f"activated: false\nrequest: {inp.request!r}\n"
            f"provenance:\n  mission: {inp.mission_id}\n  branch: {inp.branch}\n  captured_on_green: true\n"
        )
    _append_ledger({"mission": inp.mission_id, "event": "skill_candidate", "activated": False})
