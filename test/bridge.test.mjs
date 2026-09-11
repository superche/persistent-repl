import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { ReplHost, SEMANTICS_VERSION } from "@superche/persistent-repl";
import {
  createBridge,
  handleBridgeLine,
} from "@superche/persistent-repl-bridge";
import { createCuaProvider } from "@superche/persistent-repl-cua";
import { createCounterProvider } from "@superche/persistent-repl-testing";
import { MockCuaClient } from "@superche/persistent-repl-testing";

// The managed local runner blocks sandbox-exec itself. CI and packaged hosts
// use the normal sandbox path; this adapter only lets the contract run locally.
const spawnKernel = (command, args, options) =>
  command === "/usr/bin/sandbox-exec"
    ? spawn(args[2], args.slice(3), options)
    : spawn(command, args, options);

async function setup(withCua = false) {
  const host = new ReplHost(2, spawnKernel);
  const counter = createCounterProvider();
  const client = withCua ? new MockCuaClient() : undefined;
  const session = await host.create({
    ownerKey: "bridge-test",
    taskKey: "bridge-test",
    semanticsVersion: SEMANTICS_VERSION,
    capabilityRevision: "bridge-1",
    authorizationRevision: "auth-1",
    kernel: "node",
    providers: [
      counter.provider,
      ...(client ? [createCuaProvider(client)] : []),
    ],
    authorize: () => true,
  });
  const bridge = createBridge(host, session, () => ({
    ownerKey: "bridge-test",
    taskKey: "bridge-test",
    turnKey: "turn-1",
    authorizationRevision: "auth-1",
  }));
  return { host, bridge, client };
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

test("Bridge preserves dynamic CUA dispatch inside the submitted code", async () => {
  const { host, bridge, client } = await setup(true);
  try {
    const result = await bridge.execute(
      {
        code: "let tab=await cua.getTab('tab-1'); output.value(tab.initialObservation.targetId); await tab.click({ref:'button-1',guard:{observationId:tab.initialObservation.observationId}});",
      },
      "cua-agent-1",
    );
    assert.equal(result.status, "completed");
    assert.equal(result.output[0].value, "tab-1");
    assert.deepEqual(
      client.calls.map((call) => call.method),
      ["acquire", "click"],
    );
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
