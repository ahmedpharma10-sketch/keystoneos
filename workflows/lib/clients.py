"""Thin tool clients. Each client touches exactly ONE external system and does
exactly what its activity needs — no orchestration, no cross-tool calls
(CLAUDE.md §0, §1). Activities own sequencing; these own I/O.

Stdlib-only HTTP (urllib) so workers stay dependency-light; subprocess for git.
Network egress beyond the compose network is the policy engine's job to forbid,
not these clients' — they only ever talk to the internal services.
"""

from __future__ import annotations

import json
import subprocess
import urllib.request
from typing import Any, Dict, List

from . import config


def _post_json(url: str, payload: Dict[str, Any], timeout: int = 120) -> Dict[str, Any]:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (internal net only)
        body = resp.read().decode()
    return json.loads(body) if body else {}


# ---- Ollama (inference, behind the Model Router) ----------------------------
def ollama_generate(model: str, prompt: str, fmt: str | None = None) -> str:
    payload: Dict[str, Any] = {"model": model, "prompt": prompt, "stream": False}
    if fmt:
        payload["format"] = fmt
    return _post_json(f"{config.OLLAMA_URL}/api/generate", payload).get("response", "")


def ollama_ps() -> List[Dict[str, Any]]:
    """Loaded models + VRAM — feeds the Model Router's scheduling (§9)."""
    with urllib.request.urlopen(f"{config.OLLAMA_URL}/api/ps", timeout=10) as r:  # noqa: S310
        return json.loads(r.read().decode()).get("models", [])


def ollama_embed(text: str, model: str = "nomic-embed-text") -> List[float]:
    return _post_json(f"{config.OLLAMA_URL}/api/embeddings", {"model": model, "prompt": text}).get(
        "embedding", []
    )


# ---- Git / worktrees (§5). Goose may RUN git; it never DECIDES to commit. ----
def git(args: List[str], cwd: str) -> str:
    out = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def worktree_add(branch: str, path: str) -> str:
    return git(["worktree", "add", path, "-b", branch], cwd=config.MAIN_REPO)


def worktree_remove(path: str) -> str:
    return git(["worktree", "remove", "--force", path], cwd=config.MAIN_REPO)


def apply_patch(patch: str, cwd: str) -> None:
    subprocess.run(["git", "apply", "-"], cwd=cwd, input=patch, text=True, check=True)


# ---- OpenHands (sandbox; logs only; network:none task containers) -----------
def openhands_run(snapshot: str, command: str) -> Dict[str, Any]:
    """Run `command` against an immutable snapshot in an ephemeral container.
    Returns {passed, error, logs, artifacts}. Cannot mutate the canonical repo."""
    return _post_json(
        f"{config.OPENHANDS_URL}/run",
        {"snapshot": snapshot, "command": command, "network": "none"},
        timeout=600,
    )


# ---- Gitea (source of truth; the write barrier) ----------------------------
def gitea_commit(branch: str, message: str, cwd: str) -> str:
    git(["add", "-A"], cwd=cwd)
    git(["commit", "-m", message], cwd=cwd)
    git(["push", "origin", branch], cwd=cwd)
    return git(["rev-parse", "HEAD"], cwd=cwd)


def gitea_revert(commit: str, cwd: str) -> None:
    git(["revert", "--no-edit", commit], cwd=cwd)


# ---- Qdrant + Memgraph (derived index, never truth; §2.3) ------------------
def qdrant_upsert(collection: str, points: List[Dict[str, Any]]) -> Dict[str, Any]:
    return _post_json(f"{config.QDRANT_URL}/collections/{collection}/points", {"points": points})


def qdrant_search(collection: str, vector: List[float], limit: int = 12, ids: List[str] | None = None):
    body: Dict[str, Any] = {"vector": vector, "limit": limit, "with_payload": True}
    if ids:
        body["filter"] = {"must": [{"has_id": ids}]}
    return _post_json(f"{config.QDRANT_URL}/collections/{collection}/points/search", body).get(
        "result", []
    )
