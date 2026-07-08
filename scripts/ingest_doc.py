#!/usr/bin/env python3
"""Ingest a document into a KeyStoneOS knowledge graph (CLAUDE.md §6).

    python3 scripts/ingest_doc.py <file> [--json out.json]

.txt/.md/.json run fully offline (heuristic Hyper-Extract). PDFs/scans/office
need MinerU installed (pip install mineru). Prints the entity/relation/hyperedge
counts and a sample event hyperedge.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "workflows"))

from ingest import ingest  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    result = ingest(path)
    g = result["graph"]
    print(f"doc {result['doc_id']}")
    print(f"  entities:   {g['stats']['entities']}")
    print(f"  relations:  {g['stats']['relations']}")
    print(f"  hyperedges: {g['stats']['hyperedges']}")
    if g["hyperedges"]:
        h = g["hyperedges"][0]
        print(f"  sample event: {len(h['members'])} entities — {h['evidence'][:70]}")
    if "--json" in sys.argv:
        out = sys.argv[sys.argv.index("--json") + 1]
        json.dump(result, open(out, "w"), ensure_ascii=False, indent=2)
        print(f"  wrote {out}")


if __name__ == "__main__":
    main()
