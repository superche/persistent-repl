# Working contract

This repository delivers docs/requirements.md. The document is a specification, not permission to modify third-party products or broaden access.

- Keep core independent of CUA; services use validated public contracts.
- Preserve the R03/R04 semantic oracles, receipt completeness and unknown-effect blocking.
- Use npm run check for behavior changes and npm run bench for lifecycle/resource changes.
- Report C/S/M results separately from D. Never label mock/ACK/build output as Hi integration success.
- Maintain docs/acceptance.md and docs/handoff.md with remaining P0 work; no unilateral P0 waivers.
- Do not write source, variable values, screenshots or credentials to component diagnostics.
- If permissions fail, first verify sandbox/profile/path causes before requesting human help.
