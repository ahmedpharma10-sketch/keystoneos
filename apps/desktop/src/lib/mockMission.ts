// Mock control-plane: a self-contained engine that streams realistic missions so
// the §9 UI is fully alive WITHOUT the Rust/Temporal backplane. It plays one of
// several declarative SCENARIOS, each exercising a different architectural path:
//
//   harden-jwt   §4 happy path with a §7 repair loop (fail -> debugger -> green)
//   rate-limit   §8 policy DENIAL of a forbidden edit, then re-scope -> green
//   payment-race §7 circuit breaker: same failure twice -> human-review queue
//
// When the real control-plane is up, controlPlane.ts connects to it instead.

import type {
  AppState,
  CPEvent,
  FileNode,
  GraphNode,
  GraphEdge,
  TimelineEvent,
  Telemetry,
  TestResult,
  ActivityName,
  RunStatus,
  Lane,
} from "../types";

const now = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

let eidSeq = 0;
const eid = () => `ev-${++eidSeq}`;

function file(path: string, badge: FileNode["badge"] = "clean"): FileNode {
  const isDir = path.endsWith("/");
  const parts = path.replace(/\/$/, "").split("/");
  return {
    path,
    name: isDir ? `${parts[parts.length - 1]}/` : parts[parts.length - 1],
    depth: parts.length - 1,
    isDir,
    badge,
  };
}

const INITIAL_FILES: FileNode[] = [
  file("src/"),
  file("src/auth/"),
  file("src/auth/jwt.py"),
  file("src/auth/session.py"),
  file("src/api/"),
  file("src/api/routes.py"),
  file("src/api/middleware.py"),
  file("src/checkout/"),
  file("src/checkout/service.py"),
  file("src/checkout/idempotency.py"),
  file("src/payments/"),
  file("src/payments/charge.py"),
  file("src/payments/refund.py"),
  file("tests/"),
  file("tests/test_auth.py"),
  file("tests/test_payments.py"),
  file("tests/test_checkout.py"),
  file("secrets/"),
  file("secrets/redis.env", "locked-workflow"),
  file("secrets/stripe.env", "locked-workflow"),
  file("docs/"),
  file("docs/context-pack.md"),
];

const GRAPH_NODES: GraphNode[] = [
  { id: "jwt", label: "jwt.py", kind: "file", x: 0.2, y: 0.22 },
  { id: "session", label: "session.py", kind: "file", x: 0.46, y: 0.14 },
  { id: "routes", label: "routes.py", kind: "file", x: 0.78, y: 0.24 },
  { id: "middleware", label: "middleware.py", kind: "file", x: 0.84, y: 0.5 },
  { id: "charge", label: "charge.py", kind: "file", x: 0.2, y: 0.55 },
  { id: "verify", label: "verify_token()", kind: "function", x: 0.32, y: 0.42 },
  { id: "login", label: "login()", kind: "function", x: 0.66, y: 0.42 },
  { id: "limit", label: "rate_limit()", kind: "function", x: 0.62, y: 0.68 },
  { id: "test_auth", label: "test_auth.py", kind: "test", x: 0.42, y: 0.86 },
  { id: "test_pay", label: "test_payments.py", kind: "test", x: 0.16, y: 0.82 },
  { id: "dec1", label: "ADR-004 JWT", kind: "decision", x: 0.9, y: 0.82 },
];

const GRAPH_EDGES: GraphEdge[] = [
  { from: "routes", to: "login", kind: "calls" },
  { from: "login", to: "verify", kind: "calls" },
  { from: "verify", to: "jwt", kind: "imports" },
  { from: "session", to: "jwt", kind: "imports" },
  { from: "middleware", to: "limit", kind: "calls" },
  { from: "routes", to: "middleware", kind: "imports" },
  { from: "charge", to: "limit", kind: "calls" },
  { from: "test_auth", to: "verify", kind: "tests" },
  { from: "test_pay", to: "charge", kind: "tests" },
  { from: "login", to: "dec1", kind: "calls" },
];

function baseTelemetry(): Telemetry {
  return {
    vramPct: 64, ramPct: 41, cpuPct: 22, diskIoMbs: 18,
    tokensPerSec: 0, containers: 0,
    signals: { embeddingPaused: false, aiderBlocked: false, forceCompress: false },
  };
}

// ---- Scenario model --------------------------------------------------------
export interface ScenarioMeta {
  id: string;
  label: string;
  request: string;
  branch: string;
  model: string;
}

interface StepApi {
  timeline: (e: Omit<TimelineEvent, "id" | "ts">) => void;
  mission: (patch: { activity?: ActivityName | null; status?: RunStatus; attempt?: number }) => void;
  plan: (s: string) => void;
  diff: (s: string) => void;
  tty: (s: string) => void;
  ttyClear: () => void;
  tests: (t: TestResult[]) => void;
  badge: (path: string, b: FileNode["badge"]) => void;
  hot: (ids: string[]) => void;
  signals: (s: Partial<Telemetry["signals"]>) => void;
  tel: (patch: Partial<Pick<Telemetry, "containers" | "tokensPerSec" | "vramPct">>) => void;
}

interface Step {
  t: number; // ms offset from mission start
  run: (api: StepApi) => void;
}

interface Scenario {
  meta: ScenarioMeta;
  steps: Step[];
}

function tl(
  lane: Lane,
  activity: ActivityName,
  summary: string,
  state: TimelineEvent["state"],
  extra: Partial<Pick<TimelineEvent, "files" | "detail">> = {}
): Omit<TimelineEvent, "id" | "ts"> {
  return { lane, activity, summary, state, files: extra.files ?? [], detail: extra.detail ?? {} };
}

