import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
test("AT09 MCP wire duplicate request IDs do not repeat code effects; EOF reaps kernel", async (t) => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.resolve("@superche/persistent-repl-mcp/cli"))],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  const responses = new Map(),
    pending = new Map();
  lines.on("line", (line) => {
    const m = JSON.parse(line);
    if ("id" in m) {
      if (pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      } else responses.set(m.id, m);
    }
  });
  const receive = (id) =>
    responses.has(id)
      ? Promise.resolve(responses.get(id))
      : new Promise((r) => pending.set(id, r));
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "raw-synthetic", version: "1" },
    },
  });
  assert.ok((await receive(1)).result);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const call = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "repl_exec",
      arguments: {
        code: "var count = (typeof count === 'undefined' ? 0 : count) + 1;",
      },
    },
  };
  send(call);
  await receive(2);
  send(call);
  await receive(2);
  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "repl_exec",
      arguments: { code: "output.value(count);" },
    },
  });
  assert.equal((await receive(3)).result.structuredContent.output[0].value, 1);
  send({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "repl_status", arguments: {} },
  });
  const pid = (await receive(4)).result.structuredContent.kernelPid;
  child.stdin.end();
  await new Promise((r) => child.once("exit", r));
  assert.throws(() => process.kill(pid, 0));
});
