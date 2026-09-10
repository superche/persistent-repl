import { ReplHost, SEMANTICS_VERSION } from "@superche/persistent-repl";
import { createCounterProvider } from "@superche/persistent-repl/fixtures";
const host = new ReplHost();
const { provider } = createCounterProvider();
const session = await host.create({
  ownerKey: "synthetic-owner",
  taskKey: "generic-demo",
  semanticsVersion: SEMANTICS_VERSION,
  capabilityRevision: "fixture/1",
  authorizationRevision: "auth/1",
  providers: [provider],
  authorize: () => true,
});
try {
  for (const [i, code] of [
    "let count=1; let box={value:1}; function readOldCount(){return count;} function readSharedBox(){return box.value;}",
    "count=2; box.value=2; output.value([count,readOldCount(),readSharedBox()]);",
    "let total=await services.counter.add({amount:3}); output.value(total);",
    'let ready=3; throw new Error("synthetic failure"); let unreachable=4;',
    "output.value([ready,total]);",
  ].entries()) {
    const result = await host.execute(
      session,
      { code },
      {
        ownerKey: "synthetic-owner",
        taskKey: "generic-demo",
        turnKey: "turn/1",
        callKey: `call/${i}`,
        authorizationRevision: "auth/1",
      },
    );
    console.log(JSON.stringify(result));
    if (!result.accepted || result.status === "crashed")
      throw new Error("Demo failed");
  }
} finally {
  await host.close();
}