export const SCENARIOS: ScenarioMeta[] = [
  { id: "harden-jwt", label: "Harden JWT (repair loop)", request: "Reject JWTs with alg=none in verify_token()", branch: "ks/harden-jwt", model: "qwen2.5-coder:32b" },
  { id: "rate-limit", label: "Rate limiter (policy denial → recover)", request: "Add a token-bucket rate limiter to the API", branch: "ks/rate-limit", model: "qwen2.5-coder:32b" },
  { id: "payment-race", label: "Payment race (3 strikes → human review)", request: "Fix the double-charge race in charge.py", branch: "ks/payment-race", model: "deepseek-coder-v2:16b" },
  { id: "checkout-service", label: "Checkout service (long · policy · 3-try repair → green)", request: "Ship a PCI-safe checkout service: charge + idempotency + rate-limit + refunds + tests", branch: "ks/checkout-service", model: "qwen2.5-coder:32b" },
];

// ---- Scenario scripts ------------------------------------------------------
const JWT_DIFF_1 = `--- a/src/auth/jwt.py
+++ b/src/auth/jwt.py
@@ def verify_token(token: str) -> dict:
-    header = jwt.get_unverified_header(token)
-    return jwt.decode(token, KEY, algorithms=[header["alg"]])
+    header = jwt.get_unverified_header(token)
+    if header.get("alg", "").lower() == "none":
+        raise InvalidToken("unsigned tokens are rejected")
+    return jwt.decode(token, KEY, algorithms=["HS256"])`;

const JWT_DIFF_2 = `${JWT_DIFF_1}
--- a/tests/test_auth.py
+++ b/tests/test_auth.py
@@
+def test_rejects_alg_none():
+    with pytest.raises(InvalidToken):
+        verify_token(make_unsigned_token())`;

const RL_PLAN_OVERREACH = `{
  "intent": "add_token_bucket_rate_limiter",
  "proposed_edits": [
    { "file": "src/api/middleware.py", "change": "token-bucket limiter" },
    { "file": "src/api/routes.py", "change": "apply @rate_limit" },
    { "file": "secrets/redis.env", "change": "add REDIS_URL for the bucket store" }
  ],
  "capability_request": {
    "tool": "aider", "capability": "write_files",
    "scope": ["src/api/middleware.py", "src/api/routes.py", "secrets/redis.env"]
  }
}`;

const RL_DIFF = `--- a/src/api/middleware.py
+++ b/src/api/middleware.py
@@
+class TokenBucket:
+    def __init__(self, rate, capacity): ...
+    def allow(self, key) -> bool: ...
+
+def rate_limit(handler):
+    bucket = TokenBucket(rate=10, capacity=20)
+    ...
--- a/src/api/routes.py
+++ b/src/api/routes.py
@@
-@app.post("/charge")
+@rate_limit
+@app.post("/charge")
 def charge(): ...`;

const PAY_DIFF = `--- a/src/payments/charge.py
+++ b/src/payments/charge.py
@@ def charge(order_id):
-    if not already_charged(order_id):
-        do_charge(order_id)
+    with lock(order_id):
+        if not already_charged(order_id):
+            do_charge(order_id)`;

