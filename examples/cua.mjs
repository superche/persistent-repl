import { MockCuaClient } from "@superche/persistent-repl-testing";
import assert from "node:assert/strict";
import { ReplHost, SEMANTICS_VERSION } from "@superche/persistent-repl";
import { createCuaProvider } from "@superche/persistent-repl-cua";
const previews = [],
  model = [];
const client = new MockCuaClient((e) => previews.push(e));
const host = new ReplHost();
const session = await host.create({
  ownerKey: "synthetic",
  taskKey: "cua-demo",
  semanticsVersion: SEMANTICS_VERSION,
  capabilityRevision: "cua/1",
  authorizationRevision: "1",
  providers: [createCuaProvider(client)],
  authorize: () => true,
  onOutput: (e) => model.push(e),
});
try {
  for (const [i, code] of [
    'output.value(await cua.getState()); let tab=await cua.getTab("tab-1"); output.value(tab.initialObservation);',
    'let action=await tab.expectNavigation(async()=>tab.navigate({url:"https://fixture.invalid/next"})); output.value(action);',
    'let app=await cua.getApp("app-1"); let native=await app.type({ref:"input-1",text:"synthetic",guard:{observationId:app.initialObservation.observationId}}); output.value(native);',
    'let browser=await tab.getState(); output.value(browser); output.image(browser.observation.image.data,"image/png");',
  ].entries()) {
    const r = await host.execute(
      session,
      { code },
      {
        ownerKey: "synthetic",
        taskKey: "cua-demo",
        turnKey: "1",
        callKey: String(i),
        authorizationRevision: "1",
      },
    );
    assert.equal(r.status, "completed", JSON.stringify(r));
    console.log(
      JSON.stringify({
        cell: i,
        status: r.status,
        outputs: r.output.length,
        receipts: r.receipts.map((r) => ({
          method: r.method,
          dispatched: r.dispatched,
          outcome: r.outcome,
        })),
      }),
    );
  }
  assert.equal(client.targets.get("tab-twin").revision, 1);
  assert.equal(client.targets.get("app-twin").text, "");
  console.log(
    JSON.stringify({
      fixture: true,
      route: "Browser → Native → original Browser",
      modelImages: model.filter((e) => e.type === "image").length,
      previewObservations: previews.length,
    }),
  );
} finally {
  await host.close();
}
