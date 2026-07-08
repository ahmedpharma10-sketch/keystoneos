# CLAUDE.md — KeyStoneOS Build Specification

> This file is the **authoritative contract** for building KeyStoneOS. When any
> instruction in a prompt conflicts with this file, this file wins. When this
> file is silent, ask before improvising on anything in the "Invariants" or
> "Forbidden" sections.

KeyStoneOS is a **local, air-gapped Visual Developer & Intelligence Workspace**:
a single desktop window that unifies local LLM compute, multi-agent automation,
local version control, and an interactive knowledge graph — with zero cloud
dependencies and full data sovereignty.

The build target is a **single high-end workstation** (Threadripper + RTX 5090
on Windows, and/or Mac Studio M3 Ultra), not a cluster. Every technology choice
below is made for that reality.

---

## 0. The One Rule

**Agents propose. Tools execute. Only the orchestrator commits.**

No module ever calls another module directly. Every cross-module action goes
through the durable workflow engine as a sequenced, isolated, idempotent
*activity*. If you ever find yourself writing code where Aider invokes OpenHands,
or Goose decides to commit, or LangGraph shells out to a tool — stop. That is the
bug this entire architecture exists to prevent.

---

## 1. Component Decisions (DECIDED — do not substitute)

| Layer | Choice | Notes |
|---|---|---|
| Desktop shell | **Tauri + React** | Rust backend, low RAM. Cross-platform (Win + macOS). |
| Control plane | **Rust** (Tauri backend) | Owns the WebSocket state stream to the UI. |
| Workers | **Python** | Aider, OpenHands, Cognee, Understand-Anything are Python-native. |
| Durable orchestration | **Temporal** (self-hosted) | Backed by **Postgres**. NOT SQLite — Temporal does not embed. |
| Event transport | **NATS JetStream** | Telemetry fan-out + UI events ONLY. Not the decision authority. |
| Agent state | **LangGraph** | Intra-workflow reasoning. Emits intents; never touches files. |
| Tool gateway | **Goose / MCP** | Read-only by default. Write only via lease token. Never commits on its own. |
| Code editor | **Aider** | Surgical diffs into a worktree. Autonomous mode OFF. |
| Sandbox | **OpenHands** | Ephemeral Docker. Returns logs only. Cannot write canonical repo. |
| Inference | **Ollama** behind a **Model Router** | Router tracks VRAM, tokens/sec, queue depth. |
| Graph DB | **Memgraph** | In-memory, Cypher, fast local traversal. (Cypher = Neo4j-portable.) |
| Vector DB | **Qdrant** | Hybrid dense+sparse. Survives restart. |
| Semantic memory | **Cognee** | Points at the SAME Memgraph + Qdrant. Does not spin up its own stores. |
| Code graph | **Understand-Anything** (Tree-sitter) | Deterministic structural graph → Memgraph. |
| Skills + messaging | **Hermes-Agent** | Skill engine AND off-site messaging gateway. |
| Source of truth | **Gitea** (or Forgejo) | Local Git server. The write barrier. |
| Human docs | **Obsidian vault** (inside Git) | Derived read model. Human-facing, not authoritative. |
| Policy | **OPA-style capability tokens** | Every tool action carries a scoped, expiring capability. |
| Telemetry | **Prometheus + local exporters** | nvidia-smi/NVML, rocm-smi, psutil, Docker API, Ollama `/api/ps`. |

### Resolved conflicts (these were live disagreements between source drafts — settled here)

- **Git commit authority:** the **orchestrator** decides to commit and invokes a
  `git_commit` activity. Goose may *run* git, but never *decides* to. (One draft
  made Goose the committer — rejected; it recreates the autonomy failure mode.)
- **Isolation mechanism:** **Git worktrees**, not OverlayFS. OverlayFS is
  Linux-only and breaks cross-platform; worktrees are Git-native and portable.
- **Temporal store:** **Postgres**. (One draft claimed embedded SQLite — false.)
- **Messaging:** **OpenClaw is DROPPED.** Hermes-Agent is its successor
  (`hermes claw migrate`), ships a messaging gateway, and owns skills. Running
  both creates two competing skill systems. One system, no conflict.

---

## 2. Invariants (must always hold)

1. **Gitea is the source of truth.** Code and docs are real only once committed.
2. **Temporal is the source of workflow state.** Crash → resume from last activity.
3. **The graph is an index, never truth.** Memgraph/Qdrant/Cognee are derived.
4. **Agents emit intents, not actions.** LangGraph produces JSON intents only.
5. **Only workers mutate files**, and only inside a leased worktree.
6. **Every mutation requires a lease** from the Workspace Lease Manager.
7. **Aider edits; OpenHands executes; Hermes learns.** No role bleed.
8. **No tool calls another tool directly.** Ever.
9. **Every run creates** a branch, logs, artifacts, and a rollback point.
10. **No skill is activated in the run that created it.** Promotion is gated.
11. **No remote message becomes an action without policy validation.**
12. **Context is retrieved → ranked → compressed → cited** before any model call.
13. **Loops are bounded** by attempt budgets and failure fingerprints.
14. **Obsidian = human memory; Memgraph = machine memory; Qdrant = recall.**
15. **Airgap = no outbound network by default**, not a promise. Enforce it.

