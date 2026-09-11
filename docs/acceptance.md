# Acceptance evidence — 0.2.0 standalone delivery

Evidence date: 2026-09-11 (Asia/Shanghai). The standalone suite now includes the Node kernel and Bridge paths: 46 legacy Core tests, 4 Node/V8 tests, 3 Bridge tests, 7 CUA/backend-contract tests and 1 MCP wire test. Generic/CUA/Bridge/MCP/backend-contract examples remain synthetic. Environment: macOS arm64, Darwin 25.5.0 / Apple M5 Pro, Node 22.19.0. Electron UI fixture: 44.3.0. Versions/integrity: [version-manifest.json](version-manifest.json). Source revision: the Git commit carrying this report (release tag identifies the exact tree).

**Standalone automated acceptance is independent of Hi. Full component P0 acceptance remains open only for the hard-RSS subcase.** Hi-specific integration is outside the owner-approved [scope](scope.md), not a prerequisite or a passed result. Passing tests establish the named cases below, not an unconditional P0 acceptance claim. Remaining items are tracked in [handoff.md](handoff.md). `not-run` rows explicitly list covered portions and missing subcases. No P0 waiver is implied.

## Reproduction commands

- `npm ci && npm run accept`: build, 61 source tests, package-boundary checks, five examples, benchmark, five tarballs, clean bundle tests and Core-only install/execution. Machine-readable report: `artifacts/acceptance.json`; logs retain individual phase results.
- `npm run test:core`, `npm run test:node`, `npm run test:bridge`, `npm run test:cua`, `npm run test:mcp`: independently runnable suites after build.
- `npm run bench`: 200 warm pairs, 30 cold starts, 2,000 cells in two sessions, 100 lifecycle cycles and child-PID check.
- `npm run pack:all`: five package artifacts plus a consumer shrinkwrap. `npm run verify:packages`: install into temporary directories outside the source checkout and verify runtime/dependency separation.
- `npm run demo:electron`: actual macOS window and controls. CUA evidence described below is a manual execution record, not a CI claim.

## R / AT traceability

| AT | Requirements | C/S/M result | Observed evidence / remaining subcase | Product-specific D |
| --- | --- | --- | --- | --- |
| AT01 | R01/R02 | pass | `semantics.test.mjs`: multiple cells retain functions, objects, identity and mutations | — |
| AT02 | R02/R03 | pass | declaration varieties, legal redeclarations, illegal same-cell duplicate, exact [2,1,2] closure oracle | — |
| AT03 | R03/R04 | pass | inherited const warnings and every fixed R04 partial-initialization/var/function oracle | — |
| AT04 | R04 | pass | parse/dynamic-import/runtime failures retain valid state; provider call count proves no history replay | — |
| AT05 | R05 | pass | registered dynamic modules cache/reload; path/URL/builtin imports denied; static cell imports rejected explicitly | — |
| AT06 | R06/R16 | pass | docs do not start a kernel; capability/schema versions match; throwing bootstrap never ready | — |
| AT07 | R07 | pass | generic counter/echo via SDK and real MCP client; no CUA registration in generic path | — |
| AT08 | R07/R08 | pass | wrong owner/schema/revision, declined approval, revocation during approval, ordinary JSON resource forgery denied | — |
| AT09 | R07/R13 | pass | SDK/call-key and MCP request-ID dedup; duplicate RPC/terminal, reversed reply order, stale epoch, late dispatch during terminal drain and malformed-frame fixtures | — |
| AT10 | R09/R10 | pass | top-level await; unawaited callback-chain drain and delayed rejection; module async errors/dependency denial; Promise all/finally; old callbacks cannot borrow a new turn. Guest timers and async generators explicitly unavailable | — |
| AT11 | R09/R19 | pass | arm precedes navigation, event survives until later cell, callback error cleans waiter, reset cleans waits | — |
| AT12 | R10 | pass | second execution busy, independent status/cancel, two-session isolation and stress | — |
| AT13 | R11 | not-run | infinite loop, memory growth, bootstrap failure, explicit child kill and MCP EOF tested; supervisor SIGKILL during RPC and CPU loop tested; hard-RSS containment pending | — |
| AT14 | R11/R12 | pass | wall timeout/reset; cancellation retains unknown; same-cell continuation blocked; fsync intent before dispatch; SIGKILL/restart barrier, active-owner rejection and disk-failure refusal tested in recovery.test.mjs | — |
| AT15 | R12 | pass | new epoch/cleared binding, resource invalidation, no mock user-target closure, disposed session rejects reuse | Separate scope |
| AT16 | R13 | pass | undefined/BigInt/cycle/Error/Map/Set/TypedArray tags; no getter/toJSON execution, including TypedArray/DataView shadowing accessors | — |
| AT17 | R13/R14 | pass | text flooding/stalled consumer/invalid PNG and same-chunk image/terminal race retain terminal and executed-action receipts; MCP cancellation/EOF remain diagnosable | — |
| AT18 | R14/R18 | pass | CRC-validated PNG in SDK/MCP; unobserved, altered digest/bytes and stale screenshot guards refused in mock | Separate scope |
| AT19 | R15 | not-run | guest process/fs/network/IPC/import/prototype attacks and stale-revision/raw malformed-frame tests pass; module/Promise and reordered-message fixtures also pass; OS hard budget remains | — |
| AT20 | R16 | pass | diagnostic fields allowlist and synthetic secret/source scan; no component content log | — |
| AT21 | R17/R18 | pass | Browser → Native → original Browser; same-name/URL twins untouched | Separate scope |
| AT22 | R18 | pass | action executes, post-observation fails, receipt retained; observation refresh causes no input replay | Separate scope |
| AT23 | R17/R19 | pass | direct client and code adapter use identical target/args/effect; backend calls recorded (acquire + navigate on each path) | Separate scope |
| AT24 | R14/R20 | pass | independent model/preview callbacks and Electron UI image sections; old turn callback cannot borrow next turn | Separate scope |
| AT25 | R11/R20 | pass | actual Electron Run/Stop/Reset via Codex CUA; running loop stopped, preview ended, reset new epoch | Separate scope |
| AT26 | R16/version | pass | exact dependency/engine/schema inventory, version mismatch rejection, locked package + clean installation test | — |
| AT27 | R15/metrics | not-run | warm/cold/stability/lifecycle measured below; hard RSS bound/native-allocation pressure certification remains | — |