function scenarioHardenJwt(): Step[] {
  return [
    { t: 300, run: (a) => { a.mission({ activity: "acquire_workspace_lease", status: "running" }); a.timeline(tl("lease", "acquire_workspace_lease", "Acquired exclusive lease on ks/harden-jwt", "ok", { detail: { rollbackPoint: "release_lease" } })); } },
    { t: 1100, run: (a) => { a.mission({ activity: "create_worktree" }); a.timeline(tl("orchestrator", "create_worktree", "git worktree add /workspaces/ks-001-edit", "ok", { detail: { rollbackPoint: "delete_worktree" } })); } },
    { t: 2000, run: (a) => { a.mission({ activity: "agent_plan" }); a.plan(`{\n  "intent": "harden_jwt_verification",\n  "proposed_edits": [{ "file": "src/auth/jwt.py" }, { "file": "tests/test_auth.py" }],\n  "capability_request": { "tool": "aider", "capability": "write_files", "scope": ["src/auth/jwt.py", "tests/test_auth.py"] }\n}`); a.hot(["jwt", "verify", "test_auth"]); a.timeline(tl("langgraph", "agent_plan", "LangGraph emitted intent: harden_jwt_verification", "info", { detail: { stdout: "intent emitted (no file writes)" } })); } },
    { t: 3000, run: (a) => { a.mission({ activity: "build_context_pack" }); a.timeline(tl("graph", "build_context_pack", "Context Pack: 9 nodes, 4 chunks, reranked + compressed", "ok", { files: ["src/auth/jwt.py"], detail: { stdout: "graph(9) -> vector(4) -> rerank -> 1.8k tokens" } })); } },
    { t: 3700, run: (a) => { a.mission({ activity: "check_skill_cache" }); a.timeline(tl("goose", "check_skill_cache", "No validated skill matches — full cycle", "info", {})); } },
    { t: 4500, run: (a) => { a.mission({ activity: "code_edit", attempt: 1 }); a.diff(JWT_DIFF_1); a.badge("src/auth/jwt.py", "modified-aider"); a.timeline(tl("aider", "code_edit", "Aider edited 1 file (attempt 1/3)", "ok", { files: ["src/auth/jwt.py"], detail: { diff: JWT_DIFF_1, rollbackPoint: "discard_worktree_changes" } })); } },
    { t: 5600, run: (a) => { a.tel({ containers: 1, tokensPerSec: 142 }); a.signals({ aiderBlocked: true }); a.ttyClear(); a.tty("$ pytest -q tests/test_auth.py\n"); } },
    { t: 6600, run: (a) => { a.tty("F.\n\nFAILED test_rejects_alg_none — InvalidToken not raised for malformed token\n"); a.tests([{ name: "test_rejects_alg_none", status: "fail", ms: 12 }, { name: "test_valid_token_ok", status: "pass", ms: 8 }]); a.badge("src/auth/jwt.py", "failed-validation"); a.tel({ containers: 0 }); a.signals({ aiderBlocked: false }); a.timeline(tl("openhands", "sandbox_run", "Tests FAILED on snapshot (attempt 1)", "fail", { files: ["tests/test_auth.py"], detail: { stderr: "InvalidToken not raised for malformed token", stdout: "1 failed, 1 passed", rollbackPoint: "mark_failed" } })); } },
    { t: 7600, run: (a) => { a.mission({ activity: "debugger_subagent", status: "repairing" }); a.timeline(tl("langgraph", "debugger_subagent", "Debugger read failed log: also guard malformed tokens", "info", { detail: { input: "failed test log (not source)", stdout: "updated context pack" } })); } },
    { t: 8600, run: (a) => { a.mission({ activity: "code_edit", attempt: 2 }); a.diff(JWT_DIFF_2); a.badge("src/auth/jwt.py", "modified-aider"); a.badge("tests/test_auth.py", "modified-aider"); a.timeline(tl("aider", "code_edit", "Aider edited 2 files (attempt 2/3)", "ok", { files: ["src/auth/jwt.py", "tests/test_auth.py"], detail: { diff: JWT_DIFF_2 } })); } },
    { t: 9700, run: (a) => { a.tel({ containers: 1, tokensPerSec: 138 }); a.signals({ aiderBlocked: true }); a.tty("$ pytest -q tests/test_auth.py\n"); } },
    { t: 10700, run: (a) => { a.mission({ status: "green" }); a.tty("..\n\n2 passed in 0.19s\n"); a.tests([{ name: "test_rejects_alg_none", status: "pass", ms: 11 }, { name: "test_valid_token_ok", status: "pass", ms: 8 }]); a.tel({ containers: 0 }); a.signals({ aiderBlocked: false }); a.timeline(tl("openhands", "sandbox_run", "Tests PASSED on snapshot (attempt 2) — green", "ok", { detail: { stdout: "2 passed in 0.19s" } })); } },
    { t: 11500, run: (a) => { a.mission({ activity: "qa_review" }); a.timeline(tl("qa", "qa_review", "QA passed: scope respected, no policy breach", "ok", {})); } },
    { t: 12400, run: (a) => { a.mission({ activity: "git_commit" }); a.badge("src/auth/jwt.py", "pending-commit"); a.badge("tests/test_auth.py", "pending-commit"); a.timeline(tl("gitea", "git_commit", "ks-001 code: reject alg=none (a1b2c3d)", "ok", { files: ["src/auth/jwt.py", "tests/test_auth.py"], detail: { stdout: "commit a1b2c3d", rollbackPoint: "revert_commit a1b2c3d" } })); } },
    { t: 13200, run: (a) => { a.badge("src/auth/jwt.py", "clean"); a.badge("tests/test_auth.py", "clean"); } },
    { t: 13900, run: (a) => { a.mission({ activity: "graph_reindex" }); a.hot(["jwt", "verify", "test_auth"]); a.timeline(tl("graph", "graph_reindex", "Reindexed: Memgraph edges + Qdrant chunks", "ok", {})); } },
    { t: 14700, run: (a) => { a.mission({ activity: "obsidian_sync" }); a.badge("docs/context-pack.md", "generated"); a.timeline(tl("obsidian", "obsidian_sync", "Vault note: Runs/ks-20260629-001.md", "ok", { files: ["docs/context-pack.md"] })); } },
    { t: 15500, run: (a) => { a.mission({ activity: "skill_candidate" }); a.timeline(tl("hermes", "skill_candidate", "Candidate skill captured (NOT activated): reject-alg-none", "info", {})); } },
    { t: 16300, run: (a) => { a.mission({ activity: "release_lease", status: "green" }); a.badge("docs/context-pack.md", "clean"); a.timeline(tl("lease", "release_lease", "Lease released — mission complete", "ok", {})); a.mission({ activity: null, status: "green" }); } },
  ];
}

