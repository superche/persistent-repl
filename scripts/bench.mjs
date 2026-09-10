import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import {
  ReplHost,
  SEMANTICS_VERSION,
  DEFAULT_POLICY,
} from "@superche/persistent-repl";
const host = new ReplHost();
let call = 0;
const config = {
  ownerKey: "benchmark-fixture",
  taskKey: "benchmark",
  semanticsVersion: SEMANTICS_VERSION,
  capabilityRevision: "1",
  authorizationRevision: "1",
  authorize: () => true,
  policy: { maxRetainedCalls: 2048 },
};
const ctx = () => ({
  ownerKey: config.ownerKey,
  taskKey: config.taskKey,
  turnKey: "1",
  callKey: String(++call),
  authorizationRevision: "1",
});
const execute = (session, code) => host.execute(session, { code }, ctx());
const warm = [],
  cold = [],
  pids = new Set();
let maxRss = 0;
const stats = (xs) => ({
  n: xs.length,
  p50: xs.toSorted((a, b) => a - b)[Math.floor(xs.length * 0.5)],
  p95: xs.toSorted((a, b) => a - b)[Math.floor(xs.length * 0.95)],
  max: Math.max(...xs),
});
try {
  const a = await host.create(config),
    b = await host.create(config);
  await Promise.all([execute(a, "let value=1"), execute(b, "let value=2")]);
  for (let i = 0; i < 1000; i++) {
    const begin = performance.now();
    const results = await Promise.all([
      execute(a, "output.value(value);"),
      execute(b, "output.value(value);"),
    ]);
    for (const [j, r] of results.entries()) {
      assert.equal(r.status, "completed");
      assert.equal(r.output[0].value, j + 1);
    }
    if (i < 200) warm.push(performance.now() - begin);
  }
  for (const s of [a, b]) {
    const state = await host.status(s);
    pids.add(state.kernelPid);
    maxRss = Math.max(
      maxRss,
      Number(
        execFileSync("/bin/ps", ["-o", "rss=", "-p", String(state.kernelPid)], {
          encoding: "utf8",
        }).trim(),
      ) * 1024,
    );
    await host.dispose(s);
  }
  for (let i = 0; i < 100; i++) {
    const s = await host.create(config);
    const begin = performance.now();
    const r = await execute(s, "let x=1;");
    assert.equal(r.status, "completed");
    if (i < 30) cold.push(performance.now() - begin);
    pids.add((await host.status(s)).kernelPid);
    const reset = await host.reset(s);
    assert.equal(reset.reset, true);
    await execute(s, "let x=2;");
    pids.add((await host.status(s)).kernelPid);
    await host.dispose(s);
  }
  const alive = [...pids].filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });
  assert.equal(alive.length, 0);
  const report = {
    fixture: true,
    date: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    cpu: os.cpus()[0].model,
    warmParallelPairMs: stats(warm),
    coldMs: stats(cold),
    stability: { cells: 2000, sessions: 2, pass: true },
    lifecycle: { cycles: 100, kernelPids: pids.size, remaining: alive.length },
    observedMaxRssBytes: maxRss,
    budgets: { warmP95: 100, coldP95: 2000, rssBytes: DEFAULT_POLICY.rssBytes },
  };
  assert.ok(report.warmParallelPairMs.p95 < 100);
  assert.ok(report.coldMs.p95 < 2000);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await host.close();
}
