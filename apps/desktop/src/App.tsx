import { useEffect, useReducer, useRef, useState } from "react";
import type { AppState, CPEvent, TimelineEvent, GraphNode } from "./types";
import { initialState, SCENARIOS } from "./lib/mockMission";
import { createControlPlane, type ControlPlane } from "./lib/controlPlane";
import TopBar from "./components/TopBar";
import LeftPanel from "./components/LeftPanel";
import CenterTabs from "./components/CenterTabs";
import GraphPanel from "./components/GraphPanel";
import Timeline from "./components/Timeline";
import TelemetryStrip from "./components/TelemetryStrip";
import DetailDrawer from "./components/DetailDrawer";
import AgencyDirectory from "./components/AgencyDirectory";
import KnowledgeCompiler from "./components/KnowledgeCompiler";
import type { AgencyAgent } from "./lib/agency";

function reducer(state: AppState, e: CPEvent): AppState {
  switch (e.type) {
    case "snapshot":
      return e.state;
    case "telemetry":
      return { ...state, telemetry: e.telemetry };
    case "mission":
      return { ...state, mission: e.mission };
    case "files":
      return { ...state, files: e.files };
    case "timeline:reset":
      return { ...state, timeline: [] };
    case "timeline:add":
      return { ...state, timeline: [...state.timeline, e.event] };
    case "tab:plan":
      return { ...state, tabs: { ...state.tabs, plan: e.value } };
    case "tab:diff":
      return { ...state, tabs: { ...state.tabs, diff: e.value } };
    case "tab:tty:append":
      return {
        ...state,
        tabs: {
          ...state.tabs,
          tty: e.value === "__CLEAR__" ? "" : state.tabs.tty + e.value,
        },
      };
    case "tab:tests":
      return { ...state, tabs: { ...state.tabs, tests: e.value } };
    case "graph":
      return { ...state, graph: e.graph };
    default:
      return state;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const cpRef = useRef<ControlPlane | null>(null);
  const [drawer, setDrawer] = useState<
    | { kind: "event"; event: TimelineEvent }
    | { kind: "node"; node: GraphNode }
    | null
  >(null);
  const [scenario, setScenario] = useState(SCENARIOS[0].id);
  const [agencyOpen, setAgencyOpen] = useState(false);
  const [compilerOpen, setCompilerOpen] = useState(false);
  const [lead, setLead] = useState<AgencyAgent | null>(null);

  useEffect(() => {
    let cp: ControlPlane | null = null;
    let cancelled = false;
    createControlPlane((e) => dispatch(e)).then((c) => {
      // If the effect was torn down before this resolved (StrictMode double-mount
      // / unmount), stop the instance immediately so its telemetry timer can't leak.
      if (cancelled) {
        c.stop();
        return;
      }
      cp = c;
      cpRef.current = c;
      c.start();
    });
    return () => {
      cancelled = true;
      cp?.stop();
    };
  }, []);

  const running =
    state.mission.status === "running" || state.mission.status === "repairing";

  return (
    <div className="app">
      <TopBar
        state={state}
        running={running}
        scenarios={SCENARIOS}
        scenario={scenario}
        onScenario={setScenario}
        lead={lead}
        onOpenAgency={() => setAgencyOpen(true)}
        onOpenCompiler={() => setCompilerOpen(true)}
        onRun={() =>
          cpRef.current?.runMission(
            scenario,
            lead ? { name: lead.name, emoji: lead.emoji, division: lead.division } : null
          )
        }
      />

      <div className="workbench">
        <LeftPanel files={state.files} graph={state.graph} />
        <CenterTabs
          tabs={state.tabs}
          mission={state.mission}
          oneRuleActivity={state.mission.activity}
        />
        <GraphPanel
          graph={state.graph}
          onPick={(node) => setDrawer({ kind: "node", node })}
        />
      </div>

      <Timeline
        events={state.timeline}
        onPick={(event) => setDrawer({ kind: "event", event })}
      />

      <TelemetryStrip telemetry={state.telemetry} />

      {drawer && (
        <DetailDrawer
          payload={drawer}
          onClose={() => setDrawer(null)}
        />
      )}

      {agencyOpen && (
        <AgencyDirectory
          leadId={lead?.id ?? null}
          onAssign={(a) => {
            setLead(a);
            setAgencyOpen(false);
          }}
          onClose={() => setAgencyOpen(false)}
        />
      )}

      {compilerOpen && <KnowledgeCompiler onClose={() => setCompilerOpen(false)} />}
    </div>
  );
}
