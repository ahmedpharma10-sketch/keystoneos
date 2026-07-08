"""Unit tests for the doc -> knowledge-graph ingest pipeline (ingest/).

Exercises the offline heuristic Hyper-Extract path (no models, no network): a
short OSINT-style report should compile into entities, binary relations, and a
many-way EVENT hyperedge, plus valid Memgraph Cypher and Qdrant points.

Run:  python -m unittest tests.test_ingest
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ingest.extract import extract, extract_document, _parse_json  # noqa: E402
from ingest.pipeline import ingest_text  # noqa: E402
from ingest.sinks import to_cypher, to_qdrant_points  # noqa: E402

REPORT = (
    "On 2026-06-30 at 14:30 Ahmed Sami met a contact in Cairo. "
    "He used phone +20 100 555 1234 and email ahmed@example.com to move $5,000 "
    "from a laptop at IP 10.0.0.5. "
    "The weather was fine."  # a sentence with no entities -> no hyperedge
)


class TestExtract(unittest.TestCase):
    def setUp(self):
        self.kg = extract(REPORT)

    def test_finds_structured_entities(self):
        kinds = {e["kind"] for e in self.kg.entities}
        for k in ("EMAIL", "PHONE", "MONEY", "IP", "DATE", "TIME", "LOCATION"):
            self.assertIn(k, kinds, f"missing {k} in {kinds}")

    def test_person_detected(self):
        people = [e["text"] for e in self.kg.entities if e["kind"] == "PERSON"]
        self.assertTrue(any("Ahmed" in p for p in people), people)

    def test_builds_multiway_hyperedge(self):
        # The many-way relationship is the whole point of Hyper-Extract.
        self.assertTrue(self.kg.hyperedges)
        biggest = max(self.kg.hyperedges, key=lambda h: len(h["members"]))
        self.assertGreaterEqual(len(biggest["members"]), 4)
        self.assertEqual(biggest["kind"], "EVENT")

    def test_binary_projection_from_person(self):
        rels = {r["kind"] for r in self.kg.relations}
        # PERSON -> phone/email/money/location should project typed edges.
        self.assertTrue({"HAS_PHONE", "HAS_EMAIL", "MADE_TRANSACTION"} & rels, rels)

    def test_empty_sentence_makes_no_hyperedge(self):
        # "The weather was fine." has no entities -> not an event.
        self.assertTrue(all("weather" not in h["evidence"].lower() for h in self.kg.hyperedges))

    def test_markdown_heading_not_a_person(self):
        # A "# Incident Report" heading must not be mislabelled PERSON, but a real
        # name on a body line still is.
        kg = extract("# Incident Report — Case 4471\nOn 2026-06-30 Ahmed Sami paid $5.")
        people = [e["text"] for e in kg.entities if e["kind"] == "PERSON"]
        self.assertNotIn("Incident Report", people)
        self.assertTrue(any("Ahmed" in p for p in people), people)


class TestPipelineAndSinks(unittest.TestCase):
    def test_ingest_text_shape(self):
        res = ingest_text(REPORT, doc_id="doc:test")
        self.assertEqual(res["doc_id"], "doc:test")
        self.assertGreater(res["graph"]["stats"]["entities"], 5)
        self.assertTrue(res["cypher"])
        self.assertTrue(res["qdrant_points"])

    def test_cypher_is_wellformed(self):
        kg = extract(REPORT)
        stmts = to_cypher(kg, "doc:test")
        self.assertTrue(any(s.startswith("MERGE (n:Entity") for s in stmts))
        self.assertTrue(any(":Event" in s for s in stmts))  # hyperedge reified

    def test_qdrant_points_carry_entities(self):
        kg = extract(REPORT)
        pts = to_qdrant_points(kg, "doc:test")
        self.assertTrue(all("entities" in p["payload"] for p in pts))


class TestLLMPath(unittest.TestCase):
    """The Hyper-Extract LLM path (typed entities), driven by a fake model so the
    parse/dedup/chunk/merge logic is verified with no real model or network."""

    def test_parse_json_tolerates_fences_and_prose(self):
        self.assertEqual(_parse_json('```json\n{"a":1}\n```')["a"], 1)
        self.assertEqual(_parse_json('here you go:\n{"a":2} — done')["a"], 2)

    def test_llm_extract_keeps_types_and_dedups(self):
        fake = lambda _p: (
            '{"entities":['
            '{"id":"organization:aventa","kind":"ORGANIZATION","text":"Aventa"},'
            '{"id":"organization:aventa","kind":"ORGANIZATION","text":"Aventa"},'  # dup id
            '{"kind":"LOCATION","text":"Riyadh"}],'  # missing id -> generated
            '"relations":[{"src":"organization:aventa","dst":"location:riyadh","kind":"BASED_IN"}],'
            '"hyperedges":[]}'
        )
        kg = extract("Aventa is based in Riyadh.", llm=fake)
        self.assertEqual(sorted(e["kind"] for e in kg.entities), ["LOCATION", "ORGANIZATION"])
        self.assertEqual(len(kg.relations), 1)
        self.assertNotIn("PERSON", {e["kind"] for e in kg.entities})  # the whole point

    def test_extract_document_chunks_merges_namespaces(self):
        calls = {"n": 0}

        def fake(_p):
            calls["n"] += 1
            return ('{"entities":[{"id":"org:x","kind":"ORGANIZATION","text":"X"}],'
                    '"relations":[],'
                    '"hyperedges":[{"id":"event:0","kind":"EVENT","members":["org:x"],"evidence":"e"}]}')

        text = ("line of text\n" * 100) + "\n" + ("more text here\n" * 100)
        kg = extract_document(text, fake, chunk_chars=400)
        self.assertGreater(calls["n"], 1)                       # actually chunked
        self.assertEqual(len(kg.entities), 1)                   # deduped across chunks
        ids = [h["id"] for h in kg.hyperedges]
        self.assertEqual(len(set(ids)), len(ids))              # hyperedge ids unique
        self.assertTrue(all(i.startswith("c") for i in ids))  # namespaced per chunk

    def test_bad_chunk_is_skipped_not_fatal(self):
        def flaky(_p):
            flaky.i = getattr(flaky, "i", 0) + 1
            if flaky.i == 1:
                return "not json at all"          # first chunk fails
            return '{"entities":[{"id":"org:y","kind":"ORGANIZATION","text":"Y"}],"relations":[],"hyperedges":[]}'

        text = ("aaaa\n" * 100) + "\n" + ("bbbb\n" * 100)
        kg = extract_document(text, flaky, chunk_chars=300)
        self.assertTrue(any(e["id"] == "org:y" for e in kg.entities))  # survived the bad chunk


if __name__ == "__main__":
    unittest.main()