function scenarioRateLimit(): Step[] {
  return [
    { t: 300, run: (a) => { a.mission({ activity: "acquire_workspace_lease", status: "running" }); a.timeline(tl("lease", "acquire_workspace_lease", "Acquired lease on ks/rate-limit", "ok", {})); } },
    { t: 1100, run: (a) => { a.mission({ activity: "create_worktree" }); a.timeline(tl("orchestrator", "create_worktree", "git worktree add /workspaces/ks-002-edit", "ok", { detail: { rollbackPoint: "delete_worktree" } })); } },
    { t: 2100, run: (a) => { a.mission({ activity: "agent_plan" }); a.plan(RL_PLAN_OVERREACH); a.hot(["middleware", "routes", "limit"]); a.timeline(tl("langgraph", "agent_plan", "Intent: add_token_bucket_rate_limiter (3 files)", "info", { detail: { stdout: "planner proposed editing secrets/redis.env" } })); } },
    { t: 3100, run: (a) => { a.mission({ activity: "build_context_pack" }); a.timeline(tl("graph", "build_context_pack", "Context Pack: api middleware sub-graph", "ok", { files: ["src/api/middleware.py", "src/api/routes.py"] })); } },
    { t: 4100, run: (a) => { a.signals({ forceCompress: true }); a.tel({ vramPct: 92 }); a.signals({ embeddingPaused: true }); a.timeline(tl("graph", "build_context_pack", "VRAM 92% → embedding paused, forced compression (§9)", "info", {})); } },
    // §8 POLICY DENIAL — the orchestrator refuses the forbidden edit before Aider runs.
    { t: 5200, run: (a) => { a.mission({ activity: "policy_check", attempt: 1 }); a.badge("secrets/redis.env", "failed-validation"); a.timeline(tl("orchestrator", "policy_check", "DENIED: 'secrets/redis.env' is a forbidden path (§3/§8)", "fail", { files: ["secrets/redis.env"], detail: { input: "capability scope incl. secrets/redis.env", stderr: "policy: no touching secrets — capability rejected", rollbackPoint: "discard_plan" } })); } },
    { t: 6300, run: (a) => { a.mission({ activity: "agent_plan", status: "repairing" }); a.tel({ vramPct: 71 }); a.signals({ embeddingPaused: false }); a.badge("secrets/redis.env", "locked-workflow"); a.plan(`{\n  "intent": "add_token_bucket_rate_limiter",\n  "proposed_edits": [{ "file": "src/api/middleware.py" }, { "file": "src/api/routes.py" }],\n  "note": "read REDIS_URL from env at runtime; do NOT write secrets",\n  "capability_request": { "scope": ["src/api/middleware.py", "src/api/routes.py", "tests/test_api.py"] }\n}`); a.timeline(tl("langgraph", "agent_plan", "Re-scoped: drop secrets, read REDIS_URL from env", "info", {})); } },
    { t: 7300, run: (a) => { a.mission({ activity: "policy_check" }); a.timeline(tl("orchestrator", "policy_check", "Capability granted: write src/api/* + tests (§8)", "ok", { detail: { stdout: "scope ok, ttl 30m, approved_by orchestrator" } })); } },
    { t: 8300, run: (a) => { a.mission({ activity: "code_edit", attempt: 2 }); a.diff(RL_DIFF); a.badge("src/api/middleware.py", "modified-aider"); a.badge("src/api/routes.py", "modified-aider"); a.timeline(tl("aider", "code_edit", "Aider edited 2 files (token bucket + decorator)", "ok", { files: ["src/api/middleware.py", "src/api/routes.py"], detail: { diff: RL_DIFF } })); } },
    { t: 9400, run: (a) => { a.tel({ containers: 1, tokensPerSec: 150 }); a.signals({ aiderBlocked: true }); a.ttyClear(); a.tty("$ pytest -q tests/test_api.py\n"); } },
    { t: 10500, run: (a) => { a.mission({ status: "green" }); a.tty("....\n\n4 passed in 0.31s\n"); a.tests([{ name: "test_allows_under_limit", status: "pass", ms: 9 }, { name: "test_blocks_over_limit", status: "pass", ms: 14 }, { name: "test_refill", status: "pass", ms: 7 }, { name: "test_routes_decorated", status: "pass", ms: 5 }]); a.tel({ containers: 0 }); a.signals({ aiderBlocked: false }); a.timeline(tl("openhands", "sandbox_run", "Tests PASSED (4) on snapshot — green", "ok", { detail: { stdout: "4 passed in 0.31s" } })); } },
    { t: 11400, run: (a) => { a.mission({ activity: "qa_review" }); a.timeline(tl("qa", "qa_review", "QA passed: no secrets touched, scope clean", "ok", {})); } },
    { t: 12300, run: (a) => { a.mission({ activity: "git_commit" }); a.badge("src/api/middleware.py", "pending-commit"); a.badge("src/api/routes.py", "pending-commit"); a.timeline(tl("gitea", "git_commit", "ks-002 code: token-bucket rate limiter (e4f5a6b)", "ok", { files: ["src/api/middleware.py", "src/api/routes.py"], detail: { stdout: "commit e4f5a6b", rollbackPoint: "revert_commit e4f5a6b" } })); } },
    { t: 13100, run: (a) => { a.badge("src/api/middleware.py", "clean"); a.badge("src/api/routes.py", "clean"); } },
    { t: 13900, run: (a) => { a.mission({ activity: "graph_reindex" }); a.hot(["middleware", "routes", "limit"]); a.timeline(tl("graph", "graph_reindex", "Reindexed api sub-graph", "ok", {})); } },
    { t: 14700, run: (a) => { a.mission({ activity: "obsidian_sync" }); a.badge("docs/context-pack.md", "generated"); a.timeline(tl("obsidian", "obsidian_sync", "Vault note: Runs/ks-20260629-002.md", "ok", {})); } },
    { t: 15500, run: (a) => { a.mission({ activity: "skill_candidate" }); a.timeline(tl("hermes", "skill_candidate", "Candidate captured: api-rate-limit (NOT activated)", "info", {})); } },
    { t: 16300, run: (a) => { a.mission({ activity: "release_lease", status: "green" }); a.badge("docs/context-pack.md", "clean"); a.timeline(tl("lease", "release_lease", "Lease released — mission complete", "ok", {})); a.mission({ activity: null, status: "green" }); } },
  ];
}

