# Acceptance evidence — 0.1.0 integration candidate

Evidence date: 2026-09-10. All automated target/service data is synthetic. Environment: macOS arm64, Darwin 25.5.0 / Apple M5 Pro, Node 22.19.0. Electron UI fixture: 44.3.0. Versions/integrity: [version-manifest.json](version-manifest.json). Source revision: the Git commit carrying this report (release tag identifies the exact tree).

**Gate A: not fully closed. Gate B: blocked.** Passing tests establish the named cases below, not an unconditional P0 acceptance claim. Remaining items are tracked in [handoff.md](handoff.md). `not-run` rows explicitly list covered portions and missing subcases. No P0 waiver is implied.

## Reproduction commands

- `npm ci && npm run check`: compile + node:test + generic demo + CUA demo + real MCP client.
- `npm run bench`: 200 warm pairs, 30 cold starts, 2,000 cells in two sessions, 100 lifecycle cycles and child-PID check.
- `npm pack`: build artifact. Install the tarball in a clean directory, then run its generic and CUA examples through public package imports.
- `npm install --prefix examples/electron && npm run demo:electron`: actual macOS window and controls. CUA evidence described below is a manual execution record, not a CI claim.

## R / AT traceability

| AT | Requirements | C/S/M result | Observed evidence / remaining subcase | D |
| --- | --- | --- | --- | --- |
| AT01 | R01/R02 | pass | `semantics.test.mjs`: multiple cells retain functions, objects, identity and mutations | — |
| AT02 | R02/R03 | pass | declaration varieties, legal redeclarations, illegal same-cell duplicate, exact [2,1,2] closure oracle | — |
| AT03 | R03/R04 | pass | inherited const warnings and every fixed R04 partial-initialization/var/function oracle | — |
| AT04 | R04 | pass | parse/dynamic-import/runtime failures retain valid state; provider call count proves no history replay | — |
| AT05 | R05 | pass | registered dynamic modules cache/reload; path/URL/builtin imports denied; static cell imports rejected explicitly | — |
| AT06 | R06/R16 | pass | docs do not start a kernel; capability/schema versions match; throwing bootstrap never ready | — |
| AT07 | R07 | pass | generic counter/echo via SDK and real MCP client; no CUA registration in generic path | — |
| AT08 | R07/R08 | pass | wrong owner/schema/revision, declined approval, revocation during approval, ordinary JSON resource forgery denied | — |
| AT09 | R07/R13 | not-run | SDK/in-flight call-key, raw MCP request-ID, duplicate kernel RPC/terminal and malformed-frame tests pass; full reordered-frame injection remains | — |
| AT10 | R09/R10 | not-run | top-level await, unawaited RPC drain, unhandled rejection, old callback non-borrowing pass; broader async/module adversarial audit remains | — |
| AT11 | R09/R19 | pass | arm precedes navigation, event survives until later cell, callback error cleans waiter, reset cleans waits | — |
| AT12 | R10 | pass | second execution busy, independent status/cancel, two-session isolation and stress | — |
| AT13 | R11 | not-run | infinite loop, memory growth, bootstrap failure, explicit child kill and MCP EOF tested; supervisor-crash recovery/hard-RSS containment pending | — |
| AT14 | R11/R12 | not-run | wall timeout reset; in-flight write cancellation and caught unknown outcome block reset/continuation; durable restart barrier pending | — |
| AT15 | R12 | pass | new epoch/cleared binding, resource invalidation, no mock user-target closure, disposed session rejects reuse | blocked |
| AT16 | R13 | pass | undefined/BigInt/cycle/Error/Map/Set/TypedArray tags; no getter/toJSON execution | — |
| AT17 | R13/R14 | pass | text flooding/stalled consumer/invalid PNG retain terminal and executed-action receipts; MCP cancellation/EOF remain diagnosable | — |
| AT18 | R14/R18 | pass | CRC-validated PNG in SDK/MCP; unobserved, altered digest/bytes and stale screenshot guards refused in mock | blocked |
| AT19 | R15 | not-run | guest process/fs/network/IPC/import/prototype attacks and stale-revision/raw malformed-frame tests pass; OS hard budget and remaining adversarial combinations remain | — |
| AT20 | R16 | pass | diagnostic fields allowlist and synthetic secret/source scan; no component content log | — |
| AT21 | R17/R18 | pass | Browser → Native → original Browser; same-name/URL twins untouched | blocked |
| AT22 | R18 | pass | action executes, post-observation fails, receipt retained; observation refresh causes no input replay | blocked |
| AT23 | R17/R19 | pass | direct client and code adapter use identical target/args/effect; backend calls recorded (acquire + navigate on each path) | blocked |
| AT24 | R14/R20 | pass | independent model/preview callbacks and Electron UI image sections; old turn callback cannot borrow next turn | blocked |
| AT25 | R11/R20 | pass | actual Electron Run/Stop/Reset via Codex CUA; running loop stopped, preview ended, reset new epoch | blocked |
| AT26 | R16/version | pass | exact dependency/engine/schema inventory, version mismatch rejection, locked package + clean installation test | — |
| AT27 | R15/metrics | not-run | warm/cold/stability/lifecycle measured below; hard RSS bound/native-allocation pressure certification remains | — |

## Measured benchmark

The checked-in `benchmark.json` is the final run's machine-readable result. The warm measurement includes two parallel SDK calls rather than subtracting transport overhead. It is not a CUA-task acceleration claim. An earlier compiler iteration measured ~1.2 ms warm p95; after adding tracked async transformation the relevant later result is the final JSON, not that earlier number.

The run executes 2,000 total cells in two sessions and 100 create/reset/dispose cycles. Every seen kernel PID is checked after disposal. RSS is sampled and reported, not declared an instantaneous hard cap. CI runs on its own machine; local results do not substitute for CI outcomes or signed distribution acceptance.

## Actual Electron / Codex CUA record

The sample was launched with an independent local ad-hoc bundle identity (`io.superche.persistent-repl.fixture`) to avoid selecting unrelated development Electron apps. Codex's available native CUA opened that exact fixture path and returned its AX tree.

1. The initial CUA example completed and showed browser fixture state plus an image in Model output; Host preview independently showed its images.
2. An infinite-loop cell entered `running`; the native Stop button returned `stopped: true`, `kernelAlive: false`, `cleanup: confirmed`, and `externalCleanup: confirmed`. Preview displayed `Preview stopped`.
3. Reset returned `reset: true`, different old/new epochs, invalidated bindings/modules/resources/documentation and `cleanup: confirmed`. UI state became `new`.

Native AX observations were used for control/terminal proof; initial background screenshots lagged and are not presented as fresh frame evidence. This is actual sample acceptance using Codex's CUA tool, with a synthetic backend inside the sample. It does not prove a production Hi Native/Browser executor, Hi chat or real model-bridge integration.
