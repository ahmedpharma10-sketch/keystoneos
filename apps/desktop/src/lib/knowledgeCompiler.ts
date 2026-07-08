// In-browser Knowledge Compiler — the UI twin of workflows/ingest/extract.py.
// Same heuristic Hyper-Extract logic (entities + binary relations + many-way
// EVENT hyperedges), so a pasted report renders as a hypergraph with no backend.
// (Parallels router.ts ↔ agent_router.py — one behaviour, two runtimes.)

export type EntityKind =
  | "EMAIL" | "URL" | "IP" | "IMEI" | "MONEY" | "DATE" | "TIME"
  | "PHONE" | "HANDLE" | "PERSON" | "LOCATION" | "DEVICE";

export interface KEntity { id: string; kind: EntityKind; text: string; s: number; e: number; }
export interface KRelation { src: string; dst: string; kind: string; }
export interface KHyperedge { id: string; kind: "EVENT"; members: string[]; evidence: string; }
export interface KGraph { entities: KEntity[]; relations: KRelation[]; hyperedges: KHyperedge[]; }

const PATTERNS: [EntityKind, RegExp][] = [
  ["EMAIL", /[\w.+-]+@[\w-]+\.[\w.-]+/g],
  ["URL", /https?:\/\/[^\s)]+/g],
  ["IP", /\b\d{1,3}(?:\.\d{1,3}){3}\b/g],
  ["IMEI", /\bIMEI[:\s]*\d{15}\b/gi],
  ["MONEY", /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*\s?(?:USD|EUR|EGP|GBP|dollars?|euros?)\b)/gi],
  ["DATE", /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g],
  ["TIME", /\b\d{1,2}:\d{2}(?:\s?[AP]M)?\b/gi],
  ["PHONE", /\+?\d[\d\s().-]{7,}\d/g],
  ["HANDLE", /(?<!\w)@[A-Za-z0-9_]{2,}/g],
];

const GAZETTEER = ["cairo", "alexandria", "dubai", "london", "paris", "berlin", "new york", "riyadh", "istanbul", "amsterdam", "geneva", "singapore", "hong kong"];
const DEVICES = ["laptop", "iphone", "android", "macbook", "router", "usb", "sim"];
const PERSON = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;
const SENT = /[^.!?\n]+[.!?]?/g;

// Guard the capitalized-bigram heuristic from common non-person noise (mirrors
// workflows/ingest/extract.py). The LLM path wouldn't need this.
const NOT_PERSON = new Set(["incident report", "case summary", "executive summary", "table of contents"]);
const onHeading = (text: string, pos: number) =>
  text.slice(text.lastIndexOf("\n", pos - 1) + 1).trimStart().startsWith("#");

const REL: Record<string, string> = {
  PHONE: "HAS_PHONE", EMAIL: "HAS_EMAIL", HANDLE: "HAS_HANDLE", LOCATION: "AT_LOCATION",
  TIME: "AT_TIME", DATE: "ON_DATE", MONEY: "MADE_TRANSACTION", DEVICE: "USES_DEVICE",
  IP: "USED_IP", IMEI: "USES_DEVICE",
};

