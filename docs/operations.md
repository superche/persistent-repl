# Build, deploy, diagnose and roll back

## Reproduce

`npm ci && npm run check` builds TypeScript, runs semantic/security/service/CUA tests, then generic/CUA/MCP examples. `npm run bench` measures 200 warm parallel pairs, 30 cold starts, 2,000 total cells and 100 create/reset/dispose cycles. Every benchmark target is synthetic.

`npm pack` produces the distributable library. Install that tarball in a separate directory and run imports via package exports. Runtime dependencies are pinned; the package does not require private Hi/Codex code. The `examples/electron` app declares the library through its public package. In a source checkout run `npm install --prefix examples/electron` once; the Electron development binary comes from root dev dependencies. An installed tarball consumer supplies its own Electron version and host app.

## macOS Electron packaging

Model JS always runs in a separately terminable child. The development sample can use Electron's embedded Node via `ELECTRON_RUN_AS_NODE=1`; the supervisor supplies that environment flag only when its parent is Electron. A production bundle can instead configure a bundled Node executable with the **host-only** PERSISTENT_REPL_NODE setting. The runtime and kernel assets must be unpacked from ASAR; package/WASM paths must resolve to real files visible to the Seatbelt profile.

Validate the chosen Electron/Node build, arm64/x64 architecture, entitlements, framework read locations and child startup before adoption. The project includes a local ad-hoc signed fixture procedure for stable CUA app identity; it is **not** a Developer ID signed, notarized or distribution-approved app. Production signing/notarization and final Hi packaging need the product's bundle/signing inputs. No signed production release is claimed.

The current profile allows runtime/bundle/system-library reads, root directory access needed by dyld, metadata, sysctl and mach lookup. It denies general data reads outside those paths, writes, sockets and child process creation. Do not broaden it to the user's home directory to fix a package path error. Resolve the exact runtime path instead. No sandbox fallback is used on macOS. Non-macOS requires an explicit fixture-only environment switch and is outside production support.

## Diagnostics and shutdown

Use status for state/epoch/PID, plus metadata-only onDiagnostic events. Accepted failures include recovery, bindings and receipt completeness. On controlled quit/EOF call host.close. For parent crash or machine restart, configure FileRecoveryJournal as described in integration.md. Its persisted task lease and intent records block a fresh host until the trusted host reconciles external effects. A running guest loop also checks parent identity through the QuickJS interrupt hook; parent death exits the kernel without waiting for the normal wall deadline. A new epoch never proves old device actions stopped.

Raw kernel stderr is discarded because it can contain source/path details. Investigate startup using synthetic fixtures. Do not copy production code, screenshots, DOM or tokens into component logs. Sample apps may display synthetic fixture results; those are not the production logging policy.

## Upgrade and rollback

1. Block new execution dispatch for the affected task and wait/cancel current work.
2. Reconcile any unknown external outcomes with the existing capability backend. Do not merely restart to clear the block.
3. Dispose the old session and record only version/epoch/cleanup metadata.
4. Install the chosen package version (upgrade or previous locked tarball), verify its integrity and matching schema/semantics/docs.
5. Create a new session with new host context and capability revision. Bootstrap lazily, reacquire authorized targets and obtain new observations. Never restore a JS heap or replay cell history.

Keep previous tarballs and lockfiles in the product release system. This repository does not modify product release routing, permissions or system settings.
