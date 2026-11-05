# Security and Compliance Audit Gate

**Status: NOT signed off as "safe". This is a partial, evidence-based gate.**

## Verified (executed, with results)
- Python capability/policy engine unit tests: 47 passed from `workflows/` (`python -m pytest -q`).
  - Absolute, UNC, drive-absolute, drive-relative (`c:rel.txt`), `%VAR%`, `~`, `..` and `::$DATA` paths are denied (any `:` is rejected).
  - Paths are normalised once (separators, trailing dots/spaces, case) and the normalised value is used for the forbidden-glob, scope and under-test checks; `src/.env `, `src/.env\`, `.ENV` are denied.
  - Mutation-proven: disabling normalisation or the `:` rejection makes tests fail.
  - Airgap: network capability denied when `airgap=true`.
- Mock labelling: with `KEYSTONE_MOCK=1` outputs are prefixed `MOCKED:` and the ledger records `mock: true`; without the flag the mock paths raise.
- Desktop UI: `npm ci` and `npm run build` (tsc + vite) succeed.

## NOT verified
- Rust build and Rust tests: cargo is not installed on the verifying host. The control-plane (including the auth changes below) has never been compiled or run by the verifier.
- Live Temporal workflows, Docker backplane, Ollama/Aider/OpenHands integrations.
- UI behaviour beyond a successful build (no interactive or end-to-end test).
- Anything that requires cargo, Docker, or a GPU.

## Control-plane auth (UNCOMPILED Rust, review before trusting)
Edits in `control-plane/src/main.rs`, written without a compiler:
- Loopback detection parses the bind address (`SocketAddr::ip().is_loopback()`; the literal host `localhost` is accepted) instead of `starts_with`. Unparseable addresses count as non-loopback.
- Non-loopback bind with `KEYSTONE_AUTH_TOKEN` unset/empty: the process refuses to start, and the request check also fails closed (an empty `Bearer ` header no longer passes).
- Route exposure: `/healthz` is intentionally open (liveness probe, returns only `ok`). `/stream` is the only other route and is the one gated.
- Browser WebSocket clients cannot set an `Authorization` header; remote use needs a non-browser client or a proxy. Not addressed here.
- The mock `run_mission` reply now reports mission status `simulated` (not `complete`) and the last timeline entry says no real work was done.
- Two unit tests were added; they have not been run.

## Other observations (unchanged, not re-audited)
- No cloud API keys in the repository; `.env.example` holds dummy values only.
- Aider is invoked with an argument array (no `shell=True`) and `--no-auto-commits`.
