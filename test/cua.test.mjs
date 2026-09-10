import test from "node:test";
import assert from "node:assert/strict";
import { fixture, values } from "./helpers.mjs";
import {
  createCuaProvider,
  MockCuaClient,
} from "@superche/persistent-repl/cua";
async function setup(t) {
  const previews = [],
    model = [];
  const backend = new MockCuaClient((e) => previews.push(e));
  const f = await fixture(t, {
    providers: [createCuaProvider(backend)],
    onOutput: (e) => model.push(e),
  });
  return { ...f, backend, previews, model };
}
test("AT21 AT24: Browser → Native → original Browser; independent image consumers", async (t) => {
  const { run, backend, previews, model } = await setup(t);
  await run('let tab=await cua.getTab("tab-1");');
  await run(
    'let app=await cua.getApp("app-1"); await app.type({ref:"input-1",text:"fixture",guard:{observationId:app.initialObservation.observationId}});',
  );
  const r = await run(
    'let state=await tab.getState(); output.value(state.observation.targetId);output.image(state.observation.image.data,"image/png");',
  );
  assert.equal(r.status, "completed");
  assert.equal(values(r)[0], "tab-1");
  assert.equal(backend.targets.get("app-1").text, "fixture");
  assert.equal(backend.targets.get("app-twin").text, "");
  assert.equal(backend.targets.get("tab-twin").revision, 1);
  assert.equal(model.filter((e) => e.type === "image").length, 1);
  assert.ok(previews.length >= 3);
});
test("AT11 AT19: arm before callback, cross-cell take, callback failure cleanup", async (t) => {
  const { run, backend } = await setup(t);
  await run(
    'let tab=await cua.getTab("tab-1");let wait=await tab.waitForEvent("navigation");',
  );
  await run('await tab.navigate({url:"https://fixture.invalid/first"});');
  assert.equal(
    values(await run("output.value(await wait.take());"))[0].event,
    "navigation",
  );
  assert.equal(backend.waiters.size, 0);
  const r = await run(
    'await tab.expectNavigation(async()=>{throw new Error("callback fixture")});',
  );
  assert.equal(r.status, "failed");
  assert.equal(backend.waiters.size, 0);
  const methods = backend.calls.map((c) => c.method);
  assert.ok(methods.indexOf("arm") < methods.indexOf("navigate"));
});
test("AT18: output is not image observation ACK; wrong target, digest and stale observation rejected", async (t) => {
  const { run, backend } = await setup(t);
  await run(
    'let tab=await cua.getTab("tab-1");let image=tab.initialObservation.image;let guard={observationId:tab.initialObservation.observationId,imageId:image.imageId,digest:image.digest};output.image(image.data,"image/png");',
  );
  const denied = await run("await tab.visualClick({x:1,y:1,guard});");
  assert.equal(denied.receipts[0].dispatched, "no");
  assert.equal(denied.receipts[0].error.code, "IMAGE_UNOBSERVED");
  const state = values(await run("output.value(tab.initialObservation);"))[0];
  assert.throws(() =>
    backend.acknowledgeModelImage({
      ...state,
      image: { ...state.image, data: "tampered" },
    }),
  );
  backend.acknowledgeModelImage(state);
  assert.equal(
    (
      await run(
        'await tab.visualClick({x:1,y:1,guard:{...guard,digest:"wrong"}});',
      )
    ).receipts[0].dispatched,
    "no",
  );
  assert.equal(
    (await run("await tab.visualClick({x:1,y:1,guard});")).status,
    "completed",
  );
  assert.equal(
    (await run("await tab.visualClick({x:1,y:1,guard});")).receipts[0].error
      .code,
    "OBSERVATION_STALE",
  );
});
test("AT22: dispatched action + failed post-observation preserves effect and does not retry", async (t) => {
  const { run, backend } = await setup(t);
  await run('let tab=await cua.getTab("tab-1");');
  backend.failNextObservation = true;
  const r = await run(
    'await tab.click({ref:"button-1",guard:{observationId:tab.initialObservation.observationId}});',
  );
  assert.equal(r.status, "failed");
  assert.equal(r.receipts[0].dispatched, "yes");
  assert.equal(r.receipts[0].effect, "confirmed");
  assert.equal(r.receipts[0].error.code, "POST_OBSERVATION_FAILED");
  assert.equal(backend.targets.get("tab-1").clicks, 1);
  assert.equal(
    (await run("output.value(await tab.getState())")).status,
    "completed",
  );
  assert.equal(backend.targets.get("tab-1").clicks, 1);
});
test("AT15: reset revokes waiting handles while retaining user targets; stop invalidates proxy", async (t) => {
  const { host, session, run, backend, previews } = await setup(t);
  await run(
    'let tab=await cua.getTab("tab-1");let waiter=await tab.waitForEvent("navigation");',
  );
  const reset = await host.reset(session);
  assert.equal(reset.reset, true);
  assert.equal(backend.waiters.size, 0);
  assert.equal(backend.targets.size, 4);
  await run('let tab=await cua.getTab("tab-1");await cua.stop();');
  const r = await run("await tab.getState()");
  assert.equal(r.receipts[0].error.code, "TARGET_EXPIRED");
  assert.ok(previews.some((e) => e.type === "stopped"));
  assert.equal(backend.targets.size, 4);
});
test("AT23: action/code paths use the injected client contract with the same target and args", async (t) => {
  const { run, backend } = await setup(t);
  await run(
    'let tab=await cua.getTab("tab-1");await tab.navigate({url:"https://fixture.invalid/equivalent"});',
  );
  const code = backend.calls.filter((c) => c.method === "navigate")[0];
  const c = {
    sessionId: "action-fixture",
    trusted: { ownerKey: "fixture", taskKey: "test" },
    signal: new AbortController().signal,
    deadline: Date.now() + 1000,
  };
  const target = await backend.acquire({ kind: "browser", id: "tab-1" }, c);
  const direct = await backend.invoke(
    target.target,
    "navigate",
    { url: "https://fixture.invalid/equivalent" },
    undefined,
    c,
  );
  assert.equal(direct.effect, "confirmed");
  const action = backend.calls.filter((c) => c.method === "navigate")[1];
  assert.deepEqual(
    { target: code.targetId, args: code.args },
    { target: action.targetId, args: action.args },
  );
});
