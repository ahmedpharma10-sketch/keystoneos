import type { GraphNode, GraphEdge } from "../types";

// §9 Right: the actionable knowledge graph (Memgraph data). Clicking a node
// opens the detail drawer (open file / ask agent / callers-callees / new task).
const KIND_CLS: Record<GraphNode["kind"], string> = {
  file: "n-file",
  function: "n-func",
  test: "n-test",
  module: "n-mod",
  decision: "n-dec",
};

const W = 360;
const H = 460;

export default function GraphPanel({
  graph,
  onPick,
}: {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  onPick: (n: GraphNode) => void;
}) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const px = (n: GraphNode) => 20 + n.x * (W - 40);
  const py = (n: GraphNode) => 20 + n.y * (H - 40);

  return (
    <aside className="right">
      <div className="right-head">
        Knowledge graph
        <span className="muted small"> · Memgraph</span>
      </div>
      <svg className="graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Code knowledge graph">
        {graph.edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={i}
              x1={px(a)}
              y1={py(a)}
              x2={px(b)}
              y2={py(b)}
              className={`edge edge-${e.kind}`}
            />
          );
        })}
        {graph.nodes.map((n) => (
          <g
            key={n.id}
            transform={`translate(${px(n)},${py(n)})`}
            className={`node ${KIND_CLS[n.kind]} ${n.hot ? "hot" : ""}`}
            onClick={() => onPick(n)}
            tabIndex={0}
            role="button"
            aria-label={`${n.label} (${n.kind})`}
          >
            <circle r={n.hot ? 9 : 6} />
            <text x={11} y={4}>
              {n.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="graph-legend">
        <span className="gl n-file">file</span>
        <span className="gl n-func">function</span>
        <span className="gl n-test">test</span>
        <span className="gl n-mod">module</span>
        <span className="gl n-dec">decision</span>
      </div>
      <p className="muted small graph-hint">Click a node for actions · hot = touched this mission</p>
    </aside>
  );
}
