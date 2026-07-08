import { useMemo, useState } from "react";
import { compile, toCypher, toJSON, SAMPLE_REPORT, type EntityKind, type KGraph } from "../lib/knowledgeCompiler";

function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoking synchronously can cancel the download in some browsers; defer it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Knowledge Compiler — paste a document, see it compiled into entities + many-way
// EVENT hyperedges (Hyper-Extract, §6). Overlay so the §9 workbench stays intact.
const KIND_COLOR: Record<EntityKind, string> = {
  PERSON: "#4ea1ff", EMAIL: "#2dd4bf", PHONE: "#3fb950",
  HANDLE: "#2dd4bf", LOCATION: "#d9a23b", TIME: "#f0a0ff", DATE: "#f0a0ff",
  MONEY: "#3fb950", DEVICE: "#8b97a7", IP: "#f0506e", URL: "#4ea1ff", IMEI: "#8b97a7",
};

const W = 560, H = 430;

function layout(kg: KGraph) {
  const n = kg.entities.length || 1;
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 60;
  const pos = new Map<string, { x: number; y: number }>();
  kg.entities.forEach((e, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pos.set(e.id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  });
  const events = kg.hyperedges.map((h) => {
    const pts = h.members.map((m) => pos.get(m)).filter(Boolean) as { x: number; y: number }[];
    const mx = pts.reduce((s, p) => s + p.x, 0) / (pts.length || 1);
    const my = pts.reduce((s, p) => s + p.y, 0) / (pts.length || 1);
    // Pull the hub toward centre so overlapping events fan out.
    return { h, x: cx + (mx - cx) * 0.55, y: cy + (my - cy) * 0.55 };
  });
  return { pos, events };
}

export default function KnowledgeCompiler({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState(SAMPLE_REPORT);
  const [kg, setKg] = useState<KGraph | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [exp, setExp] = useState<"json" | "cypher" | null>(null);

  const view = useMemo(() => (kg ? layout(kg) : null), [kg]);
  const run = () => { setKg(compile(text)); setSelected(null); setExp(null); };
  const expText = useMemo(
    () => (!kg || !exp ? "" : exp === "json" ? toJSON(kg) : toCypher(kg)),
    [kg, exp]
  );

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="kc" role="dialog" aria-modal aria-label="Knowledge Compiler">
        <div className="kc-head">
          <div className="kc-title"><span className="kc-mark">⚛</span> Knowledge Compiler
            <span className="muted small"> · Hyper-Extract (§6) — text → hypergraph</span>
          </div>
          <button className="drawer-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="kc-body">
          <div className="kc-left">
            <textarea className="kc-input" value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Paste a report, OSINT note, or intel document…" spellCheck={false} />
            <div className="kc-actions">
              <button className="kc-btn" onClick={run}>⚛ Compile</button>
              <button className="kc-ghost" onClick={() => setText(SAMPLE_REPORT)}>Load sample</button>
            </div>
            {kg && (
              <div className="kc-stats">
                <span><b>{kg.entities.length}</b> entities</span>
                <span><b>{kg.relations.length}</b> relations</span>
                <span><b>{kg.hyperedges.length}</b> hyperedges</span>
              </div>
            )}
            {kg && (
              <div className="kc-export-btns">
                <button className={`kc-xbtn ${exp === "json" ? "on" : ""}`} onClick={() => setExp(exp === "json" ? null : "json")}>⬇ JSON</button>
                <button className={`kc-xbtn ${exp === "cypher" ? "on" : ""}`} onClick={() => setExp(exp === "cypher" ? null : "cypher")}>⬇ Cypher</button>
              </div>
            )}
            {kg && kg.hyperedges.length > 0 && (
              <div className="kc-events">
                <div className="kc-events-title">Events (many-way)</div>
                {kg.hyperedges.map((h, i) => (
                  <button key={h.id} className={`kc-event ${selected === i ? "sel" : ""}`}
                    onClick={() => setSelected(i === selected ? null : i)}>
                    <span className="kc-event-n">{h.members.length}×</span>
                    <span className="kc-event-txt">{h.evidence}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="kc-graph-wrap">
            {exp && (
              <div className="kc-export">
                <div className="kc-export-head">
                  <span className="mono small">{exp === "json" ? "knowledge-graph.json" : "knowledge-graph.cypher"} · {expText.length} chars</span>
                  <div className="kc-export-actions">
                    <button className="kc-ghost" onClick={() => navigator.clipboard?.writeText(expText)}>Copy</button>
                    <button className="kc-btn" onClick={() => download(exp === "json" ? "knowledge-graph.json" : "knowledge-graph.cypher", expText, exp === "json" ? "application/json" : "text/plain")}>⬇ Download</button>
                    <button className="drawer-x" onClick={() => setExp(null)} aria-label="Close export">✕</button>
                  </div>
                </div>
                <pre className="kc-export-body">{expText}</pre>
              </div>
            )}
            {view ? (
              <svg className="kc-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Compiled hypergraph">
                {/* hyperedge member links */}
                {view.events.map((ev, i) => ev.h.members.map((mid, j) => {
                  const p = view.pos.get(mid); if (!p) return null;
                  const dim = selected !== null && selected !== i;
                  return <line key={`${i}-${j}`} x1={ev.x} y1={ev.y} x2={p.x} y2={p.y}
                    className={`kc-hlink ${dim ? "dim" : ""}`} />;
                }))}
                {/* entity nodes */}
                {kg!.entities.map((e) => {
                  const p = view.pos.get(e.id)!;
                  return (
                    <g key={e.id} transform={`translate(${p.x},${p.y})`} className="kc-node">
                      <circle r={5} style={{ fill: KIND_COLOR[e.kind] ?? "#8b97a7" }} />
                      <text x={8} y={3}>{e.text.length > 16 ? e.text.slice(0, 15) + "…" : e.text}</text>
                    </g>
                  );
                })}
                {/* event hubs */}
                {view.events.map((ev, i) => {
                  const dim = selected !== null && selected !== i;
                  return (
                    <g key={ev.h.id} transform={`translate(${ev.x},${ev.y})`} className={`kc-hub ${dim ? "dim" : ""}`}>
                      <rect x={-6} y={-6} width={12} height={12} transform="rotate(45)" />
                    </g>
                  );
                })}
              </svg>
            ) : (
              <div className="kc-placeholder">
                <div className="kc-placeholder-mark">⚛</div>
                <p>Compile a document to see its entities and many-way event hyperedges.</p>
              </div>
            )}
            <div className="kc-legend">
              {(["PERSON", "PHONE", "EMAIL", "MONEY", "LOCATION", "TIME", "IP", "DEVICE"] as EntityKind[]).map((k) => (
                <span key={k} className="kc-leg"><i style={{ background: KIND_COLOR[k] }} /> {k.toLowerCase()}</span>
              ))}
              <span className="kc-leg"><i className="kc-diamond" /> event</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
