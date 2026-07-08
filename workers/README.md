# /workers — tool wrappers

Per CLAUDE.md §1, the workers are **Python** (Aider, OpenHands, Cognee,
Understand-Anything are Python-native).

To keep **one** implementation and avoid two competing copies of the same tool
glue, the thin tool clients live in [`../workflows/lib/clients.py`](../workflows/lib/clients.py)
(each touches exactly one external system) and the worker process that registers
them with Temporal is [`../workflows/worker.py`](../workflows/worker.py).

| Tool | Lane (CLAUDE.md) | Wrapper |
|---|---|---|
| Aider | edits only, into the `-edit` worktree, autonomous OFF | `clients` + `activities.code_edit` → `_run_aider` (integration point) |
| OpenHands | executes only, snapshot, `network: none`, logs out | `clients.openhands_run` |
| Ollama | inference behind the Model Router | `clients.ollama_*` |
| Gitea | source of truth / write barrier | `clients.gitea_*` |
| Qdrant / Memgraph | derived index, never truth | `clients.qdrant_*` (Memgraph via control-plane) |
| Understand-Anything | tree-sitter → Memgraph | `activities.graph_reindex` (integration point) |

Run the workers:

```bash
cd ../workflows
pip install -r requirements.txt
python worker.py
```