function scenarioPaymentRace(): Step[] {
  const failDetail = { stderr: "AssertionError: charged twice under concurrency", stdout: "1 failed in 1.40s", rollbackPoint: "mark_failed" };
  return [
    { t: 300, run: (a) => { a.mission({ activity: "acquire_workspace_lease", status: "running" }); a.timeline(tl("lease", "acquire_workspace_lease", "Acquired lease on ks/payment-race", "ok", {})); } },
    { t: 1100, run: (a) => { a.mission({ activity: "create_worktree" }); a.timeline(tl("orchestrator", "create_worktree", "git worktree add /workspaces/ks-003-edit", "ok", { detail: { rollbackPoint: "delete_worktree" } })); } },
    { t: 2000, run: (a) => { a.mission({ activity: "agent_plan" }); a.plan(`{\n  "intent": "fix_double_charge_race",\n  "proposed_edits": [{ "file": "src/payments/charge.py" }],\n  "capability_request": { "scope": ["src/payments/charge.py"] }\n}`); a.hot(["charge", "limit", "test_pay"]); a.timeline(tl("langgraph", "agent_plan", "Intent: fix_double_charge_race", "info", {})); } },
    { t: 2900, run: (a) => { a.mission({ activity: "build_context_pack" }); a.timeline(tl("graph", "build_context_pack", "Context Pack: charge() callers + test_payments", "ok", { files: ["src/payments/charge.py"] })); } },
    // Attempt 1
    { t: 3800, run: (a) => { a.mission({ activity: "code_edit", attempt: 1 }); a.diff(PAY_DIFF); a.badge("src/payments/charge.py", "modified-aider"); a.timeline(tl("aider", "code_edit", "Aider added lock() (attempt 1/3)", "ok", { files: ["src/payments/charge.py"], detail: { diff: PAY_DIFF } })); } },
    { t: 4800, run: (a) => { a.tel({ containers: 1, tokensPerSec: 120 }); a.signals({ aiderBlocked: true }); a.ttyClear(); a.tty("$ pytest -q tests/test_payments.py -k race\n"); } },
    { t: 6000, run: (a) => { a.tty("F\n\nFAILED test_no_double_charge — charged twice under concurrency\n"); a.tests([{ name: "test_no_double_charge", status: "fail", ms: 1400 }]); a.badge("src/payments/charge.py", "failed-validation"); a.tel({ containers: 0 }); a.signals({ aiderBlocked: false }); a.timeline(tl("openhands", "sandbox_run", "Tests FAILED (attempt 1) fp=9a3f… ", "fail", { files: ["tests/test_payments.py"], detail: failDetail })); } },
    { t: 7000, run: (a) => { a.mission({ activity: "debugger_subagent", status: "repairing" }); a.timeline(tl("langgraph", "debugger_subagent", "Debugger: lock is per-process; race persists across workers", "info", { detail: { input: "failed test log" } })); } },
    // Attempt 2 — same fingerprint
    { t: 8000, run: (a) => { a.mission({ activity: "code_edit", attempt: 2 }); a.badge("src/payments/charge.py", "modified-aider"); a.timeline(tl("aider", "code_edit", "Aider retried lock() variant (attempt 2/3)", "ok", { files: ["src/payments/charge.py"], detail: { diff: PAY_DIFF } })); } },
    { t: 9000, run: (a) => { a.tel({ containers: 1 }); a.signals({ aiderBlocked: true }); a.tty("$ pytest -q tests/test_payments.py -k race\n"); } },
    { t: 10200, run: (a) => { a.tty("F\n\nFAILED test_no_double_charge — charged twice under concurrency\n"); a.tests([{ name: "test_no_double_charge", status: "fail", ms: 1390 }]); a.badge("src/payments/charge.py", "failed-validation"); a.tel({ containers: 0 }); a.signals({ aiderBlocked: false }); a.timeline(tl("openhands", "sandbox_run", "Tests FAILED (attempt 2) fp=9a3f… — IDENTICAL", "fail", { files: ["tests/test_payments.py"], detail: failDetail })); } },
    // §7 circuit breaker: same fingerprint twice -> stop, do not burn attempt 3
    { t: 11200, run: (a) => { a.mission({ activity: "loop_governor" }); a.timeline(tl("orchestrator", "loop_governor", "Circuit breaker: fp=9a3f seen 2× — stuck, not converging (§7)", "fail", { detail: { stdout: "max_same_error=2 hit; not spending attempt 3 on a loop" } })); } },
    { t: 12300, run: (a) => { a.mission({ activity: "create_worktree" }); a.timeline(tl("orchestrator", "create_worktree", "Worktree killed + reverted — no merge, canonical graph untouched", "info", { detail: { rollbackPoint: "delete_worktree + discard_worktree_changes" } })); } },
    { t: 13400, run: (a) => { a.mission({ activity: "human_review", status: "human_review" }); a.badge("src/payments/charge.py", "clean"); a.timeline(tl("orchestrator", "human_review", "Pushed structured failure report → human-review queue", "fail", { files: ["src/payments/charge.py"], detail: { stdout: "awaiting [[Directive]]: distributed lock (redis SETNX) vs DB unique constraint?", stderr: "fp=9a3f double-charge under concurrency, 2 attempts, both identical" } })); } },
    { t: 14400, run: (a) => { a.mission({ activity: "release_lease", status: "human_review" }); a.timeline(tl("lease", "release_lease", "Lease released — mission halted for human review", "info", {})); a.mission({ activity: null, status: "human_review" }); } },
  ];
}

const CK_PLAN = `{
  "intent": "ship_pci_safe_checkout_service",
  "proposed_edits": [
    { "file": "src/checkout/service.py", "change": "orchestrate charge + idempotency + refund" },
    { "file": "src/checkout/idempotency.py", "change": "idempotency-key store (dedupe charges)" },
    { "file": "src/api/routes.py", "change": "POST /checkout behind @rate_limit" },
    { "file": "src/payments/refund.py", "change": "refund path with audit" },
    { "file": "secrets/stripe.env", "change": "add STRIPE_KEY for the gateway" }
  ],
  "capability_request": {
    "tool": "aider", "capability": "write_files",
    "scope": ["src/checkout/*", "src/api/routes.py", "src/payments/refund.py", "secrets/stripe.env"]
  }
}`;

const CK_DIFF1 = `--- a/src/checkout/service.py
+++ b/src/checkout/service.py
@@
+def checkout(cart, idem_key):
+    if idempotency.seen(idem_key):
+        return idempotency.result(idem_key)
+    charge = payments.charge(cart.total, cart.token)
+    idempotency.record(idem_key, charge)
+    return charge
--- a/src/checkout/idempotency.py
+++ b/src/checkout/idempotency.py
@@
+_store = {}
+def seen(k): return k in _store
+def record(k, v): _store[k] = v`;

const CK_DIFF3 = `--- a/src/checkout/idempotency.py
+++ b/src/checkout/idempotency.py
@@
-_store = {}
-def seen(k): return k in _store
-def record(k, v): _store[k] = v
+def seen(k):     return redis.exists(f"idem:{k}")
+def record(k, v): redis.set(f"idem:{k}", v, nx=True, ex=86400)
--- a/src/payments/refund.py
+++ b/src/payments/refund.py
@@
+def refund(charge_id):
+    with lock(charge_id):                 # serialize refund vs charge
+        if already_refunded(charge_id):
+            return prior_refund(charge_id)
+        return gateway.refund(charge_id)`;

