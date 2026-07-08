"""The ingest pipeline: doc -> (MinerU) text -> (Hyper-Extract) knowledge graph
-> §6 stores. One call, each stage swappable, offline-safe.

    from ingest import ingest
    result = ingest("report.pdf")            # or a .txt/.md offline
    result["graph"]["stats"]                  # entities / relations / hyperedges
"""

from __future__ import annotations

import hashlib
import os
from typing import Callable, Optional

from .extract import extract, extract_document
from .parse import parse_document
from .sinks import to_cypher, to_qdrant_points


def _doc_id(path: str) -> str:
    return "doc:" + hashlib.sha256(os.path.abspath(path).encode()).hexdigest()[:10]


def ingest(path: str, llm: Optional[Callable[[str], str]] = None) -> dict:
    """Compile a document into a knowledge graph + store payloads.

    `llm` (optional) routes extraction through the Hyper-Extract LLM path;
    without it the deterministic offline extractor runs.
    """
    doc_id = _doc_id(path)
    text = parse_document(path)
    # LLM path chunks long documents (correct typing); heuristic is single-pass.
    kg = extract_document(text, llm) if llm is not None else extract(text)
    return {
        "doc_id": doc_id,
        "graph": kg.to_dict(),
        "cypher": to_cypher(kg, doc_id),
        "qdrant_points": to_qdrant_points(kg, doc_id),
    }


def ingest_text(text: str, doc_id: str = "doc:inline", llm=None) -> dict:
    """Same pipeline starting from raw text (skips the MinerU parse stage)."""
    kg = extract_document(text, llm) if llm is not None else extract(text)
    return {
        "doc_id": doc_id,
        "graph": kg.to_dict(),
        "cypher": to_cypher(kg, doc_id),
        "qdrant_points": to_qdrant_points(kg, doc_id),
    }
