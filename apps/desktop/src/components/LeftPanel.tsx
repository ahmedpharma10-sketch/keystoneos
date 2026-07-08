import { useState } from "react";
import type { FileNode, FileBadge, GraphNode, GraphEdge } from "../types";

// §9 Left: Git working-tree explorer (orchestrator-backed, NOT raw fs watching)
// + Obsidian graph. File badges per the spec.
const BADGE_META: Record<FileBadge, { label: string; cls: string; glyph: string }> = {
  clean: { label: "Clean", cls: "b-clean", glyph: "" },
  "modified-aider": { label: "Modified by Aider", cls: "b-aider", glyph: "✎" },
  generated: { label: "Generated", cls: "b-generated", glyph: "✦" },
  "pending-commit": { label: "Pending commit", cls: "b-pending", glyph: "↑" },
  "locked-workflow": { label: "Locked by workflow", cls: "b-locked", glyph: "🔒" },
  "failed-validation": { label: "Failed validation", cls: "b-failed", glyph: "✕" },
};

const VAULT = [
  { folder: "Projects", notes: ["keystoneos.md"] },
  { folder: "Architecture", notes: ["one-rule.md", "isolation.md"] },
  { folder: "Decisions", notes: ["ADR-004-jwt.md", "ADR-001-memgraph.md"] },
  { folder: "Runs", notes: ["ks-20260629-001.md"] },
  { folder: "Bugs", notes: ["alg-none.md"] },
  { folder: "Skills", notes: ["reject-alg-none (candidate).md"] },
];

// §9 left: the Obsidian graph — vault notes linked by [[backlinks]].
const VAULT_NODES = [
  { id: "keystoneos", x: 0.5, y: 0.18 },
  { id: "one-rule", x: 0.18, y: 0.45 },
  { id: "isolation", x: 0.5, y: 0.5 },
  { id: "ADR-001", x: 0.84, y: 0.42 },
  { id: "ADR-004", x: 0.72, y: 0.78 },
  { id: "ks-001", x: 0.26, y: 0.82 },
  { id: "alg-none", x: 0.5, y: 0.95 },
];
const VAULT_LINKS: [string, string][] = [
  ["keystoneos", "one-rule"],
  ["keystoneos", "isolation"],
  ["keystoneos", "ADR-001"],
  ["ks-001", "keystoneos"],
  ["ks-001", "alg-none"],
  ["alg-none", "ADR-004"],
];

export default function LeftPanel({
  files,
  graph,
}: {
  files: FileNode[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}) {
  const [tab, setTab] = useState<"tree" | "vault">("tree");
  return (
    <aside className="left">
      <div className="left-tabs">
        <button className={tab === "tree" ? "lt active" : "lt"} onClick={() => setTab("tree")}>
          Working tree
        </button>
        <button className={tab === "vault" ? "lt active" : "lt"} onClick={() => setTab("vault")}>
          Obsidian
        </button>
      </div>

      {tab === "tree" ? (
        <>
          <ul className="tree">
            {files.map((f) => {
              const meta = BADGE_META[f.badge];
              return (
                <li
                  key={f.path}
                  className={`tree-row ${f.isDir ? "is-dir" : ""}`}
                  style={{ paddingLeft: 8 + f.depth * 14 }}
                  title={`${f.path} — ${meta.label}`}
                >
                  <span className="tree-icon">{f.isDir ? "▸" : "·"}</span>
                  <span className="tree-name">{f.name}</span>
                  {!f.isDir && f.badge !== "clean" && (
                    <span className={`badge ${meta.cls}`}>
                      {meta.glyph} {meta.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="legend">
            {(Object.keys(BADGE_META) as FileBadge[])
              .filter((b) => b !== "clean")
              .map((b) => (
                <span key={b} className={`badge ${BADGE_META[b].cls}`}>
                  {BADGE_META[b].glyph} {BADGE_META[b].label}
                </span>
              ))}
          </div>
        </>
      ) : (
        <div className="vault">
          <p className="muted small">
            Human memory — derived read model (§14). {graph.nodes.length} graph nodes indexed.
          </p>
          <svg className="vault-graph" viewBox="0 0 240 150" role="img" aria-label="Obsidian backlink graph">
            {VAULT_LINKS.map(([a, b], i) => {
              const na = VAULT_NODES.find((n) => n.id === a)!;
              const nb = VAULT_NODES.find((n) => n.id === b)!;
              return (
                <line key={i} x1={na.x * 230 + 5} y1={na.y * 140 + 5} x2={nb.x * 230 + 5} y2={nb.y * 140 + 5} className="vault-edge" />
              );
            })}
            {VAULT_NODES.map((n) => (
              <g key={n.id} transform={`translate(${n.x * 230 + 5},${n.y * 140 + 5})`} className="vault-node">
                <circle r={4} />
                <text x={6} y={3}>{n.id}</text>
              </g>
            ))}
          </svg>
          {VAULT.map((v) => (
            <div key={v.folder} className="vault-folder">
              <div className="vault-folder-name">▸ {v.folder}/</div>
              {v.notes.map((n) => (
                <div key={n} className="vault-note">[[{n.replace(/\.md$/, "")}]]</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
