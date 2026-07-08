# Context Pack format (CLAUDE.md §6)

The Context Pack is the **only** thing an agent sees before a model call. A local
model is never asked to "read the whole codebase" — retrieval is graph-first,
then vector-filtered, reranked, compressed, and **cited**.

## Pipeline (every task)

```
classify → extract entities → graph retrieval (Memgraph: the exact sub-graph,
e.g. 12 nodes not 12,000) → vector retrieval (Qdrant, FILTERED to those node IDs)
→ rerank (exact symbols > recent commits > graph-neighbors > semantic)
→ compress to a token budget → emit Context Pack with citations
```

## Shape

```json
{
  "mission": "ks-20260629-001",
  "task_class": "edit",
  "entities": ["verify_token", "src/auth/jwt.py"],
  "subgraph": {
    "nodes": [{ "id": "jwt.py", "kind": "file" }, { "id": "verify_token", "kind": "function" }],
    "edges": [{ "from": "test_auth.py", "to": "verify_token", "kind": "tests" }]
  },
  "chunks": [
    { "path": "src/auth/jwt.py", "symbol": "verify_token", "score": 0.94, "text": "…" }
  ],
  "capability_request": {
    "tool": "aider",
    "capability": "write_files",
    "scope": ["src/auth/jwt.py", "tests/test_auth.py"]
  },
  "citations": ["src/auth/jwt.py#verify_token", "commit:a1b2c3d", "node:jwt.py"],
  "token_budget": 4000
}
```

## Rules

- **Never** dump the repo or vault into a prompt (§3).
- Rerank order is fixed: exact symbols → recent commits → graph neighbors → semantic.
- Citations are mandatory: every claim traces to a file/node/commit.
- The pack carries the `capability_request`; the orchestrator mints the token,
  the policy engine validates it (§8) before Aider writes.

Builder: `workflows/activities/__init__.py::build_context_pack`.
