import { ReplHost, SEMANTICS_VERSION } from "@superche/persistent-repl";
import { createBridge } from "@superche/persistent-repl-bridge";
import { createCounterProvider } from "@superche/persistent-repl-testing";

const host = new ReplHost();
const { provider } = createCounterProvider();
const session = await host.create({
  ownerKey: "synthetic-owner",
  taskKey: "bridge-demo",
  semanticsVersion: SEMANTICS_VERSION,
  capabilityRevision: "bridge/1",
  authorizationRevision: "auth/1",
  kernel: "node",
  providers: [provider],
  authorize: () => true,
});
const bridge = createBridge(host, session, () => ({
  ownerKey: "synthetic-owner",
  taskKey: "bridge-demo",
  turnKey: "turn/1",
  authorizationRevision: "auth/1",
}));
try {
  const first = await bridge.execute({ code: "let n=40;" }, "agent-1");
  const second = await bridge.execute(
    { code: "n+=2; output.value(n);" },
    "agent-2",
  );
  if (first.status !== "completed" || second.status !== "completed")
    throw new Error("Bridge demo failed");
  console.log(
    JSON.stringify({
      bridge: "agent-neutral",
      kernel: "node",
      output: second.output,
    }),
  );
} finally {
  await host.close();
}
