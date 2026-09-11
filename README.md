# Persistent REPL — standalone SDK and adapters

Version **0.2.0**. Host-independent persistent JavaScript execution with an isolated kernel, typed services, CUA, an agent-neutral execute Bridge and MCP adapters. The user approved independent delivery and acceptance on 2026-09-11: **“解耦Hi，独立交付和验收”**. No Hi repository, account, SDK or model endpoint is needed to install, run or test this project. See [scope](docs/scope.md).

## Packages

| Package | Purpose | Required project peers |
| --- | --- | --- |
| `@superche/persistent-repl` | Core, SDK, isolation, recovery, typed services | None |
| `@superche/persistent-repl-cua` | Backend-neutral `CuaClient` and provider | Core |
| `@superche/persistent-repl-bridge` | Agent-neutral `execute(code)` and JSONL request bridge | Core |
| `@superche/persistent-repl-mcp` | MCP embedding and generic stdio CLI | Core |
| `@superche/persistent-repl-testing` | Synthetic counter/CUA fixtures and backend contract harness | Core + CUA |

Core does not install the CUA/MCP/testing packages, MCP SDK or Electron. The independent Electron reference host lives in `examples/electron`; it consumes public packages and synthetic test support. Device drivers and product adapters can be supplied by any host.

## Reproduce from source

```sh
npm ci
npm run accept
```

This builds and tests every package, checks dependency direction, runs SDK/CUA/Bridge/MCP/backend-contract examples, measures lifecycle/performance, packs five tarballs, and tests both a clean bundle installation and a Core-only installation outside the checkout. Results and logs are under `artifacts/`. macOS is required for the supported Seatbelt isolation path. Node 22.19.0 and 24.18.0 are the CI reference versions.

The automated checks can pass while **full P0 memory acceptance remains open**: the current RSS watchdog is not an instantaneous process RSS cap. Decoupling Hi does not approve the experimental footprint alternative. See [acceptance](docs/acceptance.md) and [remaining work](docs/handoff.md).

## Run a delivered bundle

Unzip the standalone delivery bundle, then:

```sh
npm ci
npm test
npm run demo:core
npm run demo:cua
npm run demo:bridge
npm run demo:mcp
npm run demo:contract
```

The bundle contains five local `.tgz` dependencies and its own `npm-shrinkwrap.json`; private package publication is unnecessary. Third-party dependencies resolve through the public npm registry. To install only Core in another project, use `npm install /path/to/superche-persistent-repl-0.2.0.tgz`. Adapters are optional and require the matching Core peer. See [migration from 0.1](docs/migration-0.2.md).

## Minimal Core example

```js
import { ReplHost, SEMANTICS_VERSION } from '@superche/persistent-repl';
const host = new ReplHost();
const session = await host.create({
  ownerKey: 'local-user', taskKey: 'task-1',
  semanticsVersion: SEMANTICS_VERSION,
  capabilityRevision: '1', authorizationRevision: '1',
  kernel: 'node', // persistent V8 REPL; use 'quickjs' for the compatibility kernel
  authorize: () => true, // Reference application; replace with your host policy.
});
const context = (callKey) => ({
  ownerKey: 'local-user', taskKey: 'task-1', turnKey: 'turn-1',
  callKey, authorizationRevision: '1',
});
try {
  await host.execute(session, { code: 'let n=40;' }, context('1'));
  const result = await host.execute(session, { code: 'n+=2; output.value(n);' }, context('2'));
  console.log(result.output);
} finally {
  await host.close();
}
```

Host identity, authorization, backend connections and image consumers are injected by trusted host code. The kernel cannot select credentials or grant itself authority. Unknown external effects require host reconciliation; reset does not roll back device actions. Configure `FileRecoveryJournal` for host tasks that persist real effects across restarts.

## Agent-neutral Bridge

The Bridge keeps the agent contract at `execute({ code, timeoutMs, title })`. It forwards code into one persistent Core session and returns the Core result unchanged, so `await cua.getTab(...)` is dispatched dynamically by the trusted CUA provider during execution. It does not guess or statically translate tool calls:

```js
import { createBridge } from '@superche/persistent-repl-bridge';
const bridge = createBridge(host, session, () => trustedContextWithoutCallKey);
const result = await bridge.execute({ code: 'const tab=await cua.getTab("tab-1"); output.value(tab.initialObservation);' }, 'agent-request-1');
```

`handleBridgeLine` provides the same contract over JSONL for a coding agent or process supervisor. A real CUA endpoint is still supplied by the adopting host through the public `CuaClient` interface; the repository's fixture is synthetic evidence only.

## Reference host and backend contract

From the source workspace, `npm run demo:electron` opens the Electron reference host. Its Model output and Host preview are separate consumers; the backend is explicitly synthetic. `npm run demo:contract` runs the reusable acquisition/lifecycle contract. To test a different backend: `node examples/backend-contract.mjs /absolute/path/to/owned-fixture.mjs`. See [backend conformance](docs/backend-conformance.md). Device action and model-image-consumption verification must report their own evidence; the mock does not certify them.

## Documentation

- [Approved scope and independence boundaries](docs/scope.md)
- [Design and semantics](docs/design.md)
- [SDK/provider/CUA integration](docs/integration.md)
- [Model tool guide](docs/model-guide.md)
- [Build, deployment and rollback](docs/operations.md)
- [AT01–AT27 and verification evidence](docs/acceptance.md)
- [Memory containment and prototype](docs/memory-containment.md)
- [Original attachment, preserved](docs/requirements.md)
- [Third-party inventory](THIRD_PARTY_LICENSES.md)

MIT licensed. No Hi or Codex private implementation is included.
