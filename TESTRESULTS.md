# Test Results

Supervisor run (owner-accepted/keystoneos-fixes). Only what was actually executed is reported as passing.

## Python tests (RUN)
- **Command:** `cd workflows && python -m pytest -q` (Python 3.12). Equivalent: `cd workflows && python -m unittest discover tests`.
- **Result:** 47 passed (22 subtests passed) with pytest; 47 tests OK with unittest.
- **Working directory matters:** the tests import `lib.*` / `activities.*` relative to `workflows/`. Running `pytest` from the repository root fails collection of `test_activities.py` and `test_activities_mock.py` with `No module named activities`. Always run from `workflows/`.
- **Path policy:** `test_advanced_path_bypasses_denied` (now inside the test class, so it actually runs) covers drive-relative (`c:rel.txt`), drive-absolute, UNC, `%VAR%`, `~`, `::$DATA`, trailing space/dot/backslash/slash and case variants of `.env`, `secrets/`, `*.pem`.
- **Mutation checks (performed):** (a) matching the forbidden globs against the raw string instead of the normalised one -> 11 test failures; (b) removing the `:` rejection -> 6 test failures; policy.py restored after each, suite green again.

## Frontend build (RUN)
- `cd apps/desktop && npm ci && npm run build` (tsc + vite): succeeds. Build only; the UI was not exercised interactively.

## Rust tests (NOT RUN)
- `cargo` is not installed on the host used for this verification. The previously claimed "5 passing" Rust tests were never executed here and are NOT claimed.
- Rust sources changed in this commit (`control-plane/src/main.rs`: fail-closed auth, parsed loopback check, simulated status, two new unit tests) were **NOT compiled and NOT tested**.
