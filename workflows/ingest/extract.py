"""Hyper-Extract stage: text -> entities + relations + HYPEREDGES.

Mirrors the value of yifanfeng97/Hyper-Extract: real-world events (esp. in OSINT
/ fraud / forensics) are not person->place binary edges — a single event ties a
person + phone + location + time + transaction + device together. A *hyperedge*
represents that many-way relationship in one object; binary relations are also
emitted for graph stores that only take edges.

`extract(text, llm=...)` uses an LLM extractor when given one (the Hyper-Extract
path); otherwise a deterministic pattern extractor runs — good enough to compile
structured, spatio-temporal entities offline and fully unit-testable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

# Entity kinds we compile. Structured kinds are matched by pattern; PERSON /
# ORG / LOCATION are heuristic. Order = match priority (structured first).
PATTERNS = [
    ("EMAIL", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")),
    ("URL", re.compile(r"https?://[^\s)]+")),
    ("IP", re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")),
    ("IMEI", re.compile(r"\bIMEI[:\s]*([0-9]{15})\b", re.I)),
    ("MONEY", re.compile(r"(?:[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*\s?(?:USD|EUR|EGP|GBP|dollars?|euros?)\b)", re.I)),
    # DATE/TIME before PHONE: the loose phone pattern would otherwise swallow
    # "2026-06-30" (digits + dashes) and starve DATE.
    ("DATE", re.compile(r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4})\b")),
    ("TIME", re.compile(r"\b\d{1,2}:\d{2}(?:\s?[AP]M)?\b", re.I)),
    ("PHONE", re.compile(r"\+?\d[\d\s().-]{7,}\d")),
    ("HANDLE", re.compile(r"(?<!\w)@[A-Za-z0-9_]{2,}")),
]

# A tiny gazetteer keeps LOCATION deterministic for the offline path.
GAZETTEER = {
    "cairo", "alexandria", "dubai", "london", "paris", "berlin", "new york",
    "riyadh", "istanbul", "amsterdam", "geneva", "singapore", "hong kong",
}
DEVICE_WORDS = {"laptop", "iphone", "android", "macbook", "router", "usb", "sim"}

_PERSON = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b")
_SENT = re.compile(r"[^.!?\n]+[.!?]?")

# Common non-person titles that the capitalized-bigram heuristic would otherwise
# mislabel as PERSON. (The LLM extraction path does not need this list.)
_NOT_PERSON = {"incident report", "case summary", "executive summary", "table of contents"}


def _on_heading(text: str, pos: int) -> bool:
    """True if `pos` sits on a Markdown heading line (starts with '#')."""
    start = text.rfind("\n", 0, pos) + 1
    return text[start:].lstrip()[:1] == "#"


@dataclass
class KnowledgeGraph:
    entities: List[dict] = field(default_factory=list)     # {id, kind, text}
    relations: List[dict] = field(default_factory=list)    # {src, dst, kind}
    hyperedges: List[dict] = field(default_factory=list)   # {id, kind, members[], evidence}
    chunks: List[dict] = field(default_factory=list)       # {text, entities[]}

    def to_dict(self) -> dict:
        return {
            "entities": self.entities,
            "relations": self.relations,
            "hyperedges": self.hyperedges,
            "chunks": self.chunks,
            "stats": {
                "entities": len(self.entities),
                "relations": len(self.relations),
                "hyperedges": len(self.hyperedges),
            },
        }


# Which relation a PERSON has to another entity kind (spatio-temporal + fraud).
_REL = {
    "PHONE": "HAS_PHONE", "EMAIL": "HAS_EMAIL", "HANDLE": "HAS_HANDLE",
    "LOCATION": "AT_LOCATION", "TIME": "AT_TIME", "DATE": "ON_DATE",
    "MONEY": "MADE_TRANSACTION", "DEVICE": "USES_DEVICE", "IP": "USED_IP",
    "IMEI": "USES_DEVICE", "ORG": "AFFILIATED_WITH",
}


def _slug(kind: str, text: str) -> str:
    return f"{kind.lower()}:{re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')}"


def _find_entities(text: str) -> List[dict]:
    spans: List[tuple] = []  # (start, end, kind, text)

    def overlaps(s: int, e: int) -> bool:
        return any(not (e <= x or s >= y) for x, y, *_ in spans)

    for kind, pat in PATTERNS:
        for m in pat.finditer(text):
            s, e = m.span()
            if not overlaps(s, e):
                spans.append((s, e, kind, m.group(0).strip()))

    lower = text.lower()
    for loc in GAZETTEER:
        for m in re.finditer(re.escape(loc), lower):
            s, e = m.span()
            if not overlaps(s, e):
                spans.append((s, e, "LOCATION", text[s:e]))
    for dev in DEVICE_WORDS:
        for m in re.finditer(r"\b" + re.escape(dev) + r"\b", lower):
            s, e = m.span()
            if not overlaps(s, e):
                spans.append((s, e, "DEVICE", text[s:e]))
    for m in _PERSON.finditer(text):
        s, e = m.span()
        # Skip headings and known non-person titles (heuristic noise guard).
        if m.group(1).lower() in _NOT_PERSON or _on_heading(text, s):
            continue
        if not overlaps(s, e):
            spans.append((s, e, "PERSON", m.group(1)))

    spans.sort()
    ents, seen = [], set()
    for s, e, kind, t in spans:
        eid = _slug(kind, t)
        if eid not in seen:
            seen.add(eid)
            ents.append({"id": eid, "kind": kind, "text": t, "_s": s, "_e": e})
    return ents


def _heuristic_extract(text: str) -> KnowledgeGraph:
    kg = KnowledgeGraph()
    all_ents = _find_entities(text)
    kg.entities = [{"id": e["id"], "kind": e["kind"], "text": e["text"]} for e in all_ents]

    # Group entities per sentence; a sentence with >= 2 distinct kinds is an
    # EVENT hyperedge (the many-way relationship).
    pos = 0
    for sm in _SENT.finditer(text):
        sent = sm.group(0).strip()
        s0, s1 = sm.span()
        members = [e for e in all_ents if s0 <= e["_s"] < s1]
        if len(members) < 2:
            if members:
                kg.chunks.append({"text": sent, "entities": [m["id"] for m in members]})
            continue
        kinds = {m["kind"] for m in members}
        if len(kinds) >= 2:
            hid = f"event:{pos}"
            pos += 1
            kg.hyperedges.append({
                "id": hid, "kind": "EVENT",
                "members": [m["id"] for m in members],
                "evidence": sent,
            })
            # Binary projection: PERSON (or first member) -> each other member.
            actor = next((m for m in members if m["kind"] == "PERSON"), members[0])
            for m in members:
                if m["id"] == actor["id"]:
                    continue
                kg.relations.append({
                    "src": actor["id"], "dst": m["id"],
                    "kind": _REL.get(m["kind"], "RELATED_TO"),
                })
        kg.chunks.append({"text": sent, "entities": [m["id"] for m in members]})
    return kg


def extract(text: str, llm: Optional[Callable[[str], str]] = None) -> KnowledgeGraph:
    """Compile `text` into a knowledge graph. With `llm`, use the Hyper-Extract
    LLM path (JSON-schema extraction); otherwise the offline heuristic."""
    if llm is not None:
        return _llm_extract(text, llm)
    return _heuristic_extract(text)


# Real, well-typed entity kinds — the LLM assigns these instead of guessing
# PERSON from capitalization (the offline heuristic's weakness on formatted docs).
LLM_KINDS = (
    "PERSON, ORGANIZATION, LOCATION, REGULATION, SYSTEM, PRODUCT, TECHNOLOGY, "
    "METRIC, MONEY, DATE, ROLE, CONCEPT"
)

_EXTRACT_PROMPT = (
    "You are an information-extraction engine. From the TEXT below, extract a knowledge graph as STRICT JSON.\n"
    f"Entity kinds — choose the single best fit: {LLM_KINDS}.\n"
    "Rules: extract only SALIENT real entities; do NOT emit section headings, boilerplate, or generic phrases; "
    "PERSON is ONLY an actual human name; countries/cities are LOCATION; laws/standards are REGULATION; "
    "companies/authorities are ORGANIZATION.\n"
    'Return ONLY JSON: {"entities":[{"id":"<kind_lower>:<slug>","kind":"KIND","text":"..."}],'
    '"relations":[{"src":"id","dst":"id","kind":"REL"}],'
    '"hyperedges":[{"id":"event:0","kind":"EVENT","members":["id","id"],"evidence":"sentence"}]}\n\nTEXT:\n{TEXT}'
)


def _parse_json(raw: str) -> dict:
    """Tolerant JSON parse: handles code fences and leading/trailing prose."""
    import json

    s = raw.strip()
    if s.startswith("```"):
        s = s.strip("`")
        s = s[s.find("{"):]
    try:
        return json.loads(s)
    except Exception:
        a, b = s.find("{"), s.rfind("}")
        if a != -1 and b != -1:
            return json.loads(s[a:b + 1])
        raise


def _llm_extract(text: str, llm: Callable[[str], str]) -> KnowledgeGraph:
    """Hyper-Extract path: prompt the model for a typed KG in JSON, then validate."""
    data = _parse_json(llm(_EXTRACT_PROMPT.replace("{TEXT}", text)))
    ents, seen = [], set()
    for e in data.get("entities", []):
        kind = str(e.get("kind", "CONCEPT")).upper()  # normalize casing (SYSTEM == system)
        eid = e.get("id") or _slug(kind, e.get("text", ""))
        if e.get("text") and eid not in seen:
            seen.add(eid)
            ents.append({"id": eid, "kind": kind, "text": e["text"]})
    return KnowledgeGraph(
        entities=ents,
        relations=[r for r in data.get("relations", []) if r.get("src") and r.get("dst")],
        hyperedges=[h for h in data.get("hyperedges", []) if h.get("members")],
        chunks=data.get("chunks", []),
    )


def _chunks(text: str, size: int):
    """Split on paragraph boundaries into ~size-char windows."""
    paras, buf, out = text.split("\n"), "", []
    for p in paras:
        if len(buf) + len(p) > size and buf:
            out.append(buf)
            buf = ""
        buf += p + "\n"
    if buf.strip():
        out.append(buf)
    return out


def extract_document(text: str, llm: Callable[[str], str], chunk_chars: int = 6000,
                     progress: Callable[[int, int], None] | None = None) -> KnowledgeGraph:
    """Chunk a large document, LLM-extract each window, merge + dedup.

    Entities dedup by id; hyperedge ids are namespaced per chunk so they don't
    collide. This is the real path for long reports (the offline heuristic can't
    type them correctly)."""
    merged = KnowledgeGraph()
    seen = set()
    chunks = _chunks(text, chunk_chars)
    for i, ch in enumerate(chunks):
        if progress:
            progress(i + 1, len(chunks))
        try:
            kg = _llm_extract(ch, llm)
        except Exception:
            continue  # a bad chunk shouldn't sink the whole document
        for e in kg.entities:
            if e["id"] not in seen:
                seen.add(e["id"])
                merged.entities.append(e)
        merged.relations.extend(kg.relations)
        for h in kg.hyperedges:
            h["id"] = f"c{i}:{h.get('id', 'event')}"
            merged.hyperedges.append(h)
    return merged
