import type {
  ServiceProvider,
  MethodDefinition,
  HandlerContext,
  Json,
} from "@superche/persistent-repl";
import type { CuaClient, TargetRef, CuaContext, WaiterRef } from "./types.js";
export * from "./types.js";
const empty = { type: "object", additionalProperties: false };
const result = {};
export function createCuaProvider(client: CuaClient): ServiceProvider {
  function wrapWait(waiter: WaiterRef, c: HandlerContext) {
    return c.resource({
      kind: "cua-waiter",
      target: waiter.targetId,
      value: waiter,
      expiresAt: waiter.expiresAt,
      cleanup: () => client.cancelWait(waiter, c),
      methods: {
        take: {
          params: empty,
          result,
          documentation: "Wait for the already armed event",
          handler: (_, ctx) => client.awaitWait(waiter, ctx),
        },
        cancel: {
          params: empty,
          result,
          documentation: "Cancel this waiter",
          handler: (_, ctx) => client.cancelWait(waiter, ctx),
        },
      },
    });
  }
  function wrapTarget(target: TargetRef, c: HandlerContext) {
    const methods: Record<string, MethodDefinition> = {};
    const schema: Record<string, any> = {
      getState: empty,
      focus: empty,
      navigate: {
        ...empty,
        properties: { url: { type: "string", maxLength: 4096 } },
        required: ["url"],
      },
      click: {
        ...empty,
        properties: { ref: { type: "string" }, guard: { type: "object" } },
        required: ["ref", "guard"],
      },
      type: {
        ...empty,
        properties: {
          ref: { type: "string" },
          text: { type: "string", maxLength: 65536 },
          guard: { type: "object" },
        },
        required: ["ref", "text", "guard"],
      },
      key: {
        ...empty,
        properties: { key: { type: "string" }, guard: { type: "object" } },
        required: ["key", "guard"],
      },
      scroll: {
        ...empty,
        properties: { delta: { type: "number" }, guard: { type: "object" } },
        required: ["delta", "guard"],
      },
      visualClick: {
        ...empty,
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          guard: {
            type: "object",
            additionalProperties: false,
            properties: {
              observationId: { type: "string" },
              imageId: { type: "string" },
              digest: { type: "string" },
            },
            required: ["observationId", "imageId", "digest"],
          },
        },
        required: ["x", "y", "guard"],
      },
      drag: {
        ...empty,
        properties: {
          from: {
            type: "array",
            items: { type: "number" },
            minItems: 2,
            maxItems: 2,
          },
          to: {
            type: "array",
            items: { type: "number" },
            minItems: 2,
            maxItems: 2,
          },
          guard: { type: "object" },
        },
        required: ["from", "to", "guard"],
      },
    };
    for (const method of target.capabilities) {
      if (!schema[method]) continue;
      methods[method] = {
        params: schema[method],
        result,
        documentation: `CUA ${method}; backend validates target, lease, observation and image. Preserve returned receipt and post-observation.`,
        mutation: method !== "getState",
        handler: async (args, ctx) => {
          const { guard, ...params } = args as any;
          const response = await client.invoke(
            target,
            method,
            params,
            guard,
            ctx,
          );
          ctx.receipt({
            dispatched: response.dispatched,
            outcome: response.outcome,
            effect: response.effect,
            observation: response.observation as unknown as Json,
            error: response.error,
            stage: response.error?.stage ?? "completed",
          });
          if (response.error)
            throw Object.assign(
              new Error(response.error.message),
              response.error,
              { receipt: response as unknown as Json },
            );
          return response;
        },
      };
    }
    methods.arm = {
      params: {
        ...empty,
        properties: {
          event: { type: "string" },
          timeoutMs: { type: "integer", minimum: 1, maximum: 120000 },
        },
        required: ["event"],
      },
      result,
      documentation:
        "Arm and receive acknowledgement before triggering an event",
      handler: async (args, ctx) =>
        wrapWait(
          await client.arm(
            target,
            (args as any).event,
            Date.now() + ((args as any).timeoutMs ?? 30000),
            ctx,
          ),
          ctx,
        ),
    };
    methods.release = {
      params: empty,
      result,
      documentation: "Release control, preserving user-owned targets",
      handler: (_, ctx) => client.release(target, ctx),
    };
    return c.resource({
      kind: "cua-target",
      target: target.id,
      value: target,
      methods,
      expiresAt: target.expiresAt,
      cleanup: () => "confirmed" as const,
    });
  }
  return {
    name: "cua",
    version: client.version,
    documentation:
      "CUA adapter: discover identities first; acquire returns initial observation. Browser and Native are distinct. Use fresh observation guards and trusted model image acknowledgement.",
    methods: {
      discover: {
        params: empty,
        result,
        documentation:
          "List authorized synthetic or real targets; no implicit target switching",
        handler: (_, c) => client.discover(c),
      },
      acquire: {
        params: {
          ...empty,
          properties: {
            kind: { enum: ["browser", "native"] },
            id: { type: "string" },
            create: { type: "boolean" },
          },
          required: ["kind", "id"],
        },
        result,
        documentation: "Acquire exact ID and initial observation",
        handler: async (args, c) => {
          const acquired = await client.acquire(args as any, c);
          return {
            target: wrapTarget(acquired.target, c),
            observation: acquired.observation,
          };
        },
      },
      stop: {
        params: empty,
        result,
        documentation:
          "Emergency stop; release input/preview, do not close user targets",
        handler: (_, c) => client.stop(c, "user-stop"),
      },
      finish: {
        params: {
          ...empty,
          properties: { policy: { enum: ["keep", "close-created"] } },
        },
        result,
        documentation:
          "Normal finish with explicit created-page retention policy",
        handler: (args, c) => client.finish(c, (args as any).policy ?? "keep"),
      },
    },
    dispose: (id, reason) => client.cleanupSession(id, reason),
    facade: {
      global: "cua",
      source: `services => {
    const adapt = acquired => {
      const target=acquired.target;
      const facade={...target,initialObservation:acquired.observation};
      facade.waitForEvent=(event,timeoutMs)=>target.arm({event,...(timeoutMs===undefined?{}:{timeoutMs})});
      facade.expectNavigation=async callback=>{
        const waiter=await target.arm({event:'navigation'});
        try {const action=await callback();const event=await waiter.take();return {action,event};}
        finally {await waiter.cancel();}
      };
      return Object.freeze(facade);
    };
    return Object.freeze({getState:()=>services.cua.discover(),getTab:async id=>adapt(await services.cua.acquire({kind:'browser',id})),getBrowser:async id=>adapt(await services.cua.acquire({kind:'browser',id})),getApp:async id=>adapt(await services.cua.acquire({kind:'native',id})),createTab:async id=>adapt(await services.cua.acquire({kind:'browser',id,create:true})),stop:()=>services.cua.stop(),finish:(policy='keep')=>services.cua.finish({policy})});
  }`,
    },
  };
}
