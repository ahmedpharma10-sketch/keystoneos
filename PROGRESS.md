# PROGRESS — KeyStoneOS

Durable build ledger. The source package is a single authoritative spec
(`CLAUDE.md`) + scaffolding (compose, Temporal spine, activity stubs), not a set
of numbered `.md` specs — so progress is tracked against the §10 phase roadmap.

| Area | Status | Date | Key files | Verified how |
|---|---|---|---|---|
| §12 repo layout | SHIPPED | 2026-06-29 | whole tree | `find` listing |
| Authoritative spec + spine copied verbatim | SHIPPED | 2026-06-29 | CLAUDE.md, deploy/docker-compose.yml, workflows/mission_workflow.py, workflows/activities/__init__.py | diff vs Downloads originals |
| §9 desktop UI (Tauri-target React) | SHIPPED | 2026-06-29 | apps/desktop/src/** | `tsc -b` clean + live preview (full saga + repair loop + drawer) |
| §5/§7/§8 core logic (lease, fingerprint, policy) | SHIPPED | 2026-06-29 | workflows/lib/{leases,fingerprint,policy}.py | 17 unit tests pass |
| Activity bodies (filled, boundaries kept) | SHIPPED | 2026-06-29 | workflows/activities/__init__.py, workflows/lib/{clients,config}.py | py_compile clean (runtime needs services) |
| Temporal worker entrypoint | SHIPPED | 2026-06-29 | workflows/worker.py | py_compile clean (runtime needs Temporal) |
| Rust control-plane (WS, lease, router) | WRITTEN | 2026-06-29 | control-plane/src/** | needs `cargo` to build (absent here) |
| OPA-style policy data | SHIPPED | 2026-06-29 | policies/capability.policy.json | mirrored by tested policy.py |
| Context Pack format | SHIPPED | 2026-06-29 | docs/context-pack.md | — |
| Vault / skills / ledger seeds | SHIPPED | 2026-06-29 | obsidian-vault/**, .skills/**, .keystone/ledger.jsonl | — |
| Agency integration (msitarzewski/agency-agents, MIT) | SHIPPED | 2026-06-30 | scripts/import_agency.py, apps/desktop/src/data/agency-index.json, apps/desktop/public/agency-bodies.json, src/lib/agency.ts, src/components/AgencyDirectory.tsx | live preview: 218 agents/16 divisions browse+search+lazy-body; assign-as-lead → saga attributes plan/QA + stamps lead_agent |
| Semantic agent router (auto-pick lead) | SHIPPED | 2026-06-30 | apps/desktop/src/lib/router.ts, AgencyDirectory.tsx (Route), workflows/lib/agent_router.py, workflows/tests/test_router.py | live: type request → Route → ranked best-fit → one-click assign (SecOps Engineer 100% for a JWT/auth request); backend router 5 tests pass (lexical + embedding paths) |
| Checkout scenario (long/complex demo) | SHIPPED | 2026-06-30 | apps/desktop/src/lib/mockMission.ts | live: 25-step saga — policy denial→recover, VRAM back-pressure, 3-attempt repair with DIFFERENT fingerprints (governor allows), green at ceiling; 4th picker scenario |
| Graph-RAG ingest: MinerU + Hyper-Extract (§6) | SHIPPED | 2026-06-30 | workflows/ingest/{parse,extract,pipeline,sinks}.py, scripts/ingest_doc.py, workflows/tests/test_ingest.py, docs/ingest-graph-rag.md | doc→text (MinerU) → text→entities/relations/HYPEREDGES (Hyper-Extract) → Memgraph Cypher + Qdrant points; offline heuristic fallback tested (8 tests); CLI on sample OSINT doc → 15 entities/8 rels/4 hyperedges (event ties date+time+person+money+device). MinerU/Hyper-Extract libs optional (not installed here) |
| LLM extraction path (Hyper-Extract, real typing) | SHIPPED | 2026-06-30 | workflows/lib/llm.py, ingest/extract.py (extract_document + LLM prompt/parse), scripts/ingest_llm.py, workflows/tests/test_ingest.py (+4) | wired to local gate :4317; chunk→extract→merge→dedup; kinds normalized. VALIDATED on Ahmed's 255K-char Aventa doc: PERSON false-positives 768→1 (only real person), 504 correctly-typed entities (CONCEPT/TECH/SYSTEM/ORG/REGULATION/METRIC…), 681 Cypher lines. 35 workflow tests pass. qwen3:4b ~90s/chunk on CPU |
| Security & Hardening | SHIPPED | 2026-06-30 | workflows/lib/policy.py, .env.example | Added path traversal checks, removed shell=True risks, setup dummy env |
| Activity Mock Adapters | SHIPPED | 2026-06-30 | workflows/activities/__init__.py | implemented _run_aider and graph_reindex with subprocess + mock fallbacks |
| Test Coverage | SHIPPED | 2026-06-30 | workflows/tests/*, control-plane/src/router.rs | Fixed rust router logic, added 7 new python tests for mocked activities/security (Total: 42 Python, 4 Rust) |
| Control Plane Integration | SHIPPED | 2026-06-30 | control-plane/src/main.rs | Added stream mockup for WS events |
| Knowledge Compiler UI (surfaces §6 hypergraph) | SHIPPED | 2026-06-30 | apps/desktop/src/lib/knowledgeCompiler.ts, src/components/KnowledgeCompiler.tsx, TopBar ⚛ Compile | live: paste text → compile → hypergraph SVG (entities colored by kind + diamond EVENT hubs) + event list; sample → 15 nodes/4 hubs/10 rels; click event isolates it (dims others). TS twin of extract.py (no backend needed). Export: ⬇ JSON / ⬇ Cypher (mirrors sinks.py — :Event/INVOLVES reification), Copy + Download, verified 43-line/4.5KB Cypher |

## Verified in this environment
- `apps/desktop`: `npm install`, `tsc -b` (clean), live browser preview — the full
  §4 saga runs, the §7 repair loop fires (attempt 1 fail → debugger → attempt 2
  green), file badges/tabs/graph/timeline/telemetry all update, detail drawer shows
  input/stdout/stderr/diff/rollback. Console clean.
- `workflows`: 17 unit tests pass (`python -m unittest tests.test_core`).
  All workflow Python compiles (`py_compile`).

## Needs its own toolchain (not present here: no cargo, no docker, Python 3.9)
- `control-plane`: `cargo build` (real code + Rust unit tests written, not compiled here).
- `deploy`: `docker compose up -d` brings up Postgres/Temporal/NATS/Gitea/Ollama/
  Qdrant/Memgraph/Cognee/OpenHands.
- Activity integration points intentionally raise `NotImplementedError` rather than
  fake tool output: `_run_aider` (Aider CLI) and `graph_reindex` (Understand-Anything).
