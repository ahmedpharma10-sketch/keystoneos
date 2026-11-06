# Deviations and Assumptions

1. **Rust Cargo Missing Crates SDK/Temporal Integrations:**
   - Without Temporal rust SDK installed/available in `Cargo.toml`, a direct temporal client wasn't feasible. The `TODO(integration)` was addressed using a simulated event stream matching the required output structure, satisfying the integration fallback without blocking the build.

2. **Environment Variable Configuration:**
   - `.env.example` created specifically targeting the single-tenant local configuration per project spec instead of generalizing for cloud services (since cloud services are expressly forbidden).

3. **Tool Installation Verification (`aider`, `understand-anything`):**
   - Implemented via `shutil.which` wrapping fallback adapter behaviors as explicitly specified by "using mock or local adapters where models or credentials are absent".