const slug = (kind: string, text: string) =>
  `${kind.toLowerCase()}:${text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

function findEntities(text: string): KEntity[] {
  const spans: { s: number; e: number; kind: EntityKind; text: string }[] = [];
  const overlaps = (s: number, e: number) => spans.some((x) => !(e <= x.s || s >= x.e));

  for (const [kind, pat] of PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text))) {
      const s = m.index, e = s + m[0].length;
      if (!overlaps(s, e)) spans.push({ s, e, kind, text: m[0].trim() });
    }
  }
  const lower = text.toLowerCase();
  const wordScan = (words: string[], kind: EntityKind) => {
    for (const w of words) {
      let i = lower.indexOf(w);
      while (i !== -1) {
        const s = i, e = i + w.length;
        const before = lower[s - 1] ?? " ", after = lower[e] ?? " ";
        if (!/\w/.test(before) && !/\w/.test(after) && !overlaps(s, e))
          spans.push({ s, e, kind, text: text.slice(s, e) });
        i = lower.indexOf(w, i + 1);
      }
    }
  };
  wordScan(GAZETTEER, "LOCATION");
  wordScan(DEVICES, "DEVICE");
  PERSON.lastIndex = 0;
  let pm: RegExpExecArray | null;
  while ((pm = PERSON.exec(text))) {
    const s = pm.index, e = s + pm[1].length;
    if (NOT_PERSON.has(pm[1].toLowerCase()) || onHeading(text, s)) continue;
    if (!overlaps(s, e)) spans.push({ s, e, kind: "PERSON", text: pm[1] });
  }

  spans.sort((a, b) => a.s - b.s);
  const seen = new Set<string>();
  const out: KEntity[] = [];
  for (const sp of spans) {
    const id = slug(sp.kind, sp.text);
    if (!seen.has(id)) { seen.add(id); out.push({ id, kind: sp.kind, text: sp.text, s: sp.s, e: sp.e }); }
  }
  return out;
}

export function compile(text: string): KGraph {
  const ents = findEntities(text);
  const relations: KRelation[] = [];
  const hyperedges: KHyperedge[] = [];
  let idx = 0;
  let sm: RegExpExecArray | null;
  SENT.lastIndex = 0;
  while ((sm = SENT.exec(text))) {
    const s0 = sm.index, s1 = s0 + sm[0].length;
    const members = ents.filter((e) => e.s >= s0 && e.s < s1);
    if (members.length < 2) continue;
    const kinds = new Set(members.map((m) => m.kind));
    if (kinds.size < 2) continue;
    const hid = `event:${idx++}`;
    hyperedges.push({ id: hid, kind: "EVENT", members: members.map((m) => m.id), evidence: sm[0].trim() });
    const actor = members.find((m) => m.kind === "PERSON") ?? members[0];
    for (const m of members) {
      if (m.id === actor.id) continue;
      relations.push({ src: actor.id, dst: m.id, kind: REL[m.kind] ?? "RELATED_TO" });
    }
  }
  return { entities: ents, relations, hyperedges };
}

// --- Export (mirrors workflows/ingest/sinks.py) -----------------------------
const q = (s: unknown) => `'${String(s).replace(/'/g, "\\'")}'`;

/** Memgraph MERGEs. Hyperedges reified as :Event nodes → INVOLVES members. */
export function toCypher(kg: KGraph, docId = "doc:compiled"): string {
  const out: string[] = [];
  for (const e of kg.entities)
    out.push(`MERGE (n:Entity {id: ${q(e.id)}}) SET n.kind = ${q(e.kind)}, n.text = ${q(e.text)}, n.doc = ${q(docId)}`);
  for (const r of kg.relations)
    out.push(`MATCH (a:Entity {id: ${q(r.src)}}), (b:Entity {id: ${q(r.dst)}}) MERGE (a)-[:${r.kind}]->(b)`);
  for (const h of kg.hyperedges) {
    out.push(`MERGE (h:Event {id: ${q(h.id)}}) SET h.evidence = ${q(h.evidence)}`);
    for (const m of h.members)
      out.push(`MATCH (h:Event {id: ${q(h.id)}}), (m:Entity {id: ${q(m)}}) MERGE (h)-[:INVOLVES]->(m)`);
  }
  return out.join("\n");
}

export function toJSON(kg: KGraph): string {
  const clean = {
    entities: kg.entities.map(({ id, kind, text }) => ({ id, kind, text })),
    relations: kg.relations,
    hyperedges: kg.hyperedges,
    stats: { entities: kg.entities.length, relations: kg.relations.length, hyperedges: kg.hyperedges.length },
  };
  return JSON.stringify(clean, null, 2);
}

export const SAMPLE_REPORT =
  "# Incident Report — Case 4471\n\n" +
  "On 2026-06-28 at 21:05 Ahmed Sami transferred $12,500 from a laptop " +
  "(IP 192.168.100.27) to an account linked to Omar Khaled in Dubai. " +
  "He used phone +20 100 555 1234 and the handle @redsuitcase, email " +
  "ahmed@example.com. A second transfer of €4,000 occurred at 23:40 from London.";
