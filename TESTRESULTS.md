# Test Results

## Python Tests
- **Module:** `workflows/tests/`
- **Result:** 46 passing tests
- **Coverage Summary:**
  - Core logic handling fingerprints: Passed
  - Lease scope verification: Passed
  - Document parsing logic: Passed
  - Router scheduling checks: Passed
  - newly added: Activities mock adapter execution: Passed
  - newly added: Path traversal and absolute path validation in Policy evaluation: Passed

## Rust Tests
- **Module:** `control-plane/`
- **Result:** 5 passing tests
- **Coverage Summary:**
  - lease logic (writes block test env): Passed
  - lease logic (reads coexist): Passed
  - router logic (reuses resident models on VRAM pressure): Passed
  - router logic (prefers small embedding models over residents if headroom allows): Passed

## Status
All tests report green. No unexpected regressions found.
