import type { AppState } from "../types";
import type { ScenarioMeta } from "../lib/mockMission";
import type { AgencyAgent } from "../lib/agency";

// §9 Top bar: Project · Model · Git branch · Agent mode · Airgap · Run status.
const STATUS_LABEL: Record<string, string> = {
  idle: "Idle",
  running: "Running",
  repairing: "Repairing",
  green: "Green",
  human_review: "Human review",
};

export default function TopBar({
  state,
  running,
  scenarios,
  scenario,
  onScenario,
  lead,
  onOpenAgency,
  onOpenCompiler,
  onRun,
}: {
  state: AppState;
  running: boolean;
  scenarios: ScenarioMeta[];
  scenario: string;
  onScenario: (id: string) => void;
  lead: AgencyAgent | null;
  onOpenAgency: () => void;
  onOpenCompiler: () => void;
  onRun: () => void;
}) {
  const { project, mission } = state;
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>◆</span> KeyStoneOS
      </div>

      <div className="topbar-fields">
        <Field label="Project" value={project.name} />
        <Field label="Model" value={project.model} mono />
        <Field label="Branch" value={mission.branch} mono icon="⎇" />
        <Field label="Agent mode" value={project.agentMode} />
        <div className={`chip ${project.airgap ? "chip-airgap" : "chip-warn"}`} title="CLAUDE.md §11 — no outbound network by default">
          {project.airgap ? "⛓ Airgap ON" : "⚠ Network allowed"}
        </div>
      </div>

      <div className="topbar-right">
        <button className="agency-btn" onClick={onOpenCompiler} title="Knowledge Compiler — text → hypergraph (§6)">
          ⚛ Compile
        </button>
        <button className="agency-btn" onClick={onOpenAgency} title="Browse The Agency — 218 specialist agents">
          {lead ? (
            <span className="agency-lead">{lead.emoji} {lead.name}</span>
          ) : (
            <>⊞ Agency</>
          )}
        </button>
        <select
          className="scenario-select"
          value={scenario}
          onChange={(e) => onScenario(e.target.value)}
          disabled={running}
          title="Choose a mission to run"
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <div className={`run-status status-${mission.status}`}>
          <span className="dot" /> {STATUS_LABEL[mission.status] ?? mission.status}
          {running && mission.attempt > 0 && (
            <span className="attempt"> · attempt {mission.attempt}/{mission.maxAttempts}</span>
          )}
        </div>
        <button className="run-btn" onClick={onRun} disabled={running}>
          {running ? "Mission running…" : "▶ Run mission"}
        </button>
      </div>
    </header>
  );
}

function Field({
  label,
  value,
  mono,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: string;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className={`field-value${mono ? " mono" : ""}`}>
        {icon && <span className="field-icon">{icon} </span>}
        {value}
      </span>
    </div>
  );
}
