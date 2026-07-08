// KeyStoneOS UI domain model. Mirrors CLAUDE.md §4 (the Atomic Mission saga),
// §5 (lease/worktree), §7 (bounded repair loop) and §9 (the UI regions).
// The control-plane streams these over a WebSocket; the UI never invents state.

// ---- §9 file badges (left panel) -------------------------------------------
export type FileBadge =
  | "clean"
  | "modified-aider"
  | "generated"
  | "pending-commit"
  | "locked-workflow"
  | "failed-validation";

export interface FileNode {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  badge: FileBadge;
}

// ---- §4 the 12 saga activities ---------------------------------------------
export type ActivityName =
  | "acquire_workspace_lease"
  | "create_worktree"
  | "agent_plan"
  | "build_context_pack"
  | "check_skill_cache"
  | "policy_check"
  | "code_edit"
  | "sandbox_run"
  | "debugger_subagent"
  | "loop_governor"
  | "qa_review"
  | "git_commit"
  | "graph_reindex"
  | "obsidian_sync"
  | "skill_candidate"
  | "human_review"
  | "release_lease";

// Which tool/lane owns the activity — drives badge colours & the One Rule view.
export type Lane =
  | "orchestrator"
  | "lease"
  | "langgraph"
  | "aider"
  | "openhands"
  | "qa"
  | "gitea"
  | "graph"
  | "obsidian"
  | "hermes"
  | "goose";

export type RunStatus = "idle" | "running" | "repairing" | "green" | "human_review";

// ---- §9 bottom: structured execution timeline ------------------------------
export interface TimelineEvent {
  id: string;
  ts: string; // HH:MM:SS
  lane: Lane;
  activity: ActivityName;
  summary: string;
  files: string[];
  state: "ok" | "fail" | "info";
  // Each event links to its full context (§9: input state, tool, stdout/stderr, diff, rollback).
  detail: {
    input?: string;
    stdout?: string;
    stderr?: string;
    diff?: string;
    rollbackPoint?: string;
  };
}

// ---- §9 telemetry strip ----------------------------------------------------
export interface Telemetry {
  vramPct: number;
  ramPct: number;
  cpuPct: number;
  diskIoMbs: number;
  tokensPerSec: number;
  containers: number;
  // §9: telemetry is not cosmetic — it controls scheduling. These are the
  // active control signals derived from the readings above.
  signals: {
    embeddingPaused: boolean; // VRAM > 90%
    aiderBlocked: boolean; // tests running -> block Aider on mounted files
    forceCompress: boolean; // context over threshold
  };
}

// ---- §6 knowledge graph (right panel; Memgraph data) -----------------------
export type GraphNodeKind = "file" | "function" | "test" | "module" | "decision";
export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  x: number; // normalized 0..1 layout
  y: number;
  hot?: boolean; // touched by the current mission
}
export type GraphEdgeKind = "imports" | "calls" | "tests" | "inherits";
export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

// ---- §4 mission ------------------------------------------------------------
export interface Mission {
  id: string;
  request: string;
  branch: string;
  attempt: number;
  maxAttempts: number;
  activity: ActivityName | null;
  status: RunStatus;
}

// ---- Center tab payloads (§9 center: Plan / Diff / TTY / Tests) -------------
export interface TestResult {
  name: string;
  status: "pass" | "fail" | "skip";
  ms: number;
}

export interface AppState {
  project: {
    name: string;
    model: string;
    branch: string;
    agentMode: string;
    airgap: boolean;
  };
  mission: Mission;
  files: FileNode[];
  telemetry: Telemetry;
  timeline: TimelineEvent[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  tabs: {
    plan: string; // LangGraph intent JSON (§4.3) — read-only
    diff: string; // Aider patch (§4.5)
    tty: string; // OpenHands TTY (§4.6)
    tests: TestResult[]; // sandbox results
  };
  connection: "mock" | "live";
}

// Events the control-plane emits to the UI.
export type CPEvent =
  | { type: "snapshot"; state: AppState }
  | { type: "telemetry"; telemetry: Telemetry }
  | { type: "mission"; mission: Mission }
  | { type: "files"; files: FileNode[] }
  | { type: "timeline:reset" }
  | { type: "timeline:add"; event: TimelineEvent }
  | { type: "tab:plan"; value: string }
  | { type: "tab:diff"; value: string }
  | { type: "tab:tty:append"; value: string }
  | { type: "tab:tests"; value: TestResult[] }
  | { type: "graph"; graph: { nodes: GraphNode[]; edges: GraphEdge[] } };
