import { PNG } from "pngjs";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
const client = new Client(
  { name: "persistent-repl-real-client-fixture", version: "0.1.0" },
  { capabilities: {} },
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    fileURLToPath(import.meta.resolve("@superche/persistent-repl-mcp/cli")),
  ],
  stderr: "pipe",
});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 5);
  await client.callTool({
    name: "repl_exec",
    arguments: { code: "let n=2;" },
  });
  const r = await client.callTool({
    name: "repl_exec",
    arguments: { code: "output.value(n+3);" },
  });
  assert.equal(r.structuredContent.output[0].value, 5);
  const png = new PNG({ width: 1, height: 1 });
  png.data.fill(255);
  const data = PNG.sync.write(png).toString("base64");
  const picture = await client.callTool({
    name: "repl_exec",
    arguments: { code: `output.image(${JSON.stringify(data)}, "image/png");` },
  });
  assert.equal(
    picture.content.filter((item) => item.type === "image").length,
    1,
  );
  const abort = new AbortController();
  const cell = client.callTool(
    { name: "repl_exec", arguments: { code: "while(true){}" } },
    undefined,
    { signal: abort.signal },
  );
  await new Promise((r) => setTimeout(r, 50));
  const state = await client.callTool({ name: "repl_status", arguments: {} });
  assert.equal(state.structuredContent.state, "running");
  abort.abort();
  await assert.rejects(cell);
  await new Promise((r) => setTimeout(r, 50));
  const stopped = await client.callTool({ name: "repl_status", arguments: {} });
  assert.equal(stopped.structuredContent.lastResult.status, "cancelled");
  assert.equal(
    (await client.callTool({ name: "repl_reset", arguments: {} }))
      .structuredContent.reset,
    true,
  );
  console.log(
    JSON.stringify({
      fixture: true,
      protocol: "2025-11-25",
      tools: tools.tools.map((t) => t.name),
      persistentValue: 5,
      cancellation: "pass",
    }),
  );
} finally {
  await client.close();
}
