import type {
  ServiceProvider,
  Json,
  HandlerContext,
  Cleanup,
} from "../types.js";
const object = { type: "object", additionalProperties: false };
export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
export function createCounterProvider() {
  const state = new Map<string, number>();
  const calls: { sessionId: string; method: string }[] = [];
  const delay = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("Cancelled"));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, ms);
      const abort = () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("Cancelled"), { code: "CANCELLED" }));
      };
      signal.addEventListener("abort", abort, { once: true });
    });
  const provider: ServiceProvider = {
    name: "counter",
    version: "1.0.0",
    documentation: "Synthetic counter/echo fixture. Never accesses devices.",
    methods: {
      read: {
        params: object,
        result: { type: "number" },
        documentation: "Read the session counter",
        handler: (_, c) => state.get(c.sessionId) ?? 0,
      },
      add: {
        params: {
          ...object,
          properties: { amount: { type: "number" } },
          required: ["amount"],
        },
        result: { type: "number" },
        documentation: "Increment the session counter",
        mutation: true,
        handler: (args, c) => {
          const n = (state.get(c.sessionId) ?? 0) + (args as any).amount;
          state.set(c.sessionId, n);
          calls.push({ sessionId: c.sessionId, method: "add" });
          c.receipt({ effect: "confirmed", outcome: "known" });
          return n;
        },
      },
      echo: {
        params: {},
        result: {},
        documentation: "Return supplied JSON",
        handler: (args) => args,
      },
      delay: {
        params: {
          ...object,
          properties: { ms: { type: "integer", minimum: 0, maximum: 120000 } },
          required: ["ms"],
        },
        result: { type: "string" },
        documentation: "Cancellable delayed response",
        handler: async (args, c) => {
          try {
            await delay((args as any).ms, c.signal);
            return "done";
          } catch (e) {
            c.receipt({ outcome: "known", effect: "confirmed" });
            throw e;
          }
        },
      },
      fail: {
        params: object,
        result: {},
        documentation: "Explicit synthetic service error",
        handler: (_, c) => {
          c.receipt({ outcome: "known", domain: { fixture: true } });
          throw Object.assign(new Error("Synthetic provider failure"), {
            code: "FIXTURE_FAILURE",
            stage: "synthetic",
            recoverability: "continue",
          });
        },
      },
      unknown: {
        params: object,
        result: {},
        documentation: "Simulate unknown external write outcome",
        mutation: true,
        handler: () => {
          throw Object.assign(new Error("Synthetic unknown effect"), {
            code: "FIXTURE_UNKNOWN",
            stage: "effect",
          });
        },
      },
      wait: {
        params: {
          ...object,
          properties: { ms: { type: "integer", minimum: 0, maximum: 10000 } },
          required: ["ms"],
        },
        result: { type: "object" },
        documentation:
          "Arm a session resource; take its result in another cell",
        handler: (args, c) => {
          const controller = new AbortController();
          const result = delay((args as any).ms, controller.signal).then(
            () => ({ event: "synthetic" }),
            () => ({ event: "cancelled" }),
          );
          return c.resource({
            kind: "waiter",
            target: "counter",
            value: result,
            expiresAt: Date.now() + 30000,
            cleanup: () => {
              controller.abort();
              return "confirmed";
            },
            methods: {
              take: {
                params: object,
                result: { type: "object" },
                documentation: "Take the armed result",
                handler: async (_, ctx, value) => value,
              },
              cancel: {
                params: object,
                result: { type: "string" },
                documentation: "Cancel the waiter",
                handler: () => {
                  controller.abort();
                  return "confirmed";
                },
              },
            },
          });
        },
      },
    },
    dispose: (id) => {
      state.delete(id);
      return "confirmed";
    },
  };
  return { provider, calls, state };
}
