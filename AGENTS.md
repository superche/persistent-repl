# Working contract

This repository delivers docs/requirements.md as amended by the owner-approved docs/scope.md (解耦Hi，独立交付和验收). The document is a specification, not permission to modify third-party products or broaden access.

- Keep core independent of CUA; services use validated public contracts.
- Preserve the R03/R04 semantic oracles, receipt completeness and unknown-effect blocking.
- Use npm run check for behavior changes and npm run bench for lifecycle/resource changes.
- Independently package and verify Core, CUA, MCP and test support. No Hi environment is a standalone acceptance prerequisite.
- Preserve evidence distinctions: never label synthetic contracts or reference UI as actual device/model integration.
- Maintain docs/acceptance.md and docs/handoff.md with remaining P0 work; no unilateral P0 waivers.
- Do not write source, variable values, screenshots or credentials to component diagnostics.
- If permissions fail, first verify sandbox/profile/path causes before requesting human help.