function scenarioCheckout(): Step[] {
  const fail1 = { stderr: "AssertionError: duplicate charge on retried idem-key", stdout: "1 failed, 6 passed in 0.5s", rollbackPoint: "mark_failed" };
  const fail2 = { stderr: "AssertionError: refund raced concurrent charge (fp differs)", stdout: "1 failed, 10 passed in 0.6s", rollbackPoint: "mark_failed" };
  return [
    { t: 300, run: (a) => { a.mission({ activity: "acquire_workspace_lease", status: "running" }); a.timeline(tl("lease", "acquire_workspace_lease", "Acquired exclusive lease on ks/checkout-service", "ok", { detail: { rollbackPoint: "release_lease" } })); } },
    { t: 1100, run: (a) => { a.mission({ activity: "create_worktree" }); a.timeline(tl("orchestrator", "create_worktree", "git worktree add /workspaces/ks-004-edit", "ok", { detail: { rollbackPoint: "delete_worktree" } })); } },
    { t: 2100, run: (a) => { a.mission({ activity: "agent_plan" }); a.plan(CK_PLAN); a.hot(["charge", "limit", "middleware", "routes"]); a.timeline(tl("langgraph", "agent_plan", "Intent: ship_pci_safe_checkout_service (5 files)", "info", { detail: { stdout: "planner over-reached: proposed writing secrets/stripe.env" } })); } },
    { t: 3200, run: (a) => { a.mission({ activity: "build_context_pack" }); a.timeline(tl("graph", "build_context_pack", "Context Pack: checkout + payments + api sub-graph (18 nodes)", "ok", { files: ["src/checkout/service.py", "src/payments/charge.py"], detail: { stdout: "graph(18) -> vector(9) -> rerank -> 3.1k tokens" } })); } },
    { t: 4200, run: (a) => { a.tel({ vramPct: 93 }); a.signals({ embeddingPaused: true, forceCompress: true }); a.timeline(tl("graph", "build_context_pack", "VRAM 93% → embeddings paused, Graph-RAG compression forced (§9)", "info", {})); } },
    { t: 5200, run: (a) => { a.mission({ activity: "check_skill_cache" }); a.timeline(tl("goose", "check_skill_cache", "No validated skill matches — full cycle", "info", { detail: { stdout: "cognee vector search: 0 hits ≥ 0.9" } })); } },
    // §8 policy DENIAL on secrets
    { t: 6200, run: (a) => { a.mission({ activity: "policy_check", attempt: 1 }); a.badge("secrets/stripe.env", "failed-validation"); a.timeline(tl("orchestrator", "policy_check", "DENIED: 'secrets/stripe.env' is a forbidden path (§3/§8)", "fail", { files: ["secrets/stripe.env"], detail: { input: "capability scope incl. secrets/stripe.env", stderr: "policy: no touching secrets — capability rejected", rollbackPoint: "discard_plan" } })); } },
    { t: 7300, run: (a) => { a.mission({ activity: "agent_plan", status: "repairing" }); a.tel({ vramPct: 74 }); a.signals({ embeddingPaused: false }); a.badge("secrets/stripe.env", "locked-workflow"); a.timeline(tl("langgraph", "agent_plan", "Re-scoped: read STRIPE_KEY from env, drop secrets write", "info", {})); } },
    { t: 8300, run: (a) => { a.mission({ activity: "policy_check" }); a.timeline(tl("orchestrator", "policy_check", "Capability granted: write src/checkout/*, routes.py, refund.py (§8)", "ok", { detail: { stdout: "scope ok, ttl 30m, approved_by orchestrator" } })); } },
    // Attempt 1 -> fail (idempotency)
    { t: 9300, run: (a) => { a.mission({ activity: "code_edit", attempt: 1 }); a.diff(CK_DIFF1); a.badge("src/checkout/service.py", "modified-aider"); a.badge("src/checkout/idempotency.py", "modified-aider"); a.badge("src/api/routes.py", "modified-aider"); a.timeline(tl("aider", "code_edit", "Aider edited 3 files (attempt 1/3)", "ok", { files: ["src/checkout/service.py", "src/checkout/idempotency.py", "src/api/routes.py"], detail: { diff: CK_DIFF1 } })); } },
    { t: 10500, run: (a) => { a.tel({ containers: 1, tokensPerSec: 155 }); a.signals({ aiderBlocked: true }); a.ttyClear(); a.tty("$ pytest -q tests/test_checkout.py\n"); } },
    { t: 11700, run: (a) => { a.tty("......F\n\nFAILED test_idempotent_retry — duplicate charge on retried idem-key\n"); a.tests([{ name: "test_charge_ok", status: "pass", ms: 12 }, { name: "test_rate_limited", status: "pass", ms: 9 }, { name: "test_idempotent_retry", status: "fail", ms: 21 }]); a.badge("src/checkout/idempotency.py", "failed-validation"); a.tel({ containers: 0 }); a.signals({ aiderBlocked: false }); a.timeline(tl("openhands", "sandbox_run", "Tests FAILED (attempt 1) fp=1c7a — in-memory store loses dedupe", "fail", { files: ["tests/test_checkout.py"], detail: fail1 })); } },
    { t: 12800, run: (a) => { a.mission({ activity: "debugger_subagent" }); a.timeline(tl("langgraph", "debugger_subagent", "Debugger: dedupe must survive process restart → use Redis SETNX", "info", { detail: { input: "failed test log (not source)" } })); } },
    // Attempt 2 -> fail (DIFFERENT fp: refund race) — governor allows: converging, not stuck
    { t: 13900, run: (a) => { a.mission({ activity: "code_edit", attempt: 2 }); a.diff(CK_DIFF3); a.badge("src/checkout/idempotency.py", "modified-aider"); a.badge("src/payments/refund.py", "modified-aider"); a.timeline(tl("aider", "code_edit", "Aider edited 2 files: Redis idempotency + refund (attempt 2/3)", "ok", { files: ["src/checkout/idempotency.py", "src/payments/refund.py"], detail: { diff: CK_DIFF3 } })); } },
    { t: 15000, run: (a) => { a.tel({ containers: 1, tokensPerSec: 149 }); a.signals({ aiderBlocked: true }); a.tty("$ pytest -q tests/test_checkout.py\n"); } },
    { t: 16200, run: (a) => { a.tty("..........F\n\nFAILED test_refund_concurrency — refund raced a concurrent charge\n"); a.tests([{ name: "test_idempotent_retry", status: "pass", ms: 14 }, { name: "test_refund_concurrency", status: "fail", ms: 33 }]); a.badge("src/payments/refund.py", "failed-validation"); a.tel({ containers: 0 }); a.signals({ aiderBlocked: false }); a.timeline(tl("openhands", "sandbox_run", "Tests FAILED (attempt 2) fp=8b02 — DIFFERENT error, still converging", "fail", { files: ["tests/test_checkout.py"], detail: fail2 })); } },
    { t: 17300, run: (a) => { a.mission({ activity: "loop_governor" }); a.timeline(tl("orchestrator", "loop_governor", "Governor: fp changed (1c7a→8b02) — converging, not stuck. Attempt 3 allowed (§7)", "info", { detail: { stdout: "max_same_error not hit; distinct fingerprints => progress" } })); } },
    { t: 18300, run: (a) => { a.mission({ activity: "debugger_subagent" }); a.timeline(tl("langgraph", "debugger_subagent", "Debugger: serialize refund vs charge with a per-charge lock", "info", {})); } },
    // Attempt 3 -> green (right at the ceiling)
    { t: 19400, run: (a) => { a.mission({ activity: "code_edit", attempt: 3 }); a.badge("src/payments/refund.py", "modified-aider"); a.timeline(tl("aider", "code_edit", "Aider added per-charge lock to refund (attempt 3/3)", "ok", { files: ["src/payments/refund.py"], detail: { diff: CK_DIFF3 } })); } },
    { t: 20500, run: (a) => { a.tel({ containers: 1, tokensPerSec: 152 }); a.signals({ aiderBlocked: true }); a.tty("$ pytest -q tests/test_checkout.py\n"); } },
    { t: 21700, run: (a) => { a.mission({ status: "green" }); a.tty("............\n\n12 passed in 0.71s\n"); a.tests([{ name: "test_charge_ok", status: "pass", ms: 12 }, { name: "test_rate_limited", status: "pass", ms: 9 }, { name: "test_idempotent_retry", status: "pass", ms: 14 }, { name: "test_refund_concurrency", status: "pass", ms: 18 }, { name: "test_refund_audit", status: "pass", ms: 7 }]); a.badge("src/checkout/service.py", "modified-aider"); a.badge("src/checkout/idempotency.py", "modified-aider"); a.badge("src/payments/refund.py", "modified-aider"); a.tel({ containers: 0 }); a.signals({ aiderBlocked: false }); a.timeline(tl("openhands", "sandbox_run", "Tests PASSED (12) on snapshot (attempt 3/3) — green at the ceiling", "ok", { detail: { stdout: "12 passed in 0.71s" } })); } },
    { t: 22700, run: (a) => { a.mission({ activity: "qa_review" }); a.timeline(tl("qa", "qa_review", "QA passed: PCI scope clean, no secrets written, refund audited", "ok", {})); } },
    { t: 23700, run: (a) => { a.mission({ activity: "git_commit" }); ["src/checkout/service.py", "src/checkout/idempotency.py", "src/api/routes.py", "src/payments/refund.py"].forEach((f) => a.badge(f, "pending-commit")); a.timeline(tl("gitea", "git_commit", "ks-004 code: PCI-safe checkout (charge+idempotency+refund) (c9d0e1f)", "ok", { files: ["src/checkout/service.py", "src/checkout/idempotency.py", "src/api/routes.py", "src/payments/refund.py"], detail: { stdout: "commit c9d0e1f on ks/checkout-service", rollbackPoint: "revert_commit c9d0e1f" } })); } },
    { t: 24600, run: (a) => { ["src/checkout/service.py", "src/checkout/idempotency.py", "src/api/routes.py", "src/payments/refund.py"].forEach((f) => a.badge(f, "clean")); } },
    { t: 25400, run: (a) => { a.mission({ activity: "graph_reindex" }); a.hot(["charge", "limit", "middleware", "routes"]); a.timeline(tl("graph", "graph_reindex", "Reindexed: 5 files → Memgraph edges + Qdrant chunks", "ok", { detail: { stdout: "tree-sitter -> +14 nodes, +22 edges; 9 chunks embedded" } })); } },
    { t: 26200, run: (a) => { a.mission({ activity: "obsidian_sync" }); a.badge("docs/context-pack.md", "generated"); a.timeline(tl("obsidian", "obsidian_sync", "Vault: Runs/ks-20260630-004.md + Decisions/idempotency.md", "ok", { files: ["docs/context-pack.md"] })); } },
    { t: 27000, run: (a) => { a.mission({ activity: "skill_candidate" }); a.timeline(tl("hermes", "skill_candidate", "Candidates captured (NOT activated): redis-idempotency, refund-lock", "info", {})); } },
    { t: 27900, run: (a) => { a.mission({ activity: "release_lease", status: "green" }); a.badge("docs/context-pack.md", "clean"); a.timeline(tl("lease", "release_lease", "Lease released — checkout service SHIPPED", "ok", {})); a.mission({ activity: null, status: "green" }); } },
  ];
}

