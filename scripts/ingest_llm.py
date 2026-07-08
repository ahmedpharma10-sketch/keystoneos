#!/usr/bin/env python3
"""Ingest a text file into a knowledge graph via the LLM path (local gate).

Chunks the document, extracts a typed KG per chunk against the warehouse gate
(:4317/v1), merges, and writes JSON + Cypher. This is the "real" Hyper-Extract
path — proper entity typing (ORGANIZATION/REGULATION/METRIC/… not guessed PERSON).

    KEYSTONE_LLM_MODEL=ollama/qwen3:4b python3 scripts/ingest_llm.py <file.txt> out.json
"""

import json
import os
import sys
import time
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "workflows"))

from ingest.extract import extract_document  # noqa: E402
from ingest.sinks import to_cypher, to_qdrant_points  # noqa: E402
from lib.llm import make_extractor  # noqa: E402


def main():
    path = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    model = os.environ.get("KEYSTONE_LLM_MODEL", "role:general")
    chunk = int(os.environ.get("KEYSTONE_CHUNK", "6000"))
    text = open(path, encoding="utf-8", errors="ignore").read()

    print(f"model={model} chars={len(text)} chunk={chunk}", flush=True)
    t0 = time.time()

    def prog(i, n):
        print(f"  chunk {i}/{n}  ({time.time()-t0:.0f}s)", flush=True)

    kg = extract_document(text, make_extractor(model), chunk_chars=chunk, progress=prog)

    kinds = Counter(e["kind"] for e in kg.entities)
    print(f"\nDONE in {time.time()-t0:.0f}s")
    print(f"entities={len(kg.entities)} relations={len(kg.relations)} hyperedges={len(kg.hyperedges)}")
    print("by kind:", dict(kinds.most_common()))
    persons = [e["text"] for e in kg.entities if e["kind"] == "PERSON"]
    print("PERSON entities:", persons[:20])

    if out:
        result = {
            "doc_id": "doc:" + os.path.basename(path),
            "graph": kg.to_dict(),
            "cypher": to_cypher(kg, "doc:" + os.path.basename(path)),
            "qdrant_points": to_qdrant_points(kg, "doc:" + os.path.basename(path)),
        }
        json.dump(result, open(out, "w"), ensure_ascii=False, indent=2)
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
