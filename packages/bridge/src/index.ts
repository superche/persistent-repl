import { randomUUID } from "node:crypto";
import type {
  ExecInput,
  ReplHost,
  SessionRef,
  TrustedCallContext,
} from "@superche/persistent-repl";

export interface BridgeContextFactory {
  (): Omit<TrustedCallContext, "callKey" | "signal">;
}

export type BridgeRequest =
  | { id?: string; method: "execute"; params: ExecInput }
  | { id?: string; method: "status" }
  | { id?: string; method: "docs"; params?: { topic?: string } }
  | { id?: string; method: "reset" }
  | { id?: string; method: "cancel"; params: { executionId: string } };

export interface BridgeResponse {
  id?: string;
  result?: unknown;
  error?: { code: string; message: string };
}

/**
 * The coding-agent boundary. It accepts code as code, keeps the REPL session
 * alive between calls, and returns the Core result unchanged. Any CUA call
 * made by the code is dispatched by the trusted provider registered on Core;
 * this bridge does not translate code into guessed tool calls.
 */
export class PersistentReplBridge {
  constructor(
    private readonly host: ReplHost,
    private readonly session: SessionRef,
    private readonly context: BridgeContextFactory,
  ) {}

  async execute(input: ExecInput, requestId: string = randomUUID()) {
    return this.host.execute(this.session, input, {
      ...this.context(),
      callKey: requestId,
    });
  }

  status() {
    return this.host.status(this.session);
  }

  docs(topic?: string) {
    return this.host.docs(this.session, topic);
  }

  reset() {
    return this.host.reset(this.session);
  }

  cancel(executionId: string) {
    return this.host.cancel(this.session, executionId);
  }

  async dispatch(request: BridgeRequest): Promise<unknown> {
    switch (request.method) {
      case "execute":
        return this.execute(request.params, request.id);
      case "status":
        return this.status();
      case "docs":
        return this.docs(request.params?.topic);
      case "reset":
        return this.reset();
      case "cancel":
        return this.cancel(request.params.executionId);
    }
  }
}

export function createBridge(
  host: ReplHost,
  session: SessionRef,
  context: BridgeContextFactory,
) {
  return new PersistentReplBridge(host, session, context);
}

/** JSONL adapter for an external coding agent or process supervisor. */
export async function handleBridgeLine(
  bridge: PersistentReplBridge,
  line: string,
): Promise<string> {
  let request: BridgeRequest | undefined;
  try {
    request = JSON.parse(line) as BridgeRequest;
    const result = await bridge.dispatch(request);
    return JSON.stringify({ id: request.id, result } satisfies BridgeResponse);
  } catch (error: any) {
    return JSON.stringify({
      id: (request as any)?.id,
      error: {
        code: typeof error?.code === "string" ? error.code : "BRIDGE_ERROR",
        message:
          typeof error?.message === "string"
            ? error.message
            : "Bridge request failed",
      },
    } satisfies BridgeResponse);
  }
}
