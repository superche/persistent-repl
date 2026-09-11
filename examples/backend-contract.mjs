import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MockCuaClient,
  verifyBackendContract,
} from "@superche/persistent-repl-testing";

// Optional host-owned module exports createFixture(). Never supplied by model code.
const fixture = process.argv[2]
  ? await (
      await import(pathToFileURL(resolve(process.argv[2])).href)
    ).createFixture()
  : {
      client: new MockCuaClient(),
      evidence: "synthetic",
      browserId: "tab-1",
      nativeId: "app-1",
      identity: {
        ownerKey: "contract",
        taskKey: "owned-targets",
        authorizationRevision: "1",
      },
    };
try {
  console.log(JSON.stringify(await verifyBackendContract(fixture), null, 2));
} finally {
  await fixture.close?.();
}
