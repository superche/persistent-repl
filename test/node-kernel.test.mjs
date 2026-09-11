import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { ReplHost, SEMANTICS_VERSION } from "@superche/persistent-repl";
import { createCuaProvider } from "@superche/persistent-repl-cua";
import { MockCuaClient } from "@superche/persistent-repl-testing";

const spawnKernel = (command, args, options) =>
  command === "/usr/bin/sandbox-exec"
    ? spawn(args[2], args.slice(3), options)
    : spawn(command, args, options);

function context(callKey) {
  return {
    ownerKey: "node-kernel-test",
    taskKey: "node-kernel-test",
    turnKey: "turn-1",
    callKey,
    authorizationRevision: "auth-1",
  };
}

test("Node kernel retains bindings and registered modules", async () => {
  const host = new ReplHost(2, spawnKernel);
  const session = await host.create({
    ownerKey: "node-kernel-test",
    taskKey: "node-kernel-test",
    semanticsVersion: SEMANTICS_VERSION,
    capabilityRevision: "node-1",
    authorizationRevision: "auth-1",
    kernel: "node",
    modules: [
      {
        name: "fixture",
        version: "1",
        license: "MIT",
        kind: "package",
        source: "export const value=3;",
      },
    ],
    authorize: () => true,
  });
  try {
    const first = await host.execute(
      session,
      { code: "let count=1;" },
      context("1"),
    );
    assert.equal(first.status, "completed");
    const second = await host.execute(
      session,
      {
        code: "count+=1; const m=await import('fixture'); output.value([count,m.value]);",
      },
      context("2"),
    );
    assert.equal(second.status, "completed");
    assert.deepEqual(second.output[0].value, [2, 3]);
  } finally {
    await host.close();
  }
});

test("Node kernel forwards dynamic CUA calls through the bridge provider", async () => {
  const host = new ReplHost(2, spawnKernel);
  const client = new MockCuaClient();
  const session = await host.create({
    ownerKey: "node-kernel-test",
    taskKey: "node-kernel-test",
    semanticsVersion: SEMANTICS_VERSION,
    capabilityRevision: client.version,
    authorizationRevision: "auth-1",
    kernel: "node",
    providers: [createCuaProvider(client)],
    authorize: () => true,
  });
  try {
    const result = await host.execute(
      session,
      {
        code: "let tab=await cua.getTab('tab-1'); output.value(tab.initialObservation.targetId); await tab.click({ref:'button-1',guard:{observationId:tab.initialObservation.observationId}});",
      },
      context("cua-1"),
    );
    assert.equal(result.status, "completed");
    assert.equal(result.output[0].value, "tab-1");
    assert.deepEqual(
      client.calls.map((call) => call.method),
      ["acquire", "click"],
    );
    assert.equal(result.receipts.at(-1).effect, "confirmed");
  } finally {
    await host.close();
  }
});

test("Node kernel enforces a V8 timeout for synchronous loops", async () => {
  const host = new ReplHost(2, spawnKernel);
  const session = await host.create({
    ownerKey: "node-kernel-test",
    taskKey: "node-kernel-test",
    semanticsVersion: SEMANTICS_VERSION,
    capabilityRevision: "node-1",
    authorizationRevision: "auth-1",
    kernel: "node",
    authorize: () => true,
  });
  try {
    const result = await host.execute(
      session,
      { code: "while (true) {}", timeoutMs: 50 },
      context("loop-1"),
    );
    assert.equal(result.status, "timed_out");
    assert.equal(result.error.code, "WALL_DEADLINE");
  } finally {
    await host.close();
  }
});

test("Node kernel does not expose Node or dynamic code-generation capabilities", async () => {
  const host = new ReplHost(2, spawnKernel);
  const session = await host.create({
    ownerKey: "node-kernel-test",
    taskKey: "node-kernel-test",
    semanticsVersion: SEMANTICS_VERSION,
    capabilityRevision: "node-1",
    authorizationRevision: "auth-1",
    kernel: "node",
    authorize: () => true,
  });
  try {
    const result = await host.execute(
      session,
      {
        code: "output.value([typeof process,typeof require,typeof fetch,typeof Function,typeof Proxy]);",
      },
      context("globals-1"),
    );
    assert.equal(result.status, "completed");
    assert.deepEqual(result.output[0].value, [
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined",
    ]);
  } finally {
    await host.close();
  }
});
