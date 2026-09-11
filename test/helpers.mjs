import { ReplHost, SEMANTICS_VERSION } from "@superche/persistent-repl";
import { createCounterProvider } from "@superche/persistent-repl-testing";
export async function fixture(t, extra = {}) {
  const host = new ReplHost();
  t.after(() => host.close());
  const counter = createCounterProvider();
  const session = await host.create({
    ownerKey: "fixture",
    taskKey: "test",
    semanticsVersion: SEMANTICS_VERSION,
    capabilityRevision: "1",
    authorizationRevision: "1",
    providers: [counter.provider],
    authorize: () => true,
    ...extra,
  });
  let id = 0;
  const context = (change = {}) => ({
    ownerKey: "fixture",
    taskKey: "test",
    turnKey: "turn/1",
    callKey: String(++id),
    authorizationRevision: "1",
    ...change,
  });
  const run = (code, input = {}, ctx = {}) =>
    host.execute(session, { code, ...input }, context(ctx));
  return { host, session, run, context, counter };
}
export const values = (r) =>
  r.output.filter((o) => o.type === "value").map((o) => o.value);
