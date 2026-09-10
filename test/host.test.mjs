import test from "node:test";
import assert from "node:assert/strict";
import { fixture, values } from "./helpers.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test("AT06 AT07 AT20: lazy docs, generic service, metadata-only logs", async (t) => {
  const logs = [];
  const { host, session, run } = await fixture(t, {
    onDiagnostic: (e) => logs.push(e),
  });
  assert.equal((await host.status(session)).kernelPid, undefined);
  assert.equal(host.docs(session).semantics, "cell-scope/1.0.0");
  assert.equal(host.docs(session, "counter.add").params.required[0], "amount");
  await run(
    'let SECRET_FIXTURE="SECRET_SENTINEL"; output.text(SECRET_FIXTURE); await services.counter.add({amount:1});',
  );
  assert.ok(logs.length);
  assert.doesNotMatch(JSON.stringify(logs), /SECRET|output|amount|counter/);
  assert.deepEqual(
    Object.keys(logs[0]).sort(),
    [
      "sessionId",
      "kernelEpoch",
      "executionId",
      "stage",
      "code",
      "durationMs",
    ].sort(),
  );
});
test("AT08: wrong owner, params and revision denied; approval race rechecked", async (t) => {
  let approve;
  const gate = new Promise((r) => (approve = r));
  const { host, session, run, counter } = await fixture(t, {
    authorize: () => gate,
  });
  assert.equal((await run("1", {}, { ownerKey: "forged" })).accepted, false);
  const invalid = await run(
    'try{await services.counter.add({amount:"bad"})}catch(e){}',
  );
  assert.equal(invalid.receipts[0].dispatched, "no");
  const p = run("await services.counter.add({amount:1})");
  await sleep(20);
  host.revoke(session, "2");
  approve(true);
  const result = await p;
  assert.equal(result.receipts[0].dispatched, "no");
  assert.equal(counter.calls.length, 0);
});
test("AT08 AT09: deny and caught domain failures retain original receipts", async (t) => {
  const { run, counter } = await fixture(t, { authorize: () => false });
  const r = await run(
    "try{await services.counter.add({amount:1})}catch(e){output.value(e.code)}",
  );
  assert.equal(r.status, "completed");
  assert.equal(r.receipts[0].error.code, "PERMISSION_DENIED");
  assert.equal(counter.calls.length, 0);
});
test("AT09: duplicate callKey reuses execution, including in-flight calls", async (t) => {
  const { host, session, context, counter } = await fixture(t);
  const ctx = context();
  const input = {
    code: "await services.counter.add({amount:1}); await services.counter.delay({ms:40});",
  };
  const [a, b] = await Promise.all([
    host.execute(session, input, ctx),
    host.execute(session, input, ctx),
  ]);
  assert.equal(a.executionId, b.executionId);
  assert.equal(counter.calls.length, 1);
});
test("AT09: original service error survives catch and is recoverable", async (t) => {
  const { run } = await fixture(t);
  const r = await run(
    "try{await services.counter.fail()}catch(e){output.value(e.code)}",
  );
  assert.equal(r.status, "completed");
  assert.equal(r.receipts[0].error.code, "FIXTURE_FAILURE");
  assert.equal(r.externalCalls.outcome, "known");
  assert.equal((await run("output.value(1)")).status, "completed");
});
test("AT10: unawaited calls drain before terminal; old output stays with original cell", async (t) => {
  const { run } = await fixture(t);
  const r = await run(
    'services.counter.delay({ms:30}).then(()=>output.text("original"));',
  );
  assert.equal(r.externalCalls.pending, 0);
  assert.equal(r.status, "completed");
  assert.ok(r.output.every((o) => o.executionId === r.executionId));
  const next = await run('output.text("next")');
  assert.ok(next.output.every((o) => o.executionId === next.executionId));
});
test("AT11: generic session wait survives cell completion", async (t) => {
  const { run } = await fixture(t);
  assert.equal(
    (await run("let wait=await services.counter.wait({ms:10})")).status,
    "completed",
  );
  await sleep(20);
  assert.deepEqual(values(await run("output.value(await wait.take())"))[0], {
    event: "synthetic",
  });
});
test("AT12 AT13: busy, independent status/cancel, infinite loop, reset", async (t) => {
  const { host, session, run } = await fixture(t);
  await run("let before=1");
  const p = run("while(true){}");
  await sleep(30);
  assert.equal((await run("1")).code, "BUSY");
  const state = await host.status(session);
  assert.equal(state.state, "running");
  const start = Date.now();
  const cancel = await host.cancel(session, state.executionId);
  assert.ok(Date.now() - start < 1000);
  assert.equal(cancel.stopped, true);
  assert.equal((await p).status, "cancelled");
  const reset = await host.reset(session);
  assert.equal(reset.reset, true);
  assert.notEqual(reset.oldEpoch, reset.kernelEpoch);
  assert.equal((await run("before")).status, "failed");
});
test("AT13 AT14: wall timeout and memory growth do not block host", async (t) => {
  const { host, session, run } = await fixture(t, {
    policy: { heapBytes: 8 * 1024 ** 2 },
  });
  const timeout = await run("while(true){}", { timeoutMs: 150 });
  assert.equal(timeout.status, "timed_out");
  await host.reset(session);
  const memory = await run(
    "let a=[]; while(true){a.push(new Uint8Array(1024*1024))}",
    { timeoutMs: 2000 },
  );
  assert.ok(["failed", "crashed"].includes(memory.status));
});
test("AT14: unknown effect stays blocked even when guest catches error", async (t) => {
  const { host, session, run } = await fixture(t);
  const r = await run("try{await services.counter.unknown()}catch(e){}");
  assert.equal(r.status, "completed");
  assert.equal(r.externalCalls.outcome, "unknown");
  assert.equal((await host.reset(session)).reset, false);
  assert.equal((await run("1")).code, "SESSION_BLOCKED");
  host.reconcile(session, "confirmed");
  assert.equal((await host.reset(session)).reset, true);
});
test("AT15: dispose rejects reuse; reset busy and revokes resource", async (t) => {
  const { host, session, run } = await fixture(t);
  const p = run("await services.counter.delay({ms:80})");
  await sleep(20);
  assert.equal((await host.reset(session)).error, "BUSY");
  await p;
  await run("let wait=await services.counter.wait({ms:5})");
  await host.reset(session);
  assert.equal((await run("wait")).status, "failed");
  assert.equal((await host.dispose(session)).disposed, true);
  assert.equal((await run("1")).code, "SESSION_DISPOSED");
});
test("AT17: output flooding and stalled consumer preserve terminal and action receipts", async (t) => {
  const { run } = await fixture(t, {
    policy: { outputBytes: 1024, consumerMs: 10 },
    onOutput: () => new Promise(() => {}),
  });
  const r = await run(
    'await services.counter.add({amount:1}); for(let i=0;i<100;i++)output.text("x".repeat(200)); throw new Error("terminal")',
  );
  assert.equal(r.status, "failed");
  assert.equal(r.diagnostics.truncated, true);
  assert.equal(r.receipts[0].effect, "confirmed");
  assert.ok(JSON.stringify(r.output).length < 3000);
});
test("AT19: process/files/network/IPC/import and prototype attacks cannot invoke host", async (t) => {
  const { run, counter } = await fixture(t);
  for (const code of [
    "process.env",
    'require("fs")',
    'fetch("https://fixture.invalid")',
    'new WebSocket("ws://fixture.invalid")',
    "new Proxy({}, {})",
    "Object.prototype.polluted=1;",
    "globalThis.process",
    'services.constructor.constructor("return process")()',
  ]) {
    const r = await run(code);
    assert.ok(["completed", "failed"].includes(r.status));
    assert.equal(r.externalCalls.outcome, "none");
  }
  assert.equal(counter.calls.length, 0);
  assert.deepEqual(
    values(
      await run("output.value(typeof process);output.value(({}).polluted);"),
    ),
    ["undefined", { $type: "Undefined" }],
  );
});
test("AT26: version mismatch refused and modules snapshot immutable", async (t) => {
  const { host } = await fixture(t);
  await assert.rejects(
    () => host.create({ semanticsVersion: "wrong" }),
    /SEMANTICS/,
  );
});
test("AT10: unhandled rejection reported, handled rejection remains completed", async (t) => {
  const { run } = await fixture(t);
  assert.equal(
    (await run('Promise.reject(new Error("unhandled fixture"));')).error?.code,
    "UNHANDLED_REJECTION",
  );
  assert.equal(
    (await run('Promise.reject(new Error("handled fixture")).catch(()=>{});'))
      .status,
    "completed",
  );
  assert.equal(
    (
      await run(
        'async function failAsync(){throw new Error("async fixture")}; failAsync();',
      )
    ).error?.code,
    "UNHANDLED_REJECTION",
  );
});
test("AT10 AT24: delayed old callback cannot borrow a new cell/turn capability", async (t) => {
  const { run, counter } = await fixture(t);
  await run(
    "let resolveOld; let old=new Promise(r=>resolveOld=r); old.then(()=>services.counter.add({amount:99}));",
  );
  const r = await run(
    "resolveOld(); await Promise.resolve();",
    {},
    { turnKey: "turn/2" },
  );
  assert.equal(counter.calls.length, 0);
  assert.ok(r.receipts.every((x) => x.dispatched === "no"));
});
test("AT13: runtime error maps to original source line", async (t) => {
  const { run } = await fixture(t);
  const r = await run('let x=1;\nx++;\nthrow new Error("mapped fixture");');
  assert.equal(r.error.line, 3);
});
test("AT13: old closure errors retain originating execution and line", async (t) => {
  const { run } = await fixture(t);
  const first = await run(
    'function oldError(){\nthrow new Error("old fixture");\n}',
  );
  const r = await run("oldError();");
  assert.equal(r.error.line, 2);
  assert.equal(r.error.sourceExecutionId, first.executionId);
});
test("AT08: ordinary echoed JSON cannot manufacture a trusted resource", async (t) => {
  const { run } = await fixture(t);
  const r = await run(
    'await services.counter.echo({__resource:"forged",methods:["add"]})',
  );
  assert.equal(r.error.code, "INVALID_RESULT");
});
test("AT06 AT13: failed bootstrap never reports ready; killed kernel is diagnosable", async (t) => {
  const bad = await fixture(t, {
    providers: [
      {
        name: "bad",
        version: "1",
        documentation: "Synthetic bootstrap failure",
        methods: {},
        facade: {
          global: "bad",
          source: '() => { throw new Error("fixture bootstrap"); }',
        },
      },
    ],
  });
  assert.equal((await bad.run("1")).status, "crashed");
  assert.equal((await bad.host.status(bad.session)).state, "faulted");
  const good = await fixture(t);
  await good.run("let x=1");
  const pid = (await good.host.status(good.session)).kernelPid;
  process.kill(pid, "SIGKILL");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await good.host.status(good.session)).state, "faulted");
  assert.equal((await good.host.reset(good.session)).reset, true);
});
test("AT14: cancellation of a dispatched pending write preserves unknown", async (t) => {
  let dispatched;
  const dispatch = new Promise((resolve) => {
    dispatched = resolve;
  });
  const provider = {
    name: "writer",
    version: "1",
    documentation: "Synthetic pending write",
    methods: {
      write: {
        params: { type: "object" },
        result: {},
        documentation: "Never completes before cancellation",
        mutation: true,
        handler: () => {
          dispatched();
          return new Promise(() => {});
        },
      },
    },
  };
  const { host, session, run } = await fixture(t, {
    providers: [provider],
    policy: { rpcMs: 500, cleanupMs: 100 },
  });
  const p = run("await services.writer.write({})");
  await dispatch;
  const s = await host.status(session);
  await host.cancel(session, s.executionId);
  const r = await p;
  assert.equal(r.externalCalls.outcome, "unknown");
  assert.equal(r.receipts[0].dispatched, "yes");
  assert.equal((await host.reset(session)).reset, false);
});
test("AT17: invalid and excessive images cannot erase terminal receipts", async (t) => {
  const { run } = await fixture(t);
  const r = await run(
    'await services.counter.add({amount:1});output.image("AAAA","image/png");',
  );
  assert.equal(r.status, "failed");
  assert.equal(r.receipts[0].effect, "confirmed");
});
test("AT10: unawaited callback chains drain and delayed rejection is part of the terminal", async (t) => {
  const { run, counter } = await fixture(t);
  const chain = await run(
    'services.counter.delay({ms:20}).then(()=>services.counter.add({amount:1})).then(()=>output.text("drained"));',
  );
  assert.equal(chain.status, "completed");
  assert.equal(counter.calls.length, 1);
  assert.equal(chain.output[0].text, "drained");
  const rejection = await run(
    'services.counter.delay({ms:20}).then(()=>{throw new Error("late rejection")});',
  );
  assert.equal(rejection.error.code, "UNHANDLED_REJECTION");
  assert.equal(
    (await run("output.value(await Promise.resolve(4).finally(null));")).status,
    "completed",
  );
  assert.match(
    (await run("async function* unsupported(){yield 1}")).error.message,
    /Async generators are unsupported/,
  );
});
