# KeyStoneOS — Build Package

This is a unified, Claude Code–ready build package, reconciled from three
independent architecture drafts. Conflicts between those drafts have been
**resolved** (not blended) — see `CLAUDE.md` §1 "Resolved conflicts".

## What to read first
1. **`CLAUDE.md`** — the authoritative spec. The One Rule, invariants, forbidden
   actions, the atomic mission, isolation model, Graph RAG, the repair loop, and
   the phased roadmap. **This file wins over any prompt.**
2. **`deploy/docker-compose.yml`** — the local air-gapped backplane (Temporal +
   Postgres, NATS, Gitea, Ollama, Qdrant, Memgraph, Cognee, OpenHands).
3. **`workflows/mission_workflow.py`** — the orchestration spine: the Saga +
   Loop Governor as runnable Temporal scaffolding.
4. **`workflows/activities/__init__.py`** — thin tool wrappers with role
   boundaries baked into the docstrings.

## Key decisions made for you
- **Memgraph** over Neo4j (in-memory, fast local traversal, Cypher-portable).
- **OpenClaw dropped**; **Hermes-Agent** is the single skills+messaging system.
- **Git worktrees** for isolation (cross-platform), not OverlayFS (Linux-only).
- **Temporal on Postgres** (it does not embed in SQLite).
- **Only the orchestrator commits.** Goose runs git; it never decides to.

## How to build
Follow the Phase 1→5 roadmap in `CLAUDE.md` §10. Build the reliable
edit→test→commit→doc loop **first**, with no graph. Do not scaffold all nine
modules at once.

## The invariant to never break
> Agents propose. Tools execute. Only the orchestrator commits.
> No module ever calls another module directly.
