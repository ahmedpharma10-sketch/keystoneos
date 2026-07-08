// Control-plane client. The UI talks to ONE source of state.
//
//  - LIVE: the Rust control-plane (CLAUDE.md §1) streams CPEvents as JSON over a
//    WebSocket (deploy/docker-compose.yml maps it on :8080). Commands (start a
//    mission) go back over the same socket.
//  - MOCK: when no backend is reachable, a self-contained engine streams a
//    realistic scripted mission so the UI is fully usable standalone.
//
// Selection: set VITE_KEYSTONE_WS (e.g. ws://localhost:8080/stream) to force
// live; otherwise the client probes it briefly and falls back to mock. This
// keeps the shell decoupled from the backplane — exactly the §0 boundary.

import type { CPEvent } from "../types";
import { MockControlPlane } from "./mockMission";

export interface LeadAgent {
  name: string;
  emoji: string;
  division: string;
}

export interface ControlPlane {
  start: () => void;
  stop: () => void;
  runMission: (scenarioId?: string, lead?: LeadAgent | null) => void;
  mode: () => "mock" | "live";
}

type Emit = (e: CPEvent) => void;

function mock(emit: Emit): ControlPlane {
  const cp = new MockControlPlane(emit);
  return {
    start: () => cp.start(),
    stop: () => cp.stop(),
    runMission: (scenarioId?: string, lead?: LeadAgent | null) => cp.runMission(scenarioId, lead),
    mode: () => "mock",
  };
}

function live(url: string, emit: Emit, ws: WebSocket): ControlPlane {
  ws.onmessage = (msg) => {
    try {
      emit(JSON.parse(msg.data) as CPEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  return {
    start: () => {
      /* server pushes a snapshot on connect */
    },
    stop: () => ws.close(),
    runMission: (scenarioId?: string, lead?: LeadAgent | null) =>
      ws.send(JSON.stringify({ cmd: "run_mission", scenario: scenarioId, lead, source: url })),
    mode: () => "live",
  };
}

/**
 * Resolve a control-plane. Tries the live WebSocket if configured/reachable,
 * otherwise resolves the mock. Always resolves — the UI must come up.
 */
export function createControlPlane(emit: Emit): Promise<ControlPlane> {
  const url = (import.meta as any).env?.VITE_KEYSTONE_WS as string | undefined;
  if (!url) return Promise.resolve(mock(emit));

  return new Promise((resolve) => {
    let settled = false;
    const finish = (cp: ControlPlane) => {
      if (!settled) {
        settled = true;
        resolve(cp);
      }
    };
    try {
      const ws = new WebSocket(url);
      const probe = window.setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* noop */
        }
        finish(mock(emit));
      }, 1200);
      ws.onopen = () => {
        window.clearTimeout(probe);
        finish(live(url, emit, ws));
      };
      ws.onerror = () => {
        window.clearTimeout(probe);
        finish(mock(emit));
      };
    } catch {
      finish(mock(emit));
    }
  });
}
