import { useEffect, useRef } from "react";
import type { TimelineEvent, Lane } from "../types";

// §9 Bottom: structured execution timeline (NOT a raw reasoning dump). Each
// event links to its input state, tool, files, stdout/stderr, diff, rollback.
const LANE_CLS: Record<Lane, string> = {
  orchestrator: "l-orch",
  lease: "l-lease",
  langgraph: "l-lang",
  aider: "l-aider",
  openhands: "l-oh",
  qa: "l-qa",
  gitea: "l-git",
  graph: "l-graph",
  obsidian: "l-obs",
  hermes: "l-hermes",
  goose: "l-goose",
};

export default function Timeline({
  events,
  onPick,
}: {
  events: TimelineEvent[];
  onPick: (e: TimelineEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [events.length]);

  return (
    <div className="timeline">
      <div className="timeline-label">Execution timeline</div>
      <div className="timeline-track" ref={ref}>
        {events.length === 0 && (
          <span className="muted small timeline-empty">
            Run a mission to populate the saga (§4). Each step is recoverable & compensatable.
          </span>
        )}
        {events.map((e) => (
          <button
            key={e.id}
            className={`tl-event ${LANE_CLS[e.lane]} tl-${e.state}`}
            onClick={() => onPick(e)}
            title={`${e.activity} — click for input / stdout / diff / rollback`}
          >
            <span className="tl-ts">{e.ts}</span>
            <span className="tl-act">{e.activity}</span>
            <span className="tl-sum">{e.summary}</span>
            {e.state === "fail" && <span className="tl-flag">✕</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
