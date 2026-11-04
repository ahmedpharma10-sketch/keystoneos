# Test Plan

## Objective
Ensure the system core logic handles simulated missing local environments safely using mock/stub integrations, validates security policies, and has functional unit/integration test coverage.

## Scope
- Security token validation for paths (no directory traversal, no secrets).
- Missing environment handlers via mocked fallback (Aider & Understand-Anything).
- Mock integration stream in control-plane for `run_mission`.
- Validations that pre-existing functionality is not broken.

## Strategy
1. **Unit tests in Python:** Ensure `test_activities_mock.py` and `test_policy_security.py` cover the fallback cases and security features. Run existing test suites.
2. **Unit tests in Rust:** Re-verify router scheduling picks under varied mock loads.
3. **Integration tests:** We leverage the UI standalone environment (using the mocked JS control plane or running the compiled Mock integration rust plane).
