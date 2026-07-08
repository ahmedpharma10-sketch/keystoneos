"""Graph sinks — write a compiled KnowledgeGraph into KeyStoneOS's shared stores
(CLAUDE.md §6: Memgraph structural edges + Qdrant chunks). The graph is an index,
never truth (§2.3), so these are always re-derivable from the source document.

Cypher/points are produced as data here; the actual writes go through the same
clients the activities use. `to_cypher` also lets you inspect the graph offline.
"""

from __future__ import annotations

from typing import List

from .extract import KnowledgeGraph


def to_cypher(kg: KnowledgeGraph, doc_id: str) -> List[str]:
    """MERGE statements for Memgraph: entities, binary relations, and hyperedges
    reified as :Event nodes linked to their members (so many-way survives)."""
    stmts: List[str] = []
    for e in kg.entities:
        stmts.append(
            f"MERGE (n:Entity {{id: {e['id']!r}}}) "
            f"SET n.kind = {e['kind']!r}, n.text = {e['text']!r}, n.doc = {doc_id!r}"
        )
    for r in kg.relations:
        stmts.append(
            f"MATCH (a:Entity {{id: {r['src']!r}}}), (b:Entity {{id: {r['dst']!r}}}) "
            f"MERGE (a)-[:{r['kind']}]->(b)"
        )
    for h in kg.hyperedges:
        stmts.append(f"MERGE (h:Event {{id: {h['id']!r}}}) SET h.evidence = {h.get('evidence','')!r}")
        for mid in h["members"]:
            stmts.append(
                f"MATCH (h:Event {{id: {h['id']!r}}}), (m:Entity {{id: {mid!r}}}) "
                f"MERGE (h)-[:INVOLVES]->(m)"
            )
    return stmts


def to_qdrant_points(kg: KnowledgeGraph, doc_id: str) -> List[dict]:
    """One point per chunk; payload carries the doc + the entity ids it cites,
    so §6 vector retrieval can be filtered to a graph sub-set."""
    return [
        {
            "id": f"{doc_id}:{i}",
            "payload": {"doc": doc_id, "text": c["text"], "entities": c["entities"]},
        }
        for i, c in enumerate(kg.chunks)
    ]