const SCRIPTS: Record<string, () => Step[]> = {
  "harden-jwt": scenarioHardenJwt,
  "rate-limit": scenarioRateLimit,
  "payment-race": scenarioPaymentRace,
  "checkout-service": scenarioCheckout,
};

function buildScenario(id: string): Scenario {
  const meta = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
  return { meta, steps: (SCRIPTS[meta.id] ?? scenarioHardenJwt)() };
}

export function initialState(): AppState {
  const meta = SCENARIOS[0];
  return {
    project: { name: "keystoneos", model: meta.model, branch: "main", agentMode: "Autonomous (governed)", airgap: true },
    mission: { id: "ks-20260629-001", request: meta.request, branch: meta.branch, attempt: 0, maxAttempts: 3, activity: null, status: "idle" },
    files: INITIAL_FILES,
    telemetry: baseTelemetry(),
    timeline: [],
    graph: { nodes: GRAPH_NODES, edges: GRAPH_EDGES },
    tabs: { plan: "", diff: "", tty: "", tests: [] },
    connection: "mock",
  };
}

type Emit = (e: CPEvent) => void;

export class MockControlPlane {
  private emit: Emit;
  private timers: number[] = [];
  private telemetryTimer: number | null = null;
  private tel: Telemetry = baseTelemetry();
  private files: FileNode[] = INITIAL_FILES.map((f) => ({ ...f }));

