import { randomUUID, createHash } from "node:crypto";
import { PNG } from "pngjs";
import type { Json, Cleanup } from "../types.js";
import type {
  CuaClient,
  CuaContext,
  CuaReceipt,
  TargetRef,
  Observation,
  WaiterRef,
  Guard,
  PreviewEvent,
} from "./types.js";
interface Target {
  id: string;
  kind: "browser" | "native";
  name: string;
  url?: string;
  revision: number;
  clicks: number;
  text: string;
  created?: boolean;
}
interface Wait {
  ref: WaiterRef;
  sessionId: string;
  event: string;
  promise: Promise<Json>;
  resolve: (x: Json) => void;
  timer: NodeJS.Timeout;
}
export class MockCuaClient implements CuaClient {
  readonly version = "synthetic-cua/1.0.0";
  readonly targets = new Map<string, Target>([
    [
      "tab-1",
      {
        id: "tab-1",
        kind: "browser",
        name: "Fixture Browser",
        url: "https://fixture.invalid/",
        revision: 1,
        clicks: 0,
        text: "",
      },
    ],
    [
      "tab-twin",
      {
        id: "tab-twin",
        kind: "browser",
        name: "Fixture Browser",
        url: "https://fixture.invalid/",
        revision: 1,
        clicks: 0,
        text: "",
      },
    ],
    [
      "app-1",
      {
        id: "app-1",
        kind: "native",
        name: "Fixture Editor",
        revision: 1,
        clicks: 0,
        text: "",
      },
    ],
    [
      "app-twin",
      {
        id: "app-twin",
        kind: "native",
        name: "Fixture Editor",
        revision: 1,
        clicks: 0,
        text: "",
      },
    ],
  ]);
  readonly calls: {
    sessionId: string;
    targetId?: string;
    method: string;
    args?: Json;
  }[] = [];
  readonly waiters = new Map<string, Wait>();
  #leases = new Map<string, { ref: TargetRef; sessionId: string }>();
  #observations = new Map<string, Observation>();
  #ack = new Set<string>();
  #locks = new Set<string>();
  failNextObservation = false;
  unknownNextInput = false;
  constructor(readonly onPreview?: (e: PreviewEvent) => void) {}
  #error(code: string, stage = "target"): never {
    throw Object.assign(new Error(`Synthetic CUA: ${code}`), {
      code,
      stage,
      recoverability:
        "Observe the same target again; do not replay input automatically.",
    });
  }
  #target(ref: TargetRef, c: CuaContext) {
    const lease = this.#leases.get(ref.leaseId);
    if (
      !lease ||
      lease.sessionId !== c.sessionId ||
      lease.ref.id !== ref.id ||
      ref.expiresAt < Date.now()
    )
      this.#error("TARGET_EXPIRED");
    return this.targets.get(ref.id)!;
  }
  #observation(target: Target, c: CuaContext): Observation {
    const png = new PNG({ width: 8, height: 8 });
    png.data.fill(target.kind === "browser" ? 180 : 80);
    const bytes = PNG.sync.write(png);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const observation: Observation = {
      targetId: target.id,
      observationId: randomUUID(),
      revision: target.revision,
      expiresAt: Date.now() + 30000,
      image: {
        imageId: randomUUID(),
        data: bytes.toString("base64"),
        mimeType: "image/png",
        digest,
      },
      state: {
        fixture: true,
        kind: target.kind,
        name: target.name,
        url: target.url ?? null,
        clicks: target.clicks,
        text: target.text,
        elements: [
          { ref: "button-1", role: "button" },
          { ref: "input-1", role: "textbox" },
        ],
      },
    };
    // Keep one current observation per target, with bounded provenance.
    for (const [id, old] of this.#observations)
      if (old.targetId === target.id) {
        this.#observations.delete(id);
        this.#ack.delete(id);
      }
    this.#observations.set(observation.observationId, observation);
    this.onPreview?.({
      sessionId: c.sessionId,
      ownerKey: c.trusted.ownerKey,
      taskKey: c.trusted.taskKey,
      type: "observation",
      targetId: target.id,
      observation,
    });
    return observation;
  }
  /** Synthetic model-bridge hook; never exposed as a model-callable service. */
  acknowledgeModelImage(observation: Observation) {
    const original = this.#observations.get(observation.observationId);
    if (
      !original ||
      original.image?.data !== observation.image?.data ||
      original.image?.imageId !== observation.image?.imageId ||
      original.targetId !== observation.targetId
    )
      this.#error("IMAGE_MISMATCH", "model-observation");
    this.#ack.add(observation.observationId);
  }
  async discover(c: CuaContext): Promise<Json> {
    this.calls.push({ sessionId: c.sessionId, method: "discover" });
    return [...this.targets.values()].map((t) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      url: t.url ?? null,
    }));
  }
  async acquire(
    selector: { kind: "browser" | "native"; id: string; create?: boolean },
    c: CuaContext,
  ) {
    if (selector.create) {
      if (selector.kind !== "browser" || this.targets.has(selector.id))
        this.#error("TARGET_CONFLICT");
      this.targets.set(selector.id, {
        id: selector.id,
        kind: "browser",
        name: "Created fixture",
        revision: 1,
        clicks: 0,
        text: "",
        created: true,
      });
    }
    const target = this.targets.get(selector.id);
    if (!target || target.kind !== selector.kind)
      this.#error("TARGET_NOT_FOUND");
    const ref: TargetRef = {
      id: selector.id,
      kind: selector.kind,
      leaseId: randomUUID(),
      expiresAt: Date.now() + 300000,
      capabilities: [
        "getState",
        "click",
        "type",
        "key",
        "scroll",
        "visualClick",
        "drag",
        ...(selector.kind === "browser" ? ["navigate"] : ["focus"]),
      ],
    };
    this.#leases.set(ref.leaseId, { ref, sessionId: c.sessionId });
    this.calls.push({
      sessionId: c.sessionId,
      targetId: ref.id,
      method: "acquire",
    });
    return { target: ref, observation: this.#observation(target!, c) };
  }
  async invoke(
    ref: TargetRef,
    method: string,
    args: Json,
    guard: Guard | undefined,
    c: CuaContext,
  ): Promise<CuaReceipt> {
    let target: Target;
    try {
      target = this.#target(ref, c);
      if (!ref.capabilities.includes(method))
        this.#error("UNSUPPORTED_CAPABILITY");
      if (!["getState", "navigate", "focus"].includes(method)) {
        const observation =
          guard && this.#observations.get(guard.observationId);
        if (
          !observation ||
          observation.targetId !== target.id ||
          observation.revision !== target.revision ||
          observation.expiresAt < Date.now()
        )
          this.#error("OBSERVATION_STALE", "guard");
        if (
          ["visualClick", "drag"].includes(method) &&
          (guard?.imageId !== observation!.image?.imageId ||
            guard?.digest !== observation!.image?.digest ||
            !this.#ack.has(observation!.observationId))
        )
          this.#error("IMAGE_UNOBSERVED", "guard");
      }
      if (this.#locks.has(target.id)) this.#error("TARGET_BUSY", "dispatch");
    } catch (e: any) {
      return {
        dispatched: "no",
        outcome: "known",
        effect: "confirmed",
        error: { code: e.code, message: e.message, stage: e.stage },
      };
    }
    this.calls.push({
      sessionId: c.sessionId,
      targetId: target.id,
      method,
      args: structuredClone(args),
    });
    if (method === "getState")
      return {
        dispatched: "yes",
        outcome: "known",
        effect: "confirmed",
        observation: this.#observation(target, c),
      };
    this.#locks.add(target.id);
    try {
      if (c.signal.aborted)
        return {
          dispatched: "no",
          outcome: "known",
          effect: "confirmed",
          error: {
            code: "CANCELLED",
            message: "Synthetic cancellation",
            stage: "dispatch",
          },
        };
      if (this.unknownNextInput) {
        this.unknownNextInput = false;
        return {
          dispatched: "unknown",
          outcome: "unknown",
          effect: "unknown",
          error: {
            code: "PARTIAL_INPUT",
            message: "Synthetic partial/unknown input",
            stage: "input",
          },
        };
      }
      if (["click", "visualClick"].includes(method)) target.clicks++;
      if (method === "type") target.text = (args as any).text;
      if (method === "navigate") {
        target.url = (args as any).url;
        for (const waiter of this.waiters.values())
          if (
            waiter.sessionId === c.sessionId &&
            waiter.ref.targetId === target.id &&
            waiter.event === "navigation"
          ) {
            clearTimeout(waiter.timer);
            waiter.resolve({
              event: "navigation",
              targetId: target.id,
              url: target.url!,
            });
          }
      }
      target.revision++;
      if (this.failNextObservation) {
        this.failNextObservation = false;
        return {
          dispatched: "yes",
          outcome: "known",
          effect: "confirmed",
          error: {
            code: "POST_OBSERVATION_FAILED",
            message: "Synthetic action executed; observation failed",
            stage: "post-observation",
          },
        };
      }
      return {
        dispatched: "yes",
        outcome: "known",
        effect: "confirmed",
        observation: this.#observation(target, c),
      };
    } finally {
      this.#locks.delete(target.id);
    }
  }
  async arm(target: TargetRef, event: string, deadline: number, c: CuaContext) {
    this.#target(target, c);
    const ref = { id: randomUUID(), targetId: target.id, expiresAt: deadline };
    let resolve!: (x: Json) => void;
    const promise = new Promise<Json>((r) => (resolve = r));
    const timer = setTimeout(
      () => resolve({ event: "timeout" }),
      Math.max(1, deadline - Date.now()),
    );
    timer.unref();
    this.waiters.set(ref.id, {
      ref,
      event,
      sessionId: c.sessionId,
      promise,
      resolve,
      timer,
    });
    this.calls.push({
      sessionId: c.sessionId,
      targetId: target.id,
      method: "arm",
    });
    return ref;
  }
  async awaitWait(ref: WaiterRef, c: CuaContext) {
    const w = this.waiters.get(ref.id);
    if (!w || w.sessionId !== c.sessionId) this.#error("WAITER_EXPIRED");
    const result = await w!.promise;
    clearTimeout(w!.timer);
    this.waiters.delete(ref.id);
    return result;
  }
  async cancelWait(ref: WaiterRef, c: CuaContext): Promise<Cleanup> {
    const w = this.waiters.get(ref.id);
    if (w && w.sessionId !== c.sessionId) this.#error("WAITER_OWNER");
    if (w) {
      clearTimeout(w.timer);
      w.resolve({ event: "cancelled" });
      this.waiters.delete(ref.id);
    }
    return "confirmed";
  }
  async release(target: TargetRef, c: CuaContext): Promise<Cleanup> {
    this.#target(target, c);
    this.#leases.delete(target.leaseId);
    for (const w of this.waiters.values())
      if (w.sessionId === c.sessionId && w.ref.targetId === target.id)
        await this.cancelWait(w.ref, c);
    return "confirmed";
  }
  async stop(c: CuaContext, reason: string): Promise<Cleanup> {
    this.calls.push({ sessionId: c.sessionId, method: "stop" });
    await this.cleanupSession(c.sessionId, reason);
    this.onPreview?.({
      sessionId: c.sessionId,
      ownerKey: c.trusted.ownerKey,
      taskKey: c.trusted.taskKey,
      type: "stopped",
    });
    return "confirmed";
  }
  async finish(
    c: CuaContext,
    policy: "keep" | "close-created",
  ): Promise<Cleanup> {
    if (policy === "close-created")
      for (const lease of this.#leases.values())
        if (
          lease.sessionId === c.sessionId &&
          this.targets.get(lease.ref.id)?.created
        )
          this.targets.delete(lease.ref.id);
    return this.stop(c, "finish");
  }
  async cleanupSession(sessionId: string, reason: string): Promise<Cleanup> {
    for (const w of this.waiters.values())
      if (w.sessionId === sessionId) {
        clearTimeout(w.timer);
        w.resolve({ event: "cancelled" });
        this.waiters.delete(w.ref.id);
      }
    // Reset revokes kernel objects and waits; control leases can remain without closing targets.
    if (reason !== "reset")
      for (const [id, lease] of this.#leases)
        if (lease.sessionId === sessionId) this.#leases.delete(id);
    return "confirmed";
  }
}
