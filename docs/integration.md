# Host and service integration

## SDK contract

Use the package root exports; the complete interfaces are in the shipped `dist/types.d.ts`. `ReplHost` exposes create, execute, status, cancel, reset, dispose, close, docs, revoke, authorizeRevision and reconcile. Identity and authority come from your trusted model bridge. Never accept model-provided owner/task/revision or backend connection settings.

1. Create a session with a fixed semantics/capability revision, module snapshots, provider snapshots and authorization hook.
2. Fill owner/task/turn/call keys for every invocation. Retain `SessionRef` in your host, not model arguments. Use an AbortSignal for user cancellation.
3. Authorize normalized, immutable arguments. Approval false/reject/timeout stops dispatch; revision is checked again after approval. Call `revoke` synchronously when authorization tightens; use `authorizeRevision` after the host establishes a fresh grant. Existing computation memory remains until reset/dispose.
4. Consume output by session/epoch/execution/item ID. Never infer effect success from `status: completed`. Inspect all receipts, including errors caught by guest code.
5. On cancellation, inspect known/unknown state. After backend reconciliation, call the host-only `reconcile`; then reset if the kernel was discarded.
6. On app/transport shutdown, await dispose/close. If the entire host process is forcibly killed, external release confirmation belongs to the product's durable control service; this component cannot reconstruct it from a lost in-memory session.

## Register a provider

A method includes params/result JSON schemas, documentation, an optional mutation hint and a trusted handler. Schemas are compiled at registration. Values crossing into the kernel must be JSON or resources returned from `HandlerContext.resource`; accessor results are rejected. Internal handler credentials never enter the kernel.

```js
const provider = {
  name: 'math', version: '1.0.0', documentation: 'Pure synthetic math',
  methods: {
    double: {
      params: {type:'object',properties:{n:{type:'number'}},required:['n'],additionalProperties:false},
      result: {type:'number'}, documentation: 'Return twice n',
      handler: ({n}, context) => n * 2,
    },
  },
  dispose: async (sessionId, reason) => 'confirmed',
};
```

Handlers can use `context.receipt()` to retain original domain phase, dispatched/effect state and post-observation. A thrown error carries code/message/stage/recoverability. A host resource includes target/kind/deadline, value, methods and cleanup. Each use rechecks scope, expiry, schema and authorization. Resource methods receive the new invocation's trusted context; the value itself does not grant permission.

Module registration takes `{name,version,license,source,kind,reload}`. Workspace access is not implied by workspaceScopeKey. If the product reads source files, it must verify canonical paths/dependency manifests before registration. There is no guest filesystem resolver. Runtime configuration changes require a new session/revision, not mutation of an active handler.

## CUA client contract

Import `CuaClient`, `TargetRef`, `Observation`, `Guard`, `CuaReceipt`, `WaiterRef` and `PreviewEvent` from `@superche/persistent-repl/cua`. Supply one client instance to `createCuaProvider(client)`. The existing action tool can invoke this same client interface.

The client implements discover/acquire/invoke, arm/awaitWait/cancelWait, release/stop/finish and cleanupSession. It owns real target identities, leases, write serialization, capability support, observation revisions/TTL, input release and effect verification. A real client must not trust caller-provided target ID/guard without checking the ownership in the invocation context. Backends must reject partial/unknown input until reconciled.

The facade provides `cua.getState`, `getTab`, `getBrowser`, `getApp`, `createTab`, `stop`, `finish`. Acquisition returns the first observation on `initialObservation`. Target methods are schema-driven and limited to backend-declared capabilities. `expectNavigation` arms first, runs its callback **inside the kernel**, takes the registered result and cancels the waiter in `finally`. Wait resources can cross cells; waiting does not hold the backend's mutation lock.

## Two image channels

`TrustedSessionConfig.onOutput` is model task output. `MockCuaClient(onPreview)` demonstrates a separate product preview/lifecycle consumer carrying owner/task/session/target. Production clients should provide an equivalent callback. The Electron example routes them to separate UI sections.

PNG output does not grant visual input permission. The mock's `acknowledgeModelImage` is a synthetic trusted bridge method, not a model service. A real model bridge must acknowledge image consumption only when the image actually entered the intended model context. Preview display and retained bytes do not satisfy that condition. Backend invoke validates image ID, digest, observation and target; callers cannot reuse a screenshot for another resource.

## MCP

`persistent-repl-mcp` exposes repl_exec/reset/docs/status/cancel. A transport owns one host-bound session. The supplied CLI installs only the synthetic counter. `createMcpServer` embeds the same supervisor in a product transport with a host context factory. stdout contains protocol only. Input buffering is capped at 8 MB; code has a separate 64 KiB check. Request-ID deduplication maps to host-generated call keys for the transport lifetime. Cancellation signals invoke the same cancel path; EOF closes the host. Unsupported tool/argument errors are protocol errors; accepted cell failures are tool results with `isError` and structured receipts.

Tested negotiation is 2025-11-25. The SDK can negotiate older versions, but older-version projection is not yet an acceptance claim.
