import assert from "node:assert/strict";
import {
  ReplHost,
  SEMANTICS_VERSION,
  type TrustedCallContext,
  type ExecResult,
} from "@superche/persistent-repl";
import {
  createCuaProvider,
  type CuaClient,
} from "@superche/persistent-repl-cua";

export interface BackendContractFixture {
  client: CuaClient;
  /** Label actual backend evidence. A synthetic result never establishes device support. */
  evidence: "synthetic" | "device";
  browserId: string;
  nativeId: string;
  identity: Pick<
    TrustedCallContext,
    "ownerKey" | "taskKey" | "authorizationRevision"
  >;
}

/** Read-only acquisition/lifecycle contract; action/visual tests remain separate. */
export async function verifyBackendContract(fixture: BackendContractFixture) {
  assert.ok(["synthetic", "device"].includes(fixture.evidence));
  assert.ok(fixture.browserId && fixture.nativeId);
  const host = new ReplHost(1);
  const checks: string[] = [];
  try {
    const session = await host.create({
      ...fixture.identity,
      semanticsVersion: SEMANTICS_VERSION,
      capabilityRevision: fixture.client.version,
      providers: [createCuaProvider(fixture.client)],
      authorize: () => true,
    });
    let call = 0;
    const context = () => ({
      ...fixture.identity,
      turnKey: "contract-fixture",
      callKey: String(++call),
    });
    const run = async (code: string) => {
      const r = await host.execute(session, { code }, context());
      assert.ok(r.accepted);
      assert.equal((r as ExecResult).status, "completed");
      return r as ExecResult;
    };
    const value = (result: ExecResult) => {
      const item = result.output.find((e) => e.type === "value");
      assert.ok(item?.type === "value");
      return item.value;
    };
    assert.equal(
      value(
        await run(
          `let browser=await cua.getTab(${JSON.stringify(fixture.browserId)});output.value(browser.initialObservation.targetId);`,
        ),
      ),
      fixture.browserId,
    );
    checks.push("browser acquisition preserves target identity");
    assert.equal(
      value(
        await run(
          `let native=await cua.getApp(${JSON.stringify(fixture.nativeId)});output.value(native.initialObservation.targetId);`,
        ),
      ),
      fixture.nativeId,
    );
    checks.push("native acquisition preserves target identity");
    assert.equal(
      value(
        await run(
          "output.value((await browser.getState()).observation.targetId)",
        ),
      ),
      fixture.browserId,
    );
    checks.push("original browser reference survives another target and cell");
    const rejected = await host.execute(
      session,
      { code: "output.value(1)" },
      { ...context(), ownerKey: "wrong-contract-owner" },
    );
    assert.equal(rejected.accepted, false);
    checks.push("host identity cannot be substituted by the caller");
    const reset = await host.reset(session);
    assert.equal(reset.reset, true);
    assert.notEqual(reset.oldEpoch, reset.kernelEpoch);
    assert.equal(value(await run("output.value(typeof browser)")), "undefined");
    checks.push("reset creates a new epoch and removes old bindings");
    assert.equal((await host.dispose(session)).cleanup, "confirmed");
    checks.push("owned session disposes with confirmed cleanup");
    return {
      pass: true,
      evidence: fixture.evidence,
      checks,
      scope:
        "acquisition, persistent references, host identity, reset and dispose; no device action or model-image-consumption claim",
    };
  } finally {
    await host.close();
  }
}
