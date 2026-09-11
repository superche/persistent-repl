import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { ReplHost, SEMANTICS_VERSION } from "@superche/persistent-repl";
import {
  createBridge,
  handleBridgeLine,
} from "@superche/persistent-repl-bridge";
import { createCounterProvider } from "@superche/persistent-repl-testing";

// The managed local runner blocks sandbox-exec itself. CI and packaged hosts
// use the normal sandbox path; this adapter only lets the contract run locally.
const spawnKernel = (command, args, options) =>
  command === "/usr/bin/sandbox-exec"
    ? spawn(args[2], args.slice(3), options)
    : spawn(command, args, options);

async function setup() {
  const host = new ReplHost(2, spawnKernel);
  const counter = createCounterProvider();
  const session = await host.create({
    ownerKey: "bridge-test",
    taskKey: "bridge-test",
    semanticsVersion: SEMANTICS_VERSION,
    capabilityRevision: "bridge-1",
    authorizationRevision: "auth-1",
    kernel: "node",
    providers: [counter.provider],
    authorize: () => true,
  });
  const bridge = createBridge(host, session, () => ({
    ownerKey: "bridge-test",
    taskKey: "bridge-test",
    turnKey: "turn-1",
    authorizationRevision: "auth-1",
  }));
  return { host, bridge };
}

test("agent bridge executes persistent Node cells and preserves request identity", async () => {
  const { host, bridge } = await setup();
  try {
    const first = await bridge.execute(
      { code: "let n=1; output.value(n);" },
      "req-1",
    );
    assert.equal(first.status, "completed");
    assert.equal(first.output[0].value, 1);
    const second = JSON.parse(
      await handleBridgeLine(
        bridge,
        JSON.stringify({
          id: "req-2",
          method: "execute",
          params: { code: "n += 1; output.value(n);" },
        }),
      ),
    );
    assert.equal(second.id, "req-2");
    assert.equal(second.result.status, "completed");
    assert.equal(second.result.output[0].value, 2);
  } finally {
    await host.close();
  }
});

test("bridge exposes independent status and docs operations", async () => {
  const { host, bridge } = await setup();
  try {
    const status = await bridge.dispatch({ id: "s", method: "status" });
    assert.equal(status.state, "new");
    const docs = await bridge.dispatch({
      id: "d",
      method: "docs",
      params: { topic: "semantics" },
    });
    assert.equal(typeof docs, "object");
  } finally {
    await host.close();
  }
});
