# Persistent REPL + CUA

A persistent JavaScript component for local agent/Electron hosts. The core runs independently of CUA. A separate adapter wraps an injected browser/native capability client; a synthetic backend is included.

**Delivery version: 0.1.0.** This is an independently runnable implementation and integration candidate. See [acceptance](docs/acceptance.md) for measured coverage and remaining P0 acceptance work. Hi production integration is blocked on the interfaces/environment listed in [handoff](docs/handoff.md); mock results do not establish Gate B completion.

## Run

macOS arm64, Node 22.19.0 (also validate your embedding runtime before distribution):

```sh
npm ci
npm run check
npm run bench
npm install --prefix examples/electron
npm run demo:electron
```

The three entry points are `examples/generic.mjs`, `examples/mcp-client.mjs` (starts the real stdio MCP server/client), and `examples/electron`. `npm run demo:cua` demonstrates Browser → Native → the original Browser using the synthetic backend. No device permissions or API credentials are needed for these fixtures.

## Public SDK

```js
import { ReplHost, SEMANTICS_VERSION } from '@superche/persistent-repl';
import { createCounterProvider } from '@superche/persistent-repl/fixtures';

const host = new ReplHost();
const session = await host.create({
  ownerKey: 'trusted-user', taskKey: 'trusted-task',
  semanticsVersion: SEMANTICS_VERSION,
  capabilityRevision: 'counter/1', authorizationRevision: 'auth/1',
  providers: [createCounterProvider().provider],
  authorize: () => true, // Synthetic example. Product hosts supply their own policy.
});
const context = callKey => ({
  ownerKey: 'trusted-user', taskKey: 'trusted-task', turnKey: 'turn/1',
  callKey, authorizationRevision: 'auth/1',
});
await host.execute(session, { code: 'let count = 1;' }, context('call/1'));
const result = await host.execute(session, {
  code: 'count += await services.counter.add({amount: 2}); output.value(count);',
}, context('call/2'));
console.log(result);
await host.close();
```

Keep `SessionRef`, owner/task/turn/call identity, authorization revisions and backend endpoints inside the trusted host. The model supplies only code and bounded execution options. Provider registration includes JSON schemas, handlers, documentation and cleanup. Public TypeScript declarations ship in the package.

## Important behavior

- Each cell has its own lexical environment. Old closures keep their scalar bindings; object identity/mutations are shared. The exact R03/R04 examples are executable tests.
- Output is explicit: `output.text`, `output.value`, `output.image(base64, 'image/png')`. There is no implicit last-expression re-evaluation.
- Code runs in a QuickJS/WASM kernel inside a separately terminable process. macOS Seatbelt restricts that process. There is no Node `vm` security claim, guest process/env/fs/network/shell, automatic npm installation, or backend driver inside core.
- `cancel` stops code and may discard the kernel. `reset` creates a lazy new epoch and revokes resources. `cua.stop` ends external control. `dispose` ends the REPL session. None rolls back an OS effect.
- External receipts survive caught errors. Unknown effects block continuation until the **trusted host** reconciles them. Resumable product tasks configure `FileRecoveryJournal` for durable intent and crash/restart barriers.
- The fixture CLI exposes a synthetic counter only. The product supplies its own providers/authentication; this package does not turn on a public network server.

## Documentation

- [Design, semantics, state machine and limits](docs/design.md)
- [Host/service and CUA integration](docs/integration.md)
- [Model instructions](docs/model-guide.md)
- [Deployment, diagnosis, upgrade and rollback](docs/operations.md)
- [AT01–AT27 coverage and evidence](docs/acceptance.md)
- [Memory containment evidence and experimental prototype](docs/memory-containment.md)
- [Gate B inputs and remaining work](docs/handoff.md)
- [Original requirements](docs/requirements.md)
- [Dependency inventory and licenses](THIRD_PARTY_LICENSES.md)

MIT licensed. No Codex private source or Hi private implementation is included.
