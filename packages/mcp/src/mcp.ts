import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { Ajv } from "ajv";
import { randomUUID } from "node:crypto";
import { ReplHost } from "@superche/persistent-repl";
import {
  VERSION,
  type SessionRef,
  type TrustedCallContext,
} from "@superche/persistent-repl";
const schemas = {
  repl_exec: {
    type: "object",
    properties: {
      code: { type: "string", maxLength: 65536 },
      timeoutMs: { type: "integer", minimum: 1, maximum: 120000 },
      title: { type: "string", maxLength: 256 },
    },
    required: ["code"],
    additionalProperties: false,
  },
  repl_reset: { type: "object", additionalProperties: false },
  repl_docs: {
    type: "object",
    properties: { topic: { type: "string", maxLength: 256 } },
    additionalProperties: false,
  },
  repl_status: { type: "object", additionalProperties: false },
  repl_cancel: {
    type: "object",
    properties: { executionId: { type: "string" } },
    required: ["executionId"],
    additionalProperties: false,
  },
} as const;
export function createMcpServer(
  host: ReplHost,
  session: SessionRef,
  context: () => Omit<TrustedCallContext, "callKey" | "signal">,
) {
  const server = new Server(
    { name: "persistent-repl", version: VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "Persistent JavaScript cell scope. Read repl_docs first. Execution completion is distinct from external effects. Tools are bound to a trusted host session.",
    },
  );
  const callKeys = new Map<string, string>();
  const ajv = new Ajv();
  const validation = new Map(
    Object.entries(schemas).map(([name, schema]) => [
      name,
      ajv.compile(schema),
    ]),
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(schemas).map(([name, inputSchema]) => ({
      name,
      description: (
        {
          repl_exec:
            "Execute persistent JavaScript with top-level await and explicit output helpers. Returned images are seen only after this call returns.",
          repl_reset:
            "New kernel epoch; clear bindings and waits. Busy while executing.",
          repl_docs:
            "Read basic semantics or a registered provider.method contract.",
          repl_status:
            "Inspect current execution independently of the running cell.",
          repl_cancel:
            "Cancel a running cell. External effects may remain unknown.",
        } as any
      )[name],
      inputSchema: inputSchema as any,
      annotations: {
        readOnlyHint: name === "repl_docs" || name === "repl_status",
        destructiveHint: false,
        openWorldHint: name === "repl_exec",
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args = {} } = request.params;
    const validate = validation.get(name);
    if (!validate) throw new McpError(ErrorCode.InvalidParams, "Unknown tool");
    if (!validate(args))
      throw new McpError(ErrorCode.InvalidParams, "Invalid tool arguments");
    let result: any;
    const requestKey = typeof extra.requestId + ":" + String(extra.requestId);
    if (!callKeys.has(requestKey)) {
      if (callKeys.size >= 1024)
        throw new McpError(
          ErrorCode.InvalidRequest,
          "Request history limit: start a new transport session.",
        );
      callKeys.set(requestKey, randomUUID());
    }
    if (name === "repl_exec")
      result = await host.execute(session, args as any, {
        ...context(),
        callKey: callKeys.get(requestKey)!,
        signal: extra.signal,
      });
    else if (name === "repl_reset") result = await host.reset(session);
    else if (name === "repl_docs")
      result = host.docs(session, args.topic as string | undefined);
    else if (name === "repl_status") result = await host.status(session);
    else result = await host.cancel(session, args.executionId as string);
    const content: any[] = [{ type: "text", text: JSON.stringify(result) }];
    if (result.output)
      for (const item of result.output)
        if (item.type === "image")
          content.push({
            type: "image",
            data: item.data,
            mimeType: item.mimeType,
          });
    return {
      content,
      structuredContent: result,
      isError:
        result.accepted === false ||
        (result.accepted === true && result.status !== "completed") ||
        result.reset === false,
    };
  });
  return server;
}
