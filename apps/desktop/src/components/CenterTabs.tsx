import { useEffect, useRef, useState } from "react";
import type { AppState, Mission, ActivityName } from "../types";

// §9 Center: tabbed — Agent Plan · Aider Diff · OpenHands TTY · Test Results.
type TabKey = "plan" | "diff" | "tty" | "tests";
const TABS: { key: TabKey; label: string }[] = [
  { key: "plan", label: "Agent Plan" },
  { key: "diff", label: "Aider Diff" },
  { key: "tty", label: "OpenHands TTY" },
  { key: "tests", label: "Test Results" },
];

// The One Rule banner (§0): show who is acting right now.
const LANE_OF: Partial<Record<ActivityName, string>> = {
  agent_plan: "LangGraph proposes (intent only)",
  build_context_pack: "Graph RAG retrieves",
  code_edit: "Aider edits (worktree)",
  sandbox_run: "OpenHands executes (snapshot)",
  debugger_subagent: "Debugger reads failed log",
  qa_review: "QA reviews",
  git_commit: "Orchestrator commits",
  graph_reindex: "Indexer reindexes",
  obsidian_sync: "Obsidian writes docs",
  skill_candidate: "Hermes captures (green-only)",
};

export default function CenterTabs({
  tabs,
  mission,
  oneRuleActivity,
}: {
  tabs: AppState["tabs"];
  mission: Mission;
  oneRuleActivity: ActivityName | null;
}) {
  const [active, setActive] = useState<TabKey>("plan");
  const ttyRef = useRef<HTMLPreElement>(null);

  // Auto-focus the relevant tab as the mission moves through the saga.
  useEffect(() => {
    if (!oneRuleActivity) return;
    if (oneRuleActivity === "agent_plan") setActive("plan");
    else if (oneRuleActivity === "code_edit") setActive("diff");
    else if (oneRuleActivity === "sandbox_run") setActive("tty");
  }, [oneRuleActivity]);

  useEffect(() => {
    if (active === "tty" && ttyRef.current)
      ttyRef.current.scrollTop = ttyRef.current.scrollHeight;
  }, [tabs.tty, active]);

  const passed = tabs.tests.filter((t) => t.status === "pass").length;
  const failed = tabs.tests.filter((t) => t.status === "fail").length;

  return (
    <section className="center">
      <div className="center-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={active === t.key ? "ct active" : "ct"}
            onClick={() => setActive(t.key)}
          >
            {t.label}
            {t.key === "tests" && tabs.tests.length > 0 && (
              <span className={`pill ${failed ? "pill-fail" : "pill-pass"}`}>
                {failed ? `${failed}✕` : `${passed}✓`}
              </span>
            )}
          </button>
        ))}
        <div className="one-rule" title="CLAUDE.md §0 — Agents propose, tools execute, only the orchestrator commits">
          {oneRuleActivity ? (LANE_OF[oneRuleActivity] ?? oneRuleActivity) : "Idle"}
        </div>
      </div>

      <div className="center-body">
        {active === "plan" &&
          (tabs.plan ? (
            <pre className="code json">{tabs.plan}</pre>
          ) : (
            <Empty hint="LangGraph emits an intent (JSON) here — it never touches files (§4.3)." />
          ))}

        {active === "diff" &&
          (tabs.diff ? (
            <pre className="code diff">
              {tabs.diff.split("\n").map((line, i) => (
                <span key={i} className={diffClass(line)}>
                  {line}
                  {"\n"}
                </span>
              ))}
            </pre>
          ) : (
            <Empty hint="Aider writes surgical diffs into the leased worktree (§4.5)." />
          ))}

        {active === "tty" &&
          (tabs.tty ? (
            <pre className="code tty" ref={ttyRef}>
              {tabs.tty}
            </pre>
          ) : (
            <Empty hint="OpenHands runs the snapshot in an ephemeral, network:none container (§4.6)." />
          ))}

        {active === "tests" &&
          (tabs.tests.length ? (
            <ul className="tests">
              {tabs.tests.map((t) => (
                <li key={t.name} className={`test test-${t.status}`}>
                  <span className="test-glyph">
                    {t.status === "pass" ? "✓" : t.status === "fail" ? "✕" : "·"}
                  </span>
                  <span className="test-name">{t.name}</span>
                  <span className="test-ms">{t.ms}ms</span>
                </li>
              ))}
              <li className="tests-summary">
                {passed} passed{failed ? `, ${failed} failed` : ""} ·{" "}
                {mission.status === "green" ? "green ✓" : mission.status}
              </li>
            </ul>
          ) : (
            <Empty hint="Sandbox results land here. Green is required before commit (§4.6)." />
          ))}
      </div>
    </section>
  );
}

function diffClass(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) return "diff-add";
  if (line.startsWith("-") && !line.startsWith("---")) return "diff-del";
  if (line.startsWith("@@")) return "diff-hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "diff-file";
  return "";
}

function Empty({ hint }: { hint: string }) {
  return (
    <div className="empty">
      <div className="empty-mark">⌁</div>
      <p>{hint}</p>
    </div>
  );
}
