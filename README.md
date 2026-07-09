<div align="center">

# 🗝️ KeyStoneOS

### A local, air-gapped **Visual Developer & Intelligence Workspace**

**Governed multi-agent automation • local LLM compute • local Git • an interactive knowledge graph — with zero cloud dependencies and full data sovereignty.**

[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)
![Air-gapped](https://img.shields.io/badge/network-airgapped%20by%20default-0ea5e9)
![Tests](https://img.shields.io/badge/backend%20tests-35%20passing-3fb950)
![Stack](https://img.shields.io/badge/Tauri%20%2B%20React-Rust%20%2B%20Python-7c5cff)
![Local LLM](https://img.shields.io/badge/LLM-Ollama%20(local)-f97316)

*Give AI agents real work — and keep every action scoped, isolated, logged, and reversible.*

</div>

---

## Why KeyStoneOS?

Most "AI dev agent" tools let one model do everything, on your whole machine, over the cloud. KeyStoneOS takes the opposite stance: a **single desktop window** where specialized agents propose changes, sandboxed tools execute them, and **only the orchestrator commits** — entirely on your own hardware, offline by default.

> **The One Rule:** *Agents propose. Tools execute. Only the orchestrator commits.*
> No module ever calls another module directly.

Built for a single high-end workstation (Threadripper + RTX 5090, or Mac Studio), it's ideal for **privacy-critical, regulated, or offline** engineering and intelligence work.

## ✨ Highlights

| Feature | What it does |
|---|---|
| 🛡️ **Governed mission saga** | Every request runs as `lease → plan → edit → sandbox-test → commit → doc` — recoverable, replayable, and compensatable (a Temporal Saga). |
| 🔁 **Self-correcting repair loop** | On test failure a debugger sub-agent reads the *failed log* and retries — bounded to 3 attempts, with a circuit breaker that escalates a genuinely-stuck run to human review. |
| 🔐 **Capability-token policy engine** | Every tool action carries a scoped, expiring capability. Forbidden paths (secrets, policy files), out-of-scope edits, and network-in-airgap are refused *before* they run. |
| 🧑‍💼 **The Agency — 218 specialist agents** | A browsable, searchable roster across 16 divisions (engineering, security, design, marketing…). A **semantic router** auto-picks the best lead agent for any task. |
| 🧠 **Knowledge Compiler (Graph-RAG)** | Turn any document into a typed **knowledge graph / hypergraph** — entities, relations, and many-way events — export to **Memgraph Cypher** or JSON. Offline heuristic *or* local-LLM extraction. |
| 🖥️ **Single-window UI** | Git tree + Obsidian graph · tabbed Plan/Diff/Sandbox/Tests · live knowledge graph · execution timeline · a telemetry strip that actually gates scheduling (VRAM > 90% → pause embeddings). |
| ✈️ **Airgap by design** | `network: none` by default, local model registry, no cloud creds — enforced, not promised. |

## 🏛️ Architecture — the Atomic Mission

```
Mission ks-YYYYMMDD-NNN                          (one Temporal Saga per branch)

 1. acquire_workspace_lease      ┐
 2. create_worktree (branch)     │  isolate:  Aider edits a copy, OpenHands
 3. agent_plan       (LangGraph) │            tests a snapshot — editing a file
 4. build_context_pack (Graph-RAG)            while it compiles is impossible
 5. code_edit        (Aider)     ┘
 6. sandbox_run      (OpenHands, network:none) ── fail ─► debugger ─► retry (≤3)
 7. qa_review                                            │
 8. git_commit       (Gitea)     ◄── only the orchestrator commits ──┘
 9. graph_reindex    (Memgraph + Qdrant)
10. obsidian_sync    (human-readable vault)
11. skill_candidate  (green-only, gated promotion)
12. release_lease
```

**Decided stack (no substitutions):** Tauri + React shell · Rust control-plane · Python workers · Temporal (on Postgres) · Gitea · Ollama + model router · Memgraph · Qdrant · Cognee · OpenHands. See [`CLAUDE.md`](CLAUDE.md) — the authoritative spec.

## 🚀 Quick start

**The desktop UI (works standalone, no backend needed):**

```bash
cd apps/desktop
npm install
npm run dev            # → http://localhost:1421
```

Then: pick a mission → **▶ Run** to watch the governed saga animate · **⊞ Agency** to browse/route 218 agents · **⚛ Compile** to turn text into a knowledge graph.

**Backend governance core (Python, no services required):**

```bash
cd workflows && python3 -m unittest tests.test_core tests.test_router tests.test_ingest   # 35 tests
```

**Document → knowledge graph (offline, or via a local LLM):**

```bash
python3 scripts/ingest_doc.py report.md --json graph.json                     # offline heuristic
KEYSTONE_LLM_MODEL=ollama/qwen3:4b python3 scripts/ingest_llm.py report.txt out.json   # local LLM typing
```

**Full autonomous system** (needs Docker + Rust + Ollama on a capable machine):

```bash
cd deploy && docker compose up -d          # Temporal, Gitea, Ollama, Qdrant, Memgraph, OpenHands…
cd ../workflows && pip install -r requirements.txt && python worker.py
cd ../control-plane && cargo run            # WebSocket state stream on :8080
cd ../apps/desktop && VITE_KEYSTONE_WS=ws://localhost:8080/stream npm run tauri dev
```

## 🗺️ Roadmap

- **Phase 1 — Reliable core:** Tauri shell · Gitea · Temporal · Ollama router · Aider + OpenHands workers · event timeline.
- **Phase 2 — Graph intelligence:** Qdrant · Memgraph · Cognee · Context-Pack builder.
- **Phase 3 — Multi-agent governance:** LangGraph team · Loop Governor · human approval gates.
- **Phase 4 — Skill evolution:** gated candidate-skill promotion.
- **Phase 5 — Remote:** signed remote mission requests · mobile approval.

## 📦 Project status (honest)

The **desktop UI**, the **governance core** (lease/policy/fingerprint — 35 tests), and the **Graph-RAG ingest** (heuristic + local-LLM path) are built and verified. The Rust control-plane, the Docker backplane, and the Aider/OpenHands integrations are real, spec-faithful code that need their toolchains (Docker/Rust/GPU) to run — bring your own workstation. See [`PROGRESS.md`](PROGRESS.md).

## 📄 License & attribution

MIT — see [LICENSE](LICENSE). KeyStoneOS bundles the agent roster from
[**msitarzewski/agency-agents**](https://github.com/msitarzewski/agency-agents) (MIT); see [NOTICE](NOTICE).

<div align="center">
<sub>Keywords: air-gapped AI · local-first autonomous coding agent · self-hosted AI dev workspace · multi-agent orchestration · local LLM · Ollama · knowledge graph · hypergraph · Graph-RAG · Tauri · Rust · Temporal · data sovereignty · offline AI</sub>
</div>
