# Model tool guide — 0.1.0 / cell-scope 1.0.0

Read `repl_docs` for current capabilities. Use `repl_docs({topic:'counter.add'})` or other advertised provider.method names on demand. Docs and pure computation never start device control.

`repl_exec({code,timeoutMs?,title?})` runs one persistent cell. Use top-level await. Print intentional results with output.text/value/image. You see returned images after the call finishes; do not make new coordinate decisions inside a batch using a picture that has not yet been returned to you.

```js
let box = {n: 1};
function readOld() { return box.n; }
output.value(box);
```

Later:

```js
box.n = 2;
output.value(readOld()); // 2, same object
```

Scalars use cell scope. If cell 1 declares `let count=1; function old(){return count;}`, cell 2 can assign `count=2`, but `old()` still returns 1. Redeclaration in a later cell is legal. Same-cell const assignment/repeated lexical declaration is an error. An inherited const assignment is compatible but emits a warning recommending let.

A failed cell can retain completed new bindings and object mutations; never assume rollback. Read the error and external receipts. A caught service error remains in receipts. If effects are unknown, stop and use the host's recovery flow; do not replay the action. Reset loses all JS state and invalidates resources. It does not undo or close user applications. Running reset returns busy; cancel first. Expired/disposed sessions do not silently restart.

```js
// Exact IDs come from discovery.
output.value(await cua.getState());
```

```js
let tab = await cua.getTab('tab-1');
output.value(tab.initialObservation);
```

```js
let navigation = await tab.expectNavigation(async () =>
  tab.navigate({url: 'https://fixture.invalid/next'})
);
output.value(navigation);
```

```js
let app = await cua.getApp('app-1');
output.value(await app.getState());
// A later cell can still call the original tab object.
```

Semantic/visual inputs must carry fresh guards from the same target. A visual guard additionally needs image ID/digest and trusted model-observation confirmation. The REPL cannot grant that confirmation. Keep callbacks local; do not serialize them as page scripts. Unsupported backend methods are not a request to fall back to another domain.

No filesystem/network/shell/process/IPC globals, static cell imports/exports, dynamic Function/eval, Proxy, global mutation, audio, arbitrary artifacts or guest timers are enabled. Use registered services and registered dynamic module names. Pure functions and authorized persistent resource proxies can be reused across cells; delayed callbacks retain their original execution identity and cannot borrow a future turn.

Async generators are explicitly rejected before execution; use async functions and registered event/wait resources. Guest timers are not exposed. All ordinary unawaited RPC callback chains drain within the cell budget, and delayed unhandled rejections are reported in the original terminal.
