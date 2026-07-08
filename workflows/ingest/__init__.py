"""Document → Knowledge-Graph ingestion for KeyStoneOS Graph-RAG (CLAUDE.md §6).

Two-stage "Knowledge Compilation" feeder for the structural tier:

    doc  --MinerU-->  clean text/blocks  --Hyper-Extract-->  entities +
    relations + HYPEREDGES (multi-way)  -->  Memgraph + Qdrant

Both external tools are heavy (MinerU: layout/OCR models; Hyper-Extract: an LLM).
Each stage has an adapter that uses the real tool when installed and a
deterministic **offline fallback** so the pipeline runs, and is testable, with
zero models and zero network (§11). The graph is an index, never truth (§2.3).
"""

from .extract import KnowledgeGraph, extract, extract_document  # noqa: F401
from .parse import parse_document  # noqa: F401
from .pipeline import ingest  # noqa: F401
