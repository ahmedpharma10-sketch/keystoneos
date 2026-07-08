import { useEffect, useMemo, useState } from "react";
import { agency, searchAgents, getAgentBody, type AgencyAgent } from "../lib/agency";
import { routeAgent, type RouteResult } from "../lib/router";

// The Agency directory — browse/search 218 specialists across 16 divisions,
// read an agent's full prompt, and assign one as the mission lead. Opens as an
// overlay so the §9 four-region workbench underneath stays intact.
export default function AgencyDirectory({
  leadId,
  onAssign,
  onClose,
}: {
  leadId: string | null;
  onAssign: (a: AgencyAgent | null) => void;
  onClose: () => void;
}) {
  const [division, setDivision] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AgencyAgent | null>(null);
  const [body, setBody] = useState<string>("");
  const [bodyLoading, setBodyLoading] = useState(false);
  const [routed, setRouted] = useState<RouteResult[] | null>(null);

  const results = useMemo(() => searchAgents(query, division), [query, division]);
  const scoreOf = useMemo(() => {
    const m = new Map<string, RouteResult>();
    routed?.forEach((r) => m.set(r.agent.id, r));
    return m;
  }, [routed]);
  // Editing the query invalidates a prior routing.
  useEffect(() => setRouted(null), [query]);

  const runRoute = () => {
    if (query.trim()) setRouted(routeAgent(query, agency.agents));
  };

  useEffect(() => {
    if (!selected) return;
    let ignore = false; // drop a stale response if selection changed meanwhile
    setBodyLoading(true);
    setBody("");
    getAgentBody(selected.id)
      .then((b) => {
        if (ignore) return;
        setBody(b);
        setBodyLoading(false);
      })
      .catch(() => {
        if (ignore) return;
        setBody("(could not load this agent's prompt)");
        setBodyLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [selected]);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="agency" role="dialog" aria-modal aria-label="The Agency directory">
        <div className="agency-head">
          <div className="agency-title">
            <span className="agency-mark">⊞</span> The Agency
            <span className="muted small">
              {" "}
              · {agency.agents.length} agents · {agency.divisions.length} divisions ·{" "}
              <a href={agency.source} target="_blank" rel="noreferrer">
                {agency.license}
              </a>
            </span>
          </div>
          <input
            className="agency-search"
            placeholder="Search agents, or describe a mission and hit Route…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runRoute()}
            autoFocus
          />
          <button className="route-btn" onClick={runRoute} disabled={!query.trim()} title="Auto-pick the best lead agent for this request">
            ⤳ Route
          </button>
          <button className="drawer-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="agency-body">
          <nav className="agency-divisions">
            <button
              className={`agency-div ${division === null ? "active" : ""}`}
              onClick={() => setDivision(null)}
            >
              <span className="div-dot" style={{ background: "var(--accent)" }} /> All
              <span className="div-count">{agency.agents.length}</span>
            </button>
            {agency.divisions.map((d) => (
              <button
                key={d.id}
                className={`agency-div ${division === d.id ? "active" : ""}`}
                onClick={() => setDivision(d.id)}
              >
                <span className="div-dot" style={{ background: d.color }} /> {d.label}
                <span className="div-count">{d.count}</span>
              </button>
            ))}
          </nav>

          <div className="agency-grid">
            {routed && routed.length > 0 && (
              <div className="route-banner">
                <span className="route-label">⤳ Best fit</span>
                <span className="route-best">{routed[0].agent.emoji} {routed[0].agent.name}</span>
                <span className="route-score">{Math.round(routed[0].norm * 100)}%</span>
                <span className="muted small route-why">matched: {routed[0].matched.join(", ") || "—"}</span>
                <button className="route-assign" onClick={() => onAssign(routed[0].agent)}>
                  Assign as lead ▸
                </button>
              </div>
            )}
            {routed && routed.length === 0 && (
              <p className="muted agency-empty">No agent matched that request — try different words.</p>
            )}
            {(routed ? routed.map((r) => r.agent) : results).map((a) => {
              const r = scoreOf.get(a.id);
              return (
                <button
                  key={a.id}
                  className={`agent-card ${selected?.id === a.id ? "sel" : ""} ${leadId === a.id ? "is-lead" : ""}`}
                  style={{ borderLeftColor: a.color }}
                  onClick={() => setSelected(a)}
                >
                  <div className="agent-emoji">{a.emoji}</div>
                  <div className="agent-text">
                    <div className="agent-name">
                      {a.name}
                      {leadId === a.id && <span className="lead-tag">LEAD</span>}
                      {r && <span className="score-badge">{Math.round(r.norm * 100)}%</span>}
                    </div>
                    <div className="agent-vibe">{a.vibe || a.description}</div>
                  </div>
                </button>
              );
            })}
            {!routed && results.length === 0 && (
              <p className="muted agency-empty">No agents match “{query}”.</p>
            )}
          </div>

          <aside className="agent-detail">
            {selected ? (
              <>
                <div className="ad-head">
                  <span className="ad-emoji" style={{ background: selected.color + "22" }}>
                    {selected.emoji}
                  </span>
                  <div>
                    <div className="ad-name">{selected.name}</div>
                    <div className="muted small">{selected.division}</div>
                  </div>
                </div>
                {selected.vibe && <p className="ad-vibe">“{selected.vibe}”</p>}
                <p className="ad-desc">{selected.description}</p>
                <div className="ad-actions">
                  {leadId === selected.id ? (
                    <button className="ad-btn ghost" onClick={() => onAssign(null)}>
                      ✓ Lead — unassign
                    </button>
                  ) : (
                    <button className="ad-btn" onClick={() => onAssign(selected)}>
                      Assign as mission lead
                    </button>
                  )}
                </div>
                <div className="ad-prompt-title">System prompt</div>
                <pre className="ad-prompt">
                  {bodyLoading ? "Loading…" : body}
                </pre>
              </>
            ) : (
              <div className="ad-placeholder">
                <div className="ad-placeholder-mark">⊞</div>
                <p>Select an agent to read its full prompt and assign it as the mission lead.</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
