import test from "node:test";
import assert from "node:assert/strict";
import {
  MockCuaClient,
  verifyBackendContract,
} from "@superche/persistent-repl-testing";

test("standalone backend contract runs through the public provider seam and labels synthetic evidence", async () => {
  const report = await verifyBackendContract({
    client: new MockCuaClient(),
    evidence: "synthetic",
    browserId: "tab-1",
    nativeId: "app-1",
    identity: {
      ownerKey: "contract",
      taskKey: "owned-targets",
      authorizationRevision: "1",
    },
  });
  assert.equal(report.pass, true);
  assert.equal(report.evidence, "synthetic");
  assert.equal(report.checks.length, 6);
  assert.match(report.scope, /no device action/);
});
