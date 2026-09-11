import type { Cleanup, HandlerContext, Json } from "@superche/persistent-repl";
export interface TargetRef {
  id: string;
  kind: "browser" | "native";
  leaseId: string;
  expiresAt: number;
  capabilities: string[];
}
export interface Observation {
  targetId: string;
  observationId: string;
  revision: number;
  expiresAt: number;
  image?: {
    imageId: string;
    data: string;
    mimeType: "image/png";
    digest: string;
  };
  state: Json;
}
export interface Guard {
  observationId: string;
  imageId?: string;
  digest?: string;
}
export interface CuaReceipt {
  dispatched: "no" | "yes" | "unknown";
  outcome: "known" | "unknown";
  effect: "confirmed" | "partial" | "unknown";
  observation?: Observation;
  error?: { code: string; message: string; stage: string };
  data?: Json;
}
export interface WaiterRef {
  id: string;
  targetId: string;
  expiresAt: number;
}
export interface CuaContext extends HandlerContext {}
/** Implemented by the product's existing capability service. No model-supplied credentials or endpoint. */
export interface CuaClient {
  readonly version: string;
  discover(context: CuaContext): Promise<Json>;
  acquire(
    selector: { kind: "browser" | "native"; id: string; create?: boolean },
    context: CuaContext,
  ): Promise<{ target: TargetRef; observation: Observation }>;
  invoke(
    target: TargetRef,
    method: string,
    args: Json,
    guard: Guard | undefined,
    context: CuaContext,
  ): Promise<CuaReceipt>;
  arm(
    target: TargetRef,
    event: string,
    deadline: number,
    context: CuaContext,
  ): Promise<WaiterRef>;
  awaitWait(waiter: WaiterRef, context: CuaContext): Promise<Json>;
  cancelWait(waiter: WaiterRef, context: CuaContext): Promise<Cleanup>;
  release(target: TargetRef, context: CuaContext): Promise<Cleanup>;
  stop(context: CuaContext, reason: string): Promise<Cleanup>;
  finish(
    context: CuaContext,
    policy: "keep" | "close-created",
  ): Promise<Cleanup>;
  cleanupSession(sessionId: string, reason: string): Promise<Cleanup>;
}
export interface PreviewEvent {
  sessionId: string;
  ownerKey: string;
  taskKey: string;
  type: "observation" | "stopped";
  targetId?: string;
  observation?: Observation;
}
