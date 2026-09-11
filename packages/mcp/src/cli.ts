#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ReplHost } from "@superche/persistent-repl";
import { createMcpServer } from "./mcp.js";
import { SEMANTICS_VERSION } from "@superche/persistent-repl";
const host = new ReplHost(1);
const session = await host.create({
  ownerKey: "local-stdio",
  taskKey: "stdio-session",
  semanticsVersion: SEMANTICS_VERSION,
  capabilityRevision: "core-only/1",
  authorizationRevision: "local/1",
  authorize: () => true,
});
const server = createMcpServer(host, session, () => ({
  ownerKey: "local-stdio",
  taskKey: "stdio-session",
  turnKey: "stdio-lifetime",
  authorizationRevision: "local/1",
}));
server.onclose = () => {
  void host.close();
};
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await host.close();
  await server.close();
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
process.stdin.on("end", () => void close());
await server.connect(
  new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 8_000_000,
  }),
);
