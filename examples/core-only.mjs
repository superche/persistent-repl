import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ReplHost, SEMANTICS_VERSION } from "@superche/persistent-repl";

const require = createRequire(import.meta.url);
for (const name of [
  "@superche/persistent-repl-cua",
  "@superche/persistent-repl-mcp",
  "@superche/persistent-repl-testing",
  "@modelcontextprotocol/sdk",
  "electron",
])
  assert.throws(
    () => require.resolve(name),
    `Core-only installation unexpectedly contains ${name}`,
  );
const host = new ReplHost(1);
const session = await host.create({
  ownerKey: "standalone-core",
  taskKey: "owned-fixture",
  semanticsVersion: SEMANTICS_VERSION,
  capabilityRevision: "1",
  authorizationRevision: "1",
  authorize: () => true,
});
let call = 0;
const run = (code) =>
  host.execute(
    session,
    { code },
    {
      ownerKey: "standalone-core",
      taskKey: "owned-fixture",
      turnKey: "1",
      callKey: String(++call),
      authorizationRevision: "1",
    },
  );
try {
  assert.equal((await run("let value=40; let box={n:1};")).status, "completed");
  const result = await run("value+=2; box.n++; output.value([value,box.n]);");
  assert.deepEqual(result.output[0].value, [42, 2]);
  const oldPid = (await host.status(session)).kernelPid;
  assert.equal((await host.reset(session)).reset, true);
  assert.throws(() => process.kill(oldPid, 0), { code: "ESRCH" });
  assert.equal(
    (await run("output.value(typeof value)")).output[0].value,
    "undefined",
  );
  console.log(
    JSON.stringify({
      check: "isolated-core-install",
      pass: true,
      persisted: [42, 2],
      reset: true,
      optionalPackagesAbsent: true,
    }),
  );
} finally {
  await host.close();
}