  constructor(emit: Emit) {
    this.emit = emit;
  }

  start() {
    this.emit({ type: "snapshot", state: initialState() });
    this.tickTelemetry();
  }

  stop() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    this.telemetryTimer = null;
  }

  private setBadge(path: string, badge: FileNode["badge"]) {
    this.files = this.files.map((f) => (f.path === path ? { ...f, badge } : f));
    this.emit({ type: "files", files: this.files });
  }

  private hotGraph(ids: string[]) {
    this.emit({ type: "graph", graph: { nodes: GRAPH_NODES.map((n) => ({ ...n, hot: ids.includes(n.id) })), edges: GRAPH_EDGES } });
  }

  private tickTelemetry() {
    const jitter = (base: number, amp: number) => Math.max(0, Math.min(100, Math.round(base + (Math.random() - 0.5) * amp)));
    this.telemetryTimer = window.setInterval(() => {
      this.tel = { ...this.tel, vramPct: jitter(this.tel.vramPct, 8), ramPct: jitter(this.tel.ramPct, 5), cpuPct: jitter(this.tel.cpuPct, 25), diskIoMbs: Math.max(0, Math.round(this.tel.diskIoMbs + (Math.random() - 0.5) * 30)) };
      this.tel.signals = { ...this.tel.signals, embeddingPaused: this.tel.vramPct > 90, forceCompress: this.tel.vramPct > 85 };
      this.emit({ type: "telemetry", telemetry: this.tel });
    }, 1500);
  }

  runMission(scenarioId = "harden-jwt", lead: { name: string; emoji: string; division: string } | null = null) {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    eidSeq = 0;
    const { meta, steps } = buildScenario(scenarioId);

    this.files = INITIAL_FILES.map((f) => ({ ...f }));
    this.emit({ type: "files", files: this.files });
    this.emit({ type: "timeline:reset" });
    this.emit({ type: "tab:plan", value: "" });
    this.emit({ type: "tab:diff", value: "" });
    this.emit({ type: "tab:tty:append", value: "__CLEAR__" });
    this.emit({ type: "tab:tests", value: [] });
    this.hotGraph([]);

    const idNum = meta.id === "rate-limit" ? "002" : meta.id === "payment-race" ? "003" : meta.id === "checkout-service" ? "004" : "001";
    const mission = { id: `ks-20260629-${idNum}`, request: meta.request, branch: meta.branch, attempt: 0, maxAttempts: 3, activity: null as ActivityName | null, status: "running" as RunStatus };
    this.emit({ type: "mission", mission: { ...mission } });

    // §10 Phase 3: an Agency agent drives the plan + QA personas. Attribute those
    // saga steps to the lead and stamp it into the emitted intent.
    const ledByLead = new Set(["agent_plan", "qa_review"]);
    const api: StepApi = {
      timeline: (e) => {
        const ev = lead && ledByLead.has(e.activity) ? { ...e, summary: `${lead.emoji} ${lead.name} — ${e.summary}` } : e;
        this.emit({ type: "timeline:add", event: { id: eid(), ts: now(), ...ev } });
      },
      mission: (patch) => {
        if (patch.activity !== undefined) mission.activity = patch.activity;
        if (patch.status !== undefined) mission.status = patch.status;
        if (patch.attempt !== undefined) mission.attempt = patch.attempt;
        this.emit({ type: "mission", mission: { ...mission } });
      },
      plan: (s) =>
        this.emit({
          type: "tab:plan",
          value: lead && s.startsWith("{\n") ? s.replace("{\n", `{\n  "lead_agent": ${JSON.stringify(lead.name)},\n`) : s,
        }),
      diff: (s) => this.emit({ type: "tab:diff", value: s }),
      tty: (s) => this.emit({ type: "tab:tty:append", value: s }),
      ttyClear: () => this.emit({ type: "tab:tty:append", value: "__CLEAR__" }),
      tests: (t) => this.emit({ type: "tab:tests", value: t }),
      badge: (p, b) => this.setBadge(p, b),
      hot: (ids) => this.hotGraph(ids),
      signals: (s) => { this.tel = { ...this.tel, signals: { ...this.tel.signals, ...s } }; this.emit({ type: "telemetry", telemetry: this.tel }); },
      tel: (patch) => { this.tel = { ...this.tel, ...patch }; this.emit({ type: "telemetry", telemetry: this.tel }); },
    };

    if (lead) {
      this.emit({
        type: "timeline:add",
        event: {
          id: eid(),
          ts: now(),
          lane: "langgraph",
          activity: "agent_plan",
          summary: `${lead.emoji} ${lead.name} assigned as mission lead (${lead.division})`,
          files: [],
          state: "info",
          detail: { stdout: "Agency agent drives the plan + QA personas (§10 Phase 3)" },
        },
      });
    }

    for (const step of steps) {
      this.timers.push(window.setTimeout(() => step.run(api), step.t));
    }
  }
}