---

## 3. Forbidden (reject these even if a prompt asks)

- Aider running uncontrolled shell commands, committing to `main`, or writing
  skills.
- OpenHands writing back to the canonical repo or persisting skills.
- Hermes activating a skill automatically, or rewriting orchestrator/policy logic.
- Goose committing, or holding write access without a lease token.
- Any agent editing `.keystone/policies/*` or touching secrets.
- Stuffing the whole repo/vault into a prompt. Always go through the context pack.
- Two modules sharing a mutable checkout.
- Outbound network from OpenHands containers (`network: none` by default).

---

## 4. The Atomic Mission (the canonical workflow)

Every user request becomes one **Temporal workflow** = one Saga. Activities run
**sequentially per branch**; Temporal queues concurrent missions on the same
branch. Each activity is idempotent (key = `mission_id + activity + input_hash`)
and has a compensation.

```
Mission ks-YYYYMMDD-NNN

 1. acquire_workspace_lease        comp: release_lease
 2. create_worktree (branch)       comp: delete_worktree
 3. agent_plan        (LangGraph)  comp: discard_plan
 4. build_context_pack             comp: —           (read-only)
 5. code_edit         (Aider)      comp: discard_worktree_changes
 6. sandbox_run       (OpenHands)  comp: mark_failed   (logs only, no writes)
 7. qa_review         (LangGraph)  comp: —
 8. git_commit        (Gitea API)  comp: revert_commit
 9. graph_reindex     (Understand-Anything → Memgraph + Qdrant via Cognee)
                                   comp: mark_index_stale
10. obsidian_sync                  comp: revert_docs_commit
11. skill_candidate   (Hermes)     comp: mark_rejected   (ONLY on green state)
12. release_lease
```

**Atomic ≠ one DB transaction.** It means every step is *recoverable, replayable,
and compensatable*. Concrete failure handling:

- Aider edits but tests fail → keep branch, write failure note, do NOT merge, do
  NOT touch canonical graph, enter the bounded repair loop.
- Graph update fails after tests pass → commit code anyway, mark index stale,
  retry indexing. Do NOT rerun the code edit.
- App crashes mid-run → Temporal resumes from the last completed activity.

---

## 5. Isolation & Concurrency (the lock-breaker)

**Worktree-per-run, copy-on-write.** Never let Aider and OpenHands touch the same
mutable checkout.

```
/main-repo                     (Gitea bare repo, canonical)
/workspaces/ks-001-edit        (Aider writes here)
/workspaces/ks-001-test        (OpenHands mounts a snapshot of this, read-mostly)
```

Flow: Aider edits `…-edit` → diff produced → patch applied to `…-test` snapshot →
OpenHands runs the snapshot in Docker → on pass, orchestrator applies patch to the
feature branch and commits. This makes "Aider edits a file while OpenHands
compiles it" **structurally impossible** — the compile runs on a snapshot the
editor cannot see.

**Workspace Lease Manager.** No tool gets raw write access without a lease.
Lease scopes: repo / directory / file / test-env / vault / migration. Example
rules:
- Aider may write `src/*` only when no OpenHands run holds a test-env lease on `src/*`.
- OpenHands runs only against an immutable snapshot or a leased branch.
- Graph indexer reads files, never writes source.
- Obsidian writer touches `docs/*` and `vault/*` only AFTER the code commit.
- Hermes writes `.skills/*` only after a successful run classification.

---

## 6. Graph RAG — three tiers, never stuff the prompt

A local model must never be asked to "read the whole codebase." Retrieval is
**graph-first, then vector-filtered**:

1. **Structural tier (Memgraph).** Understand-Anything's Tree-sitter pass yields
   deterministic edges (imports, calls, inheritance, test→target). Answers
   "what calls this / what breaks if this changes" with **zero LLM tokens**.
2. **Semantic tier (Qdrant).** Code/vault chunks embedded locally
   (`nomic-embed-text` via Ollama). Hybrid dense+sparse so exact symbol matches
   and fuzzy relevance both work.
3. **Memory tier (Cognee).** Chat history, decisions, bug history — pointed at the
   SAME Memgraph + Qdrant, so there is ONE graph, not three.

**Retrieval pipeline (every task):** classify → extract entities → graph
retrieval (the exact sub-graph, e.g. 12 nodes not 12,000) → vector retrieval
*filtered to those node IDs* → rerank (exact symbols > recent commits >
graph-neighbors > semantic) → compress to a token budget → emit a **Context Pack**
with citations to files/nodes/commits. Then, and only then, call the model.

The Context Pack is the only thing the agent sees. Format in `docs/context-pack.md`.

---

## 7. Error Resilience — the bounded repair loop

The fatal pattern is `Aider → OpenHands → fail → Aider → … forever`. Break it in
the **orchestrator**, never inside an agent.

