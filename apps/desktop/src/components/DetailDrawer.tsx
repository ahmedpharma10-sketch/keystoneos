import type { TimelineEvent, GraphNode } from "../types";

// Detail surface: a timeline event's full context (§9 — input/stdout/stderr/
// diff/rollback), or the actionable menu for a clicked graph node.
type Payload =
  | { kind: "event"; event: TimelineEvent }
  | { kind: "node"; node: GraphNode };

const NODE_ACTIONS = [
  { glyph: "↗", label: "Open file" },
  { glyph: "✦", label: "Ask an agent about this" },
  { glyph: "⇄", label: "Show callers / callees" },
  { glyph: "＋", label: "Create a task" },
];

export default function DetailDrawer({
  payload,
  onClose,
}: {
  payload: Payload;
  onClose: () => void;
}) {
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal>
        <div className="drawer-head">
          <span>{payload.kind === "event" ? "Timeline event" : "Graph node"}</span>
          <button className="drawer-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {payload.kind === "event" ? (
          <EventDetail e={payload.event} />
        ) : (
          <NodeDetail n={payload.node} />
        )}
      </div>
    </>
  );
}

function EventDetail({ e }: { e: TimelineEvent }) {
  const d = e.detail;
  return (
    <div className="drawer-body">
      <div className="dl-row">
        <span className="dl-k">When</span>
        <span className="dl-v mono">{e.ts}</span>
      </div>
      <div className="dl-row">
        <span className="dl-k">Activity</span>
        <span className="dl-v mono">{e.activity}</span>
      </div>
      <div className="dl-row">
        <span className="dl-k">Lane</span>
        <span className="dl-v">{e.lane}</span>
      </div>
      <div className="dl-row">
        <span className="dl-k">Summary</span>
        <span className="dl-v">{e.summary}</span>
      </div>
      {e.files.length > 0 && (
        <div className="dl-row">
          <span className="dl-k">Files</span>
          <span className="dl-v mono">{e.files.join(", ")}</span>
        </div>
      )}
      {d.input && <Block title="Input state" body={d.input} />}
      {d.stdout && <Block title="stdout" body={d.stdout} />}
      {d.stderr && <Block title="stderr" body={d.stderr} tone="err" />}
      {d.diff && <Block title="Diff" body={d.diff} mono />}
      {d.rollbackPoint && (
        <div className="dl-row">
          <span className="dl-k">Rollback</span>
          <span className="dl-v mono">{d.rollbackPoint}</span>
        </div>
      )}
    </div>
  );
}

function NodeDetail({ n }: { n: GraphNode }) {
  return (
    <div className="drawer-body">
      <div className="dl-row">
        <span className="dl-k">Node</span>
        <span className="dl-v mono">{n.label}</span>
      </div>
      <div className="dl-row">
        <span className="dl-k">Kind</span>
        <span className="dl-v">{n.kind}</span>
      </div>
      <div className="node-actions">
        {NODE_ACTIONS.map((a) => (
          <button key={a.label} className="node-action">
            <span className="na-glyph">{a.glyph}</span> {a.label}
          </button>
        ))}
      </div>
      <p className="muted small">
        Actions route through the orchestrator as activities — the graph never mutates source (§2.3).
      </p>
    </div>
  );
}

function Block({
  title,
  body,
  mono,
  tone,
}: {
  title: string;
  body: string;
  mono?: boolean;
  tone?: "err";
}) {
  return (
    <div className="dl-block">
      <div className="dl-block-title">{title}</div>
      <pre className={`dl-block-body${mono ? " mono" : ""}${tone === "err" ? " err" : ""}`}>
        {body}
      </pre>
    </div>
  );
}
