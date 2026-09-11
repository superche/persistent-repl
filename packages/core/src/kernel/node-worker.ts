import { createInterface } from "node:readline";
import vm from "node:vm";
import { compile, compileFacade, compileModuleForNode } from "../compiler.js";
import type { ResourcePolicy } from "../types.js";

/**
 * Node/V8 kernel. The process is the isolation boundary; the vm Context only
 * supplies language globals and the trusted RPC/output bridge. Node built-ins,
 * process, require, code generation and network APIs are not exposed to cells.
 */
const send = (message: unknown) => {
  if (process.stdout.writableLength > 8_000_000) process.exit(1);
  process.stdout.write(JSON.stringify(message) + "\n");
};
const supervisorPid = process.ppid;
if (supervisorPid === 1) process.exit(1);
const supervisorWatch = setInterval(() => {
  if (process.ppid !== supervisorPid) process.exit(1);
}, 250);
supervisorWatch.unref();
let epoch = "";
let policy: ResourcePolicy;
let deadline = Infinity;
let running = false;
let config: any;
let context: vm.Context;
let repl: any;
let store = new Map<string, unknown>();
let kinds = new Map<string, string>();
let modules = new Map<string, Promise<unknown>>();
let activeCell = "";
let rpcCounter = 0;
const pending = new Map<
  string,
  { resolve: (value: string) => void; reject: (error: Error) => void }
>();

function serialize(
  value: unknown,
  depth = 0,
  seen = new Map<object, number>(),
): unknown {
  if (depth > 12) return { $type: "Truncated", reason: "depth" };
  if (value === undefined) return { $type: "Undefined" };
  if (typeof value === "bigint")
    return { $type: "BigInt", value: String(value) };
  if (typeof value === "number" && !Number.isFinite(value))
    return { $type: "Number", value: String(value) };
  if (value === null || ["boolean", "number", "string"].includes(typeof value))
    return value;
  if (typeof value === "function" || typeof value === "symbol")
    return { $type: typeof value };
  if (typeof value !== "object") return { $type: typeof value };
  const object = value as object;
  if (seen.has(object)) return { $type: "Reference", id: seen.get(object) };
  seen.set(object, seen.size + 1);
  if (value instanceof Map)
    return {
      $type: "Map",
      entries: [...value.entries()]
        .slice(0, 2000)
        .map(([key, entry]) => [
          serialize(key, depth + 1, seen),
          serialize(entry, depth + 1, seen),
        ]),
    };
  if (value instanceof Set)
    return {
      $type: "Set",
      values: [...value]
        .slice(0, 2000)
        .map((entry) => serialize(entry, depth + 1, seen)),
    };
  if (ArrayBuffer.isView(value))
    return {
      $type: "TypedArray",
      values: [
        ...new Uint8Array(
          value.buffer,
          value.byteOffset,
          Math.min(value.byteLength, 2048),
        ),
      ],
    };
  const output: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(Object.getOwnPropertyDescriptors(value)).slice(
    0,
    2000,
  )) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    output[key] =
      "value" in descriptor
        ? serialize(descriptor.value, depth + 1, seen)
        : { $type: "Accessor", omitted: true };
  }
  if (value instanceof Error) return { $type: "Error", properties: output };
  return Array.isArray(value) ? Object.values(output) : output;
}

