"""Agent router — pick the best Agency lead for a mission request.

The backend counterpart of the UI router (apps/desktop/src/lib/router.ts). It
follows the semantic-router pattern: embed the request and each agent's profile
(via the local Ollama embedder, §6), then rank by cosine similarity. When no
embedder is supplied it falls back to a deterministic, field-weighted lexical
score — same weights as the UI — so routing works offline (§11) and is testable
with zero network.

    from lib.agent_router import route
    best = route("reject JWTs with alg=none", agents)[0]["agent"]
"""

from __future__ import annotations

import json
import math
import re
from typing import Callable, List, Mapping, Optional, Sequence

STOP = {
    "the", "a", "an", "to", "of", "in", "for", "and", "with", "on", "add", "fix",
    "make", "build", "create", "that", "this", "is", "it", "my", "our", "using",
    "into", "from", "help", "need", "want", "please", "app",
}
_WEIGHTS = {"name": 3.0, "vibe": 2.0, "description": 1.5, "division": 1.0}


def _tokens(s: str) -> List[str]:
    return [t for t in re.findall(r"[a-z0-9]+", s.lower()) if len(t) > 2 and t not in STOP]


def _profile(a: Mapping) -> str:
    return f"{a.get('name','')}. {a.get('vibe','')}. {a.get('description','')}. {a.get('division','')}"


def _cosine(u: Sequence[float], v: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(u, v))
    nu = math.sqrt(sum(x * x for x in u))
    nv = math.sqrt(sum(y * y for y in v))
    return dot / (nu * nv) if nu and nv else 0.0


def _lexical(query: str, agents: Sequence[Mapping]) -> List[dict]:
    qt = _tokens(query)
    out = []
    for a in agents:
        fields = {
            "name": a.get("name", "").lower(),
            "vibe": (a.get("vibe") or "").lower(),
            "description": (a.get("description") or "").lower(),
            "division": a.get("division", "").lower(),
        }
        score = 0.0
        matched = set()
        for t in qt:
            for field, w in _WEIGHTS.items():  # highest-weight field first
                if t in fields[field]:
                    score += w
                    matched.add(t)
                    break
        if score > 0:
            out.append({"agent": a, "score": score, "matched": sorted(matched)})
    return out


def route(
    query: str,
    agents: Sequence[Mapping],
    embed: Optional[Callable[[str], Sequence[float]]] = None,
    top_n: int = 5,
) -> List[dict]:
    """Rank agents for `query`. Cosine over embeddings if `embed` given, else
    the lexical fallback. Returns [{agent, score, norm, matched?}] best-first."""
    if embed is not None:
        qv = embed(query)
        scored = [{"agent": a, "score": _cosine(qv, embed(_profile(a)))} for a in agents]
        scored = [s for s in scored if s["score"] > 0]
    else:
        scored = _lexical(query, agents)

    scored.sort(key=lambda s: s["score"], reverse=True)
    scored = scored[:top_n]
    top = scored[0]["score"] if scored else 1.0
    for s in scored:
        s["norm"] = s["score"] / top if top else 0.0
    return scored


def load_agents(index_path: str) -> List[dict]:
    """Load the generated agency index (metadata only)."""
    return json.load(open(index_path))["agents"]