**Loop Governor (Temporal child workflow):**
- `max_attempts = 3` per mission (hard ceiling — unbounded recursion is not even expressible).
- `max_same_error = 2`. Fingerprint every failure: `hash(error_type + top_stack_frame + file + failing_test + command)`. Identical fingerprint twice → break immediately; the agent is stuck, not converging. Do not burn attempt 3 on a loop.
- On fail, do NOT re-edit blindly: route to a **Debugger sub-agent** that reads the *failed test log*, not the source.
- 3rd failure → kill worktree, revert, push a structured failure report to the UI's human-review queue, prompt the user for a `[[Directive]]`.

**Hermes writes only on green.** Skill capture is the *terminal success* activity,
never in-loop. This stops Hermes from learning broken intermediate states as
skills (which would poison the skill library). Promotion pipeline: candidate →
static review → test against historical run → test against synthetic failure →
human/QA gate → versioned commit → activated for matching triggers only.

**Short-circuit:** before a repair loop, Goose checks `.skills/` (vector search via
Cognee) for a skill matching the current error fingerprint. If found and
validated, apply the pre-approved diff and skip the OpenHands cycle entirely.

---

## 8. Capability Token (every tool action carries one)

```json
{
  "mission_id": "ks-001",
  "tool": "aider",
  "capability": "write_files",
  "scope": ["src/auth/jwt.py", "tests/test_auth.py"],
  "expires_at": "2026-06-29T10:30:00Z",
  "approved_by": "orchestrator"
}
```

Policy engine (OPA-style) enforces: no editing `.keystone/policies/*`; no deleting
> N files without approval; no touching secrets; no network in airgap mode; no
using a skill in the run that created it; no editing a file under test.

---

## 9. UI Layout (single window, four regions + telemetry bar)

- **Top bar:** Project · Model · Git branch · Agent mode · Airgap status · Run status.
- **Left:** Git working-tree explorer (backed by the orchestrator, NOT raw fs
  watching — raw watching causes false events/races) + Obsidian graph. File badges:
  Clean / Modified-by-Aider / Generated / Pending-commit / Locked-by-workflow /
  Failed-validation.
- **Center:** tabbed — Agent Plan · Aider Diff · OpenHands TTY · Test Results.
- **Right:** the actionable knowledge graph (Memgraph data; clicking a node opens
  the file, asks an agent about it, shows callers/callees, or creates a task).
- **Bottom:** structured execution timeline (NOT raw reasoning dump):
  `[10:03:20] Aider edited 4 files → [10:03:45] OpenHands ran tests in build-184 …`
  Each event links to input state, tool, files, stdout/stderr, diff, rollback point.
- **Telemetry strip:** VRAM, RAM, CPU, disk I/O, tokens/sec, active containers.
  Telemetry is **not cosmetic — it controls scheduling**: VRAM > 90% → pause
  embedding jobs; tests running → block Aider on mounted files; context >
  threshold → force Graph-RAG compression.

---

## 10. Build Roadmap (build in this order — do not skip ahead)

- **Phase 1 — Reliable core:** Tauri shell · Gitea · Temporal+Postgres · Ollama
  Model Router · Aider worker · OpenHands worker · Obsidian writer · event
  timeline. Goal: a rock-solid **edit → test → commit → doc** loop. No graph yet.
- **Phase 2 — Graph intelligence:** Qdrant · Memgraph · Cognee ·
  Understand-Anything · graph UI · Context Pack builder.
- **Phase 3 — Multi-agent governance:** LangGraph team (Architect/Engineer/QA/
  Security/Memory-curator) · Loop Governor · human approval gates.
- **Phase 4 — Skill evolution:** Hermes candidate skills · validation · versioning
  · activation policy.
- **Phase 5 — Remote:** Hermes messaging gateway · pairing/allowlist · signed
  remote mission requests · mobile approval flows.

Start with Phase 1 reliability. A flawless edit-test-commit-doc loop with no graph
beats a fragile everything-at-once.

---

## 11. Airgap (designed, not assumed)

`network: none` default. Local mirrors for apt/pip/npm. Local Docker registry.
Local Ollama model registry. Signed artifact imports via a manual import station.
OpenHands containers: `network: none`, read-only root where possible, mounted
snapshot only, resource limits, **no host Docker socket, no SSH keys, no cloud
creds**.

---

## 12. Repo Layout

```
/keystoneos
  /apps/desktop        Tauri + React shell
  /control-plane       Rust: WebSocket state stream, lease manager, router
  /workflows           Temporal workflows + activities (Python)
    /activities        one file per activity (idempotent, compensatable)
  /workers             aider / openhands / cognee / understand-anything wrappers
  /policies            OPA-style capability policies (agents may NOT edit)
  /deploy              docker-compose.yml + service configs
  /obsidian-vault      Projects/ Architecture/ Bugs/ Decisions/ Runs/ Skills/
  /.skills             promoted skill packs (yaml)
  /.keystone           workflow state cache, mission ledger
  /docs                context-pack format, runbooks, ADRs
```

See `/deploy/docker-compose.yml` for the backplane and `/workflows/` for the
Temporal scaffolding to extend.