function rpc(
  provider: string,
  method: string,
  args: unknown,
  resourceId?: string,
) {
  const rpcId = String(++rpcCounter);
  const payload = JSON.stringify({
    cell: activeCell,
    provider,
    method,
    args,
    resourceId,
  });
  const promise = new Promise<string>((resolve, reject) =>
    pending.set(rpcId, { resolve, reject }),
  );
  send({
    type: "rpc",
    epoch,
    capabilityRevision: config.capabilityRevision,
    rpcId,
    request: payload,
  });
  return promise.then((raw) => {
    const response = JSON.parse(raw);
    if (response.error)
      throw Object.assign(new Error(response.error.message), response.error);
    return decode(response.value);
  });
}
function decode(value: any): any {
  if (value?.__resource) {
    const resource = Object.create(null);
    Object.defineProperty(resource, "resourceId", {
      value: value.__resource,
      enumerable: true,
    });
    for (const method of value.methods ?? [])
      Object.defineProperty(resource, method, {
        value: (args = {}) => rpc("$resource", method, args, value.__resource),
        enumerable: true,
      });
    return Object.freeze(resource);
  }
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object")
    for (const key of Object.keys(value)) value[key] = decode(value[key]);
  return value;
}
function outputFrame(type: string, value: Record<string, unknown>) {
  send({
    type: "output",
    epoch,
    frame: JSON.stringify({ cell: activeCell, type, ...value }),
  });
}
function makeServices() {
  const services: Record<string, any> = Object.create(null);
  for (const provider of config.providers ?? []) {
    const service: Record<string, unknown> = Object.create(null);
    for (const method of provider.methods)
      Object.defineProperty(service, method, {
        value: (args = {}) => rpc(provider.name, method, args),
        enumerable: true,
      });
    services[provider.name] = Object.freeze(service);
  }
  return Object.freeze(services);
}
function begin(cell: string) {
  activeCell = cell;
  let getters: Record<string, () => unknown> = {};
  let declared: { name: string; kind: string }[] = [];
  const marks = new Set<string>();
  const services = makeServices();
  const facades = Object.fromEntries(
    (config.facades ?? []).map((facade: any) => [
      facade.global,
      vm.runInContext(`(${compileFacade(facade.source)})`, context)(services),
    ]),
  );
  const output = Object.freeze({
    text: (value: unknown) =>
      outputFrame("text", {
        text:
          typeof value === "string" ? value : JSON.stringify(serialize(value)),
      }),
    value: (value: unknown) =>
      outputFrame("value", { value: serialize(value) }),
    image: (data: string, mimeType = "image/png", identity?: unknown) =>
      outputFrame("image", {
        data,
        mimeType,
        ...(identity === undefined ? {} : { identity: serialize(identity) }),
      }),
  });
  const globals: Record<string, unknown> = {
    output,
    services,
    console: Object.freeze({
      log: (...values: unknown[]) => output.value(values),
      warn: (...values: unknown[]) => output.value(values),
      error: (...values: unknown[]) => output.value(values),
    }),
    ...facades,
  };
  repl = Object.freeze({
    ...globals,
    previous: (name: string) => store.get(name),
    register: (
      next: Record<string, () => unknown>,
      declarations: { name: string; kind: string }[],
    ) => {
      getters = next;
      declared = declarations;
    },
    assigned: (names: string[], value: unknown) => {
      names.forEach((name) => marks.add(name));
      return value;
    },
    used: (name: string, value: unknown) => {
      marks.add(name);
      return value;
    },
    mark: (names: string[]) => names.forEach((name) => marks.add(name)),
    commit: () => {
      for (const name of Object.keys(getters)) {
        const declaration = declared.find((item) => item.name === name);
        if (
          declaration &&
          ["var", "hoisted"].includes(declaration.kind) &&
          !marks.has(name)
        )
          continue;
        try {
          store.set(name, getters[name]());
          if (declaration) kinds.set(name, declaration.kind);
        } catch {
          /* retain valid state across TDZ errors */
        }
      }
    },
    importModule: (name: string) => {
      if (typeof name !== "string")
        throw new TypeError("Module specifier must be a string");
      const registration = (config.modules ?? []).find(
        (item: any) => item.name === name,
      );
      if (!registration)
        throw Object.assign(new Error("Module is not registered"), {
          code: "MODULE_DENIED",
          stage: "link",
        });
      const cacheKey =
        registration.reload === "next-cell" ? `${name}:${cell}` : name;
      if (!modules.has(cacheKey))
        modules.set(
          cacheKey,
          Promise.resolve(
            vm.runInContext(compileModuleForNode(registration.source), context),
          ),
        );
      return modules.get(cacheKey);
    },
  });
  context.__repl = repl;
}
function createContext() {
  const sandbox: Record<string, unknown> = Object.create(null);
  sandbox.globalThis = sandbox;
  sandbox.process = undefined;
  sandbox.require = undefined;
  sandbox.module = undefined;
  sandbox.exports = undefined;
  sandbox.Buffer = undefined;
  sandbox.setTimeout = undefined;
  sandbox.setInterval = undefined;
  sandbox.setImmediate = undefined;
  sandbox.fetch = undefined;
  sandbox.WebSocket = undefined;
  sandbox.eval = undefined;
  sandbox.Function = undefined;
  sandbox.Proxy = undefined;
  context = vm.createContext(sandbox, {
    name: "persistent-repl-node-kernel",
    codeGeneration: { strings: false, wasm: false },
  });
}
async function execute(message: any) {
  running = true;
  deadline = message.deadline;
  const result = compile(
    message.code,
    JSON.parse(
      JSON.stringify(
        [...store.keys()].map((name) => ({
          name,
          kind: kinds.get(name) ?? "let",
        })),
      ),
    ),
    (config.facades ?? []).map((facade: any) => facade.global),
  );
  begin(message.cell);
  const fn = vm.runInContext(result.source, context, {
    filename: `cell-${message.cell}.mjs`,
    timeout: Math.max(1, deadline - Date.now()),
  }) as (bridge: unknown) => unknown;
  context.__replCell = fn;
  try {
    await Promise.resolve(
      vm.runInContext("__replCell(__repl)", context, {
        filename: `cell-${message.cell}.invoke.mjs`,
        timeout: Math.max(1, deadline - Date.now()),
      }),
    );
  } finally {
    delete context.__replCell;
  }
  if (pending.size) {
    const drainDeadline = Math.min(deadline, Date.now() + policy.drainMs);
    while (pending.size && Date.now() < drainDeadline)
      await new Promise((resolve) => setTimeout(resolve, 1));
  }
  if (pending.size)
    throw Object.assign(new Error("Unawaited calls exceeded drain budget"), {
      code: "PENDING_DRAIN_TIMEOUT",
      stage: "async",
    });
  send({
    type: "complete",
    epoch,
    cell: message.cell,
    status: "completed",
    warnings: result.warnings,
  });
}
async function receive(line: string) {
  if (line.length > (policy?.frameBytes ?? 8_000_000))
    throw new Error("Frame too large");
  const message = JSON.parse(line);
  if (message.type === "init") {
    epoch = message.epoch;
    policy = message.policy;
    config = message;
    createContext();
    send({ type: "ready", epoch });
    return;
  }
  if (message.type === "rpcResult") {
    if (message.epoch !== epoch) return;
    const wait = pending.get(message.rpcId);
    if (!wait) return;
    pending.delete(message.rpcId);
    wait.resolve(JSON.stringify(message.response));
    return;
  }
  if (message.type === "execute") {
    if (running) throw new Error("Busy");
    try {
      await execute(message);
    } catch (error: any) {
      send({
        type: "complete",
        epoch,
        cell: message.cell,
        status: "failed",
        warnings: [],
        error: {
          code: error?.code ?? "RUNTIME_ERROR",
          message: error?.message ?? "Execution failed",
          stage: error?.stage ?? "execute",
        },
      });
    } finally {
      running = false;
    }
  }
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on(
  "line",
  (line) =>
    void receive(line).catch(() => {
      send({ type: "fatal", epoch, code: "KERNEL_PROTOCOL" });
      process.exit(1);
    }),
);
lines.on("close", () => process.exit(0));
process.on("uncaughtException", () => {
  send({ type: "fatal", epoch, code: "UNCAUGHT_EXCEPTION" });
  process.exit(1);
});
process.on("unhandledRejection", () => {
  send({ type: "fatal", epoch, code: "UNHANDLED_REJECTION" });
  process.exit(1);
});
