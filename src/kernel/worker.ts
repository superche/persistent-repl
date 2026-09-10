import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { getQuickJS, type QuickJSHandle } from "quickjs-emscripten";
import { readFileSync } from "node:fs";
import { compile, compileModule, compileFacade } from "../compiler.js";
import { createInterface } from "node:readline";
import type { ResourcePolicy } from "../types.js";
const send = (m: unknown) => {
  if (process.stdout.writableLength > 8_000_000) process.exit(1);
  return process.stdout.write(JSON.stringify(m) + "\n");
};
const QuickJS = await getQuickJS();
const runtime = QuickJS.newRuntime();
const vm = runtime.newContext();
let kernel: QuickJSHandle,
  policy: ResourcePolicy,
  epoch = "",
  running = false,
  deadline = Infinity;
const sourceMaps = new Map<string, any>();
let capabilityRevision = "";
let rpcCounter = 0;
const pending = new Map<string, ReturnType<typeof vm.newPromise>>();
function pump() {
  const r = runtime.executePendingJobs(10000);
  if (r.error) {
    r.error.dispose();
    send({ type: "fatal", epoch, code: "ASYNC_FAILURE" });
    process.exit(1);
  }
}
const rpc = vm.newFunction("rpc", (payload) => {
  const request = vm.getString(payload);
  const id = String(++rpcCounter);
  const p = vm.newPromise();
  pending.set(id, p);
  send({ type: "rpc", epoch, capabilityRevision, rpcId: id, request });
  return p.handle;
});
const output = vm.newFunction("output", (frame) => {
  const data = vm.getString(frame);
  if (Buffer.byteLength(data) > policy.frameBytes)
    throw new Error("Output frame budget exceeded");
  send({ type: "output", epoch, frame: data });
  return vm.undefined;
});
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  void receive(line).catch(() => {
    send({ type: "fatal", epoch, code: "KERNEL_PROTOCOL" });
    process.exit(1);
  });
});
lines.on("close", () => process.exit(0));
async function receive(line: string) {
  if (line.length > (policy?.frameBytes ?? 8_000_000))
    throw new Error("Frame too large");
  const m = JSON.parse(line);
  if (m.type === "init") {
    if (kernel) throw new Error("Duplicate bootstrap");
    epoch = m.epoch;
    capabilityRevision = m.capabilityRevision;
    policy = m.policy;
    runtime.setMemoryLimit(policy.heapBytes);
    runtime.setMaxStackSize(1024 * 1024);
    runtime.setInterruptHandler(() => Date.now() > deadline);
    const allowed = new Map<string, string>(
      m.modules.map((r: any) => [r.name, compileModule(r.source)]),
    );
    runtime.setModuleLoader(
      (name) => {
        const source = allowed.get(name.split("?cell=")[0]);
        if (source === undefined) throw new Error("MODULE_DENIED");
        return source;
      },
      (_base, name) => {
        if (!allowed.has(name.split("?cell=")[0]))
          throw new Error("MODULE_DENIED");
        return name;
      },
    );
    const config = vm.unwrapResult(
      vm.evalCode(
        `({providers:${JSON.stringify(m.providers)},modules:${JSON.stringify(m.modules.map(({ source, ...r }: any) => r))},facades:[${m.facades.map((f: any) => `{global:${JSON.stringify(f.global)},factory:(${compileFacade(f.source)})}`).join(",")}],loadModule:(name,cell)=>import(name+(cell?'?cell='+cell:''))})`,
      ),
    );
    const bootstrap = vm.unwrapResult(
      vm.evalCode(
        readFileSync(new URL("./bootstrap.js", import.meta.url), "utf8"),
        "bootstrap.js",
      ),
    );
    kernel = vm.unwrapResult(
      vm.callFunction(bootstrap, vm.undefined, rpc, output, config),
    );
    bootstrap.dispose();
    config.dispose();
    send({ type: "ready", epoch });
  } else if (m.type === "rpcResult") {
    if (m.epoch !== epoch) return;
    const p = pending.get(m.rpcId);
    if (!p) return;
    pending.delete(m.rpcId);
    const val = vm.newString(JSON.stringify(m.response));
    p.resolve(val);
    val.dispose();
    p.dispose();
    pump();
  } else if (m.type === "execute") {
    if (running) throw new Error("Busy");
    running = true;
    deadline = m.deadline;
    let warnings: unknown[] = [],
      sourceMap: any;
    try {
      const namesFn = vm.getProp(kernel, "names");
      const names = vm.unwrapResult(vm.callFunction(namesFn, kernel));
      const previous = JSON.parse(vm.getString(names));
      names.dispose();
      namesFn.dispose();
      const result = compile(m.code, previous, m.globals);
      warnings = result.warnings;
      sourceMap = result.map;
      sourceMaps.set(m.cell, sourceMap);
      const fnResult = vm.evalCode(result.source, `cell-${m.cell}.js`);
      if (fnResult.error) {
        const e = vm.dump(fnResult.error);
        fnResult.error.dispose();
        throw e;
      }
      const fn = fnResult.value;
      const begin = vm.getProp(kernel, "begin"),
        cell = vm.newString(m.cell);
      const bridge = vm.unwrapResult(vm.callFunction(begin, kernel, cell));
      begin.dispose();
      cell.dispose();
      const execution = vm.unwrapResult(
        vm.callFunction(fn, vm.undefined, bridge),
      );
      fn.dispose();
      bridge.dispose();
      const completion = vm.resolvePromise(execution);
      pump();
      const settled = await completion;
      execution.dispose();
      if (settled.error) {
        const e = vm.dump(settled.error);
        settled.error.dispose();
        throw e;
      }
      settled.value.dispose();
      pump();
      const rejectionFn = vm.getProp(kernel, "unhandled");
      const rejectionCount = vm.unwrapResult(
        vm.callFunction(rejectionFn, kernel),
      );
      const rejected = Number(vm.getString(rejectionCount));
      rejectionCount.dispose();
      rejectionFn.dispose();
      if (rejected)
        throw Object.assign(
          new Error("Uncaught promise rejection in this cell"),
          { code: "UNHANDLED_REJECTION", stage: "async" },
        );
      send({
        type: "complete",
        epoch,
        cell: m.cell,
        status: "completed",
        warnings,
      });
    } catch (e: any) {
      if (!e?.loc && typeof e?.stack === "string" && sourceMap) {
        const match = e.stack.match(/cell-([a-f0-9-]+)\.js:(\d+)(?::(\d+))?/);
        if (match && sourceMaps.has(match[1])) {
          const position = originalPositionFor(
            new TraceMap(sourceMaps.get(match[1])),
            {
              line: Number(match[2]),
              column: Math.max(0, Number(match[3] ?? 1) - 1),
            },
          );
          if (position.line) {
            e.loc = { line: position.line, column: position.column ?? 0 };
            e.sourceExecutionId = match[1];
          }
        }
      }
      send({
        type: "complete",
        epoch,
        cell: m.cell,
        status: "failed",
        warnings,
        error: {
          code:
            e?.name === "SyntaxError"
              ? "SYNTAX_ERROR"
              : typeof e?.code === "string"
                ? e.code
                : "RUNTIME_ERROR",
          message:
            typeof e?.message === "string" ? e.message : "Execution failed",
          stage: e?.name === "SyntaxError" ? "parse" : (e?.stage ?? "execute"),
          line: e?.loc?.line,
          column: e?.loc?.column,
          sourceExecutionId: e?.sourceExecutionId,
        },
      });
    } finally {
      running = false; /* Keep deadline for pending jobs from this cell. */
    }
  }
}
process.on("uncaughtException", () => {
  send({ type: "fatal", epoch, code: "UNCAUGHT_EXCEPTION" });
  process.exit(1);
});
process.on("unhandledRejection", () => {
  send({ type: "fatal", epoch, code: "UNHANDLED_REJECTION" });
  process.exit(1);
});
