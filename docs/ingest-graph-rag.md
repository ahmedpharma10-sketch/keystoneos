# Document → Knowledge-Graph ingest (Graph-RAG feeder, §6)

"Knowledge Compilation": turn unstructured documents into structured, machine-
readable intelligence for KeyStoneOS's structural tier (Memgraph) and semantic
tier (Qdrant). Two stages, each with a real tool and an offline fallback.

```
doc  --MinerU-->  clean text/Markdown  --Hyper-Extract-->  entities +
     relations + HYPEREDGES  -->  to_cypher (Memgraph) + to_qdrant_points (Qdrant)
```

## Stage 1 — MinerU (parse)   `ingest/parse.py`
[opendatalab/MinerU](https://github.com/opendatalab/MinerU) (73K★). Preserves
layout, tables, formulas; OCR for scans — so structure isn't destroyed before
chunking. `parse_document(path)`:
- `.txt/.md/.json` → read directly (offline, no models).
- `.pdf`/office/images → MinerU when installed (`pip install mineru`), else a
  clear error. The heavy import only happens on the MinerU path.

## Stage 2 — Hyper-Extract (compile)   `ingest/extract.py`
[yifanfeng97/Hyper-Extract](https://github.com/yifanfeng97/Hyper-Extract). The
point: real events are **many-way**, not binary. One fraud/OSINT event ties a
`person + phone + location + time + transaction + device` together — a single
**hyperedge**, not five separate person→x edges.

`extract(text, llm=None)`:
- with `llm` → the Hyper-Extract LLM path (JSON-schema extraction).
- without → a deterministic pattern extractor (EMAIL/URL/IP/IMEI/MONEY/DATE/
  TIME/PHONE/HANDLE by regex; PERSON/LOCATION/DEVICE by heuristic), grouping
  entities per sentence into `EVENT` hyperedges + typed binary projections
  (`HAS_PHONE`, `AT_LOCATION`, `AT_TIME`, `MADE_TRANSACTION`, `USES_DEVICE`, …).

### Heuristic vs LLM — pick by document type
The offline heuristic has no real NER; it guesses `PERSON` from Title-Case. On
**OSINT/incident text** (names in sentences, phones, emails, IPs) it works well.
On a **formatted business/strategy document** (headings everywhere) it mislabels
most headings as `PERSON` — use the **LLM path** there. The model assigns real
types: `ORGANIZATION, LOCATION, REGULATION, SYSTEM, PRODUCT, TECHNOLOGY, METRIC,
MONEY, DATE, ROLE, CONCEPT, PERSON`.

`extract_document(text, llm, chunk_chars)` chunks a long doc, extracts each
window, and merges (entities dedup by id; hyperedge ids namespaced per chunk; a
bad chunk is skipped, not fatal). Wire the model via the local gate:

```bash
# LLM path against the warehouse gate (:4317/v1), fully local/airgap (§11)
KEYSTONE_LLM_MODEL=ollama/qwen3:4b python3 scripts/ingest_llm.py report.txt out.json
```
`workflows/lib/llm.py` is the OpenAI-compatible client (`KEYSTONE_LLM_URL`,
`KEYSTONE_LLM_MODEL`). Local models are slow (~90s/chunk on CPU) but accurate.

## Sinks   `ingest/sinks.py`
- `to_cypher(kg, doc_id)` → Memgraph MERGEs. Hyperedges are **reified** as
  `:Event` nodes linked `INVOLVES` → members, so many-way survives a graph that
  only stores binary edges.
- `to_qdrant_points(kg, doc_id)` → one point per chunk, payload carries the
  entity ids it cites → §6 vector retrieval can be filtered to a graph sub-set.

## Run it

```bash
# Offline (no models): .txt / .md / .json
python3 scripts/ingest_doc.py report.md --json kg.json

# From code
from ingest import ingest
ingest("report.pdf")            # MinerU + Hyper-Extract when installed
```

Tested by `workflows/tests/test_ingest.py` (offline path, 8 tests). The graph is
an **index, never truth** (§2.3) — always re-derivable from the source document.
