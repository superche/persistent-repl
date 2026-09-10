import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { ReplHost, SEMANTICS_VERSION } from "@superche/persistent-repl";
import { createCounterProvider } from "@superche/persistent-repl/fixtures";
function fakeSpawner(script) {
  return () => {
    const child = new EventEmitter();
    Object.assign(child, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
    });
    child.kill = () => {
      if (child.signalCode) return;
      child.signalCode = "SIGKILL";
      queueMicrotask(() => child.emit("exit", null, "SIGKILL"));
    };
    let init, cell;
    const send = (frame) => child.stdout.write(JSON.stringify(frame) + "\n");
    child.stdin.on("data", (data) => {
      for (const line of String(data).trim().split("\n")) {
        const frame = JSON.parse(line);
        if (frame.type === "init") {
          init = frame;
          queueMicrotask(() => send({ type: "ready", epoch: init.epoch }));
        } else if (frame.type === "execute") {
          cell = frame;
          script({ child, send, init, cell, event: "execute" });
        } else script({ child, send, init, cell, event: "reply", frame });
      }
    });
    return child;
  };
}
const context = {
  ownerKey: "fixture",
  taskKey: "raw-wire",
  turnKey: "1",
  callKey: "1",
  authorizationRevision: "1",
};
const config = (provider) => ({
  ownerKey: "fixture",
  taskKey: "raw-wire",
  semanticsVersion: SEMANTICS_VERSION,
  capabilityRevision: "1",
  authorizationRevision: "1",
  providers: [provider],
  authorize: () => true,
});
test("AT09: duplicated kernel RPC and terminal frames do not redispatch or duplicate terminal", async (t) => {
  const { provider, calls } = createCounterProvider();
  const host = new ReplHost(
    1,
    fakeSpawner(({ send, init, cell, event }) => {
      if (event === "execute") {
        const rpc = {
          type: "rpc",
          epoch: init.epoch,
          capabilityRevision: "1",
          rpcId: "1",
          request: JSON.stringify({
            cell: cell.cell,
            provider: "counter",
            method: "add",
            args: { amount: 1 },
          }),
        };
        send(rpc);
        send(rpc);
      } else {
        const done = {
          type: "complete",
          epoch: init.epoch,
          cell: cell.cell,
          status: "completed",
          warnings: [],
        };
        send(done);
        send(done);
        send({
          type: "output",
          epoch: init.epoch,
          frame: JSON.stringify({
            cell: "previous-cell",
            type: "text",
            text: "late",
          }),
        });
      }
    }),
  );
  t.after(() => host.close());
  const session = await host.create(config(provider));
  const result = await host.execute(
    session,
    { code: "synthetic-wire-fixture" },
    context,
  );
  assert.equal(calls.length, 1);
  assert.equal(result.receipts.length, 1);
  assert.equal(result.output.length, 0);
  assert.equal(result.status, "completed");
});
test("AT09 AT19: malformed frame cannot erase a previously dispatched unknown write", async (t) => {
  let wire;
  const provider = {
    name: "writer",
    version: "1",
    documentation: "Synthetic wire fault",
    methods: {
      write: {
        params: { type: "object" },
        result: {},
        documentation: "Fault after dispatch",
        mutation: true,
        handler: () => {
          wire.stdout.write("not-json\n");
          return new Promise(() => {});
        },
      },
    },
  };
  const host = new ReplHost(
    1,
    fakeSpawner(({ child, send, init, cell, event }) => {
      wire = child;
      if (event === "execute")
        send({
          type: "rpc",
          epoch: init.epoch,
          capabilityRevision: "1",
          rpcId: "1",
          request: JSON.stringify({
            cell: cell.cell,
            provider: "writer",
            method: "write",
            args: {},
          }),
        });
    }),
  );
  t.after(() => host.close());
  const session = await host.create({
    ...config(provider),
    policy: { rpcMs: 100 },
  });
  const r = await host.execute(
    session,
    { code: "synthetic-wire-fixture" },
    context,
  );
  assert.equal(r.status, "crashed");
  assert.equal(r.error.code, "INVALID_FRAME");
  assert.equal(r.externalCalls.outcome, "unknown");
  assert.equal(r.receipts[0].dispatched, "yes");
});
test("AT08 AT19: stale capability revision never dispatches", async (t) => {
  const { provider, calls } = createCounterProvider();
  const host = new ReplHost(
    1,
    fakeSpawner(({ send, init, cell, event }) => {
      if (event === "execute")
        send({
          type: "rpc",
          epoch: init.epoch,
          capabilityRevision: "stale",
          rpcId: "1",
          request: JSON.stringify({
            cell: cell.cell,
            provider: "counter",
            method: "add",
            args: { amount: 1 },
          }),
        });
      else
        send({
          type: "complete",
          epoch: init.epoch,
          cell: cell.cell,
          status: "completed",
          warnings: [],
        });
    }),
  );
  t.after(() => host.close());
  const session = await host.create(config(provider));
  await host.execute(session, { code: "synthetic-wire-fixture" }, context);
  assert.equal(calls.length, 0);
});
test("AT09: reordered service completion retains correlation; terminal drain rejects new dispatch", async (t) => {
  let resolveFirst;
  const first = new Promise((r) => (resolveFirst = r));
  const calls = [];
  const replies = [];
  const provider = {
    name: "ordered",
    version: "1",
    documentation: "fixture",
    methods: {
      read: {
        params: { type: "object" },
        result: { type: "number" },
        documentation: "fixture",
        handler: async (args) => {
          calls.push(args.id);
          return args.id === 1 ? first : 2;
        },
      },
    },
  };
  let terminalSent = false;
  const host = new ReplHost(
    1,
    fakeSpawner(({ send, init, cell, event, frame }) => {
      const rpc = (id) => ({
        type: "rpc",
        epoch: init.epoch,
        capabilityRevision: "1",
        rpcId: String(id),
        request: JSON.stringify({
          cell: cell.cell,
          provider: "ordered",
          method: "read",
          args: { id },
        }),
      });
      if (event === "execute") {
        send({ ...rpc(99), epoch: "stale-epoch" });
        send(rpc(1));
        send(rpc(2));
      } else {
        replies.push([frame.rpcId, frame.response.value]);
        if (!terminalSent) {
          terminalSent = true;
          send({
            type: "complete",
            epoch: init.epoch,
            cell: cell.cell,
            status: "completed",
            warnings: [],
          });
          send(rpc(3));
          send({
            type: "complete",
            epoch: init.epoch,
            cell: cell.cell,
            status: "failed",
            warnings: [],
          });
          queueMicrotask(() => resolveFirst(1));
        }
      }
    }),
  );
  t.after(() => host.close());
  const session = await host.create(config(provider));
  const r = await host.execute(session, { code: "wire fixture" }, context);
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(replies, [
    ["2", 2],
    ["1", 1],
  ]);
  assert.equal(r.status, "completed");
  assert.deepEqual(
    r.receipts.map((x) => x.rpcId),
    ["1", "2"],
  );
  assert.equal(r.externalCalls.pending, 0);
});