## Measured benchmark

The checked-in `benchmark.json` retains the dated reference-machine measurement. Each standalone acceptance run writes its fresh result to `artifacts/benchmark.json`; CI uploads its own measurement separately. The warm measurement includes two parallel SDK calls rather than subtracting transport overhead. It is not a CUA-task acceleration claim. An earlier compiler iteration measured ~1.2 ms warm p95; after adding tracked async transformation the relevant later result is the final JSON, not that earlier number.

The run executes 2,000 total cells in two sessions and 100 create/reset/dispose cycles. Every seen kernel PID is checked after disposal. RSS is sampled and reported, not declared an instantaneous hard cap. CI runs on its own machine; local results do not substitute for CI outcomes or signed distribution acceptance.

## Historical Electron / Codex CUA record (0.1.x)

The sample was launched with an independent local ad-hoc bundle identity (`io.superche.persistent-repl.fixture`) to avoid selecting unrelated development Electron apps. Codex's available native CUA opened that exact fixture path and returned its AX tree.

Final rc.3 revalidation completed on 2026-09-11: source `dbcecb69973dc9101820e64f6b4b8acd837f75ed`, Electron 44.3.0 / embedded Node 24.20.0. All 40 compiled runtime files were byte-equal to the delivered rc.3 package. The earlier Mac-lock interruption is superseded by this successful repeat. Exact execution IDs, epochs and observed terminal fields are recorded in [electron-ui.json](evidence/electron-ui.json).

1. The initial CUA example completed and showed browser fixture state plus an image in Model output; Host preview independently showed its images.
2. An infinite-loop cell entered `running`; the native Stop button returned `stopped: true`, `kernelAlive: false`, `cleanup: confirmed`, and `externalCleanup: confirmed`. Preview displayed `Preview stopped`.
3. Reset returned `reset: true`, different old/new epochs, invalidated bindings/modules/resources/documentation and `cleanup: confirmed`. UI state became `new`.
4. Dispose returned `disposed: true`, `stopped: true`, `kernelAlive: false`, `cleanup: confirmed`, and an empty recovery list. The sample process was then stopped.

Native AX observations were used for control/terminal proof; initial background screenshots lagged and are not presented as fresh frame evidence. This is actual sample acceptance using Codex's CUA tool, with a synthetic backend inside the sample. It does not prove a production Hi Native/Browser executor, Hi chat or real model-bridge integration.

## Additional memory investigation

The source-only [memory prototype](memory-containment.md) now demonstrates OS fatal physical-footprint enforcement for native malloc, Node Buffer and the actual sandboxed kernel, including reset recovery and preserved sandbox denials. Its limit must be applied after sandbox-exec. It does not change the default runtime, is not an RSS-equivalent cap, and does not close the remaining P0 rows without the [budget decision and follow-up validation](memory-policy-proposal.md).

## 0.2 package independence evidence

The source suites cover 46 legacy Core cases, 4 Node/V8 cases, 3 Bridge cases, 7 CUA/backend-contract cases and 1 MCP wire case. Package-boundary checks forbid reversed adapter dependencies; clean distribution tests rerun all 61 cases through installed public exports. The separate Core-only consumer verifies that CUA/MCP/testing/Electron/MCP SDK are not resolvable, executes persistent values, resets, and checks the old kernel exited. These are component checks and require no product account, endpoint or SDK. The reusable black-box backend contract labels its fixture evidence explicitly.

## Current standalone reference-host UI (0.2.0)

Actual Codex native CUA selected the exact Electron reference window running the new workspace packages. Run completed with browser state/image in the model-output section and independent preview images. A finite test session then ran an infinite-loop cell, observed running, and stopped it: kernelAlive false, internal/external cleanup confirmed, preview stopped. Reset returned new epochs and invalidation; Dispose reported no live kernel and confirmed cleanup. The sample process was stopped after verification. Native events and screenshots lagged; retries and exact execution/epoch values are retained in [electron-ui-0.2.json](evidence/electron-ui-0.2.json), with SHA-256 for every compiled package file. This verifies the independent synthetic reference host, without any Hi environment or device/model integration claim.

The checked-in [standalone acceptance](evidence/standalone-acceptance.json) and [clean package checks](evidence/standalone-packages.json) record the local run. Fresh CI records are published per commit and Node version. Historical evidence files retain their original version labels.
