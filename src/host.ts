import { dependencyReadRoots } from "./isolation.js";
import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import {
  DEFAULT_POLICY,
  SEMANTICS_VERSION,
  VERSION,
  SCHEMA_VERSION,
  type SessionRef,
  type TrustedSessionConfig,
  type TrustedCallContext,
  type ResourcePolicy,
  type ExecInput,
  type ExecResult,
  type ExecRejected,
  type SessionStatus,
  type ExternalReceipt,
  type OutputItem,
  type Json,
  type MethodDefinition,
  type ResourceDefinition,
  type ResourceValue,
  type Cleanup,
  type CancelResult,
  type ResetResult,
  type DisposeResult,
  type HandlerContext,
  type DomainError,
} from "./types.js";
const ajv = new Ajv({ allErrors: false, strict: false });
const uuid = () => randomUUID();
const fail = (code: string, message: string, stage = "dispatch"): never => {
  throw Object.assign(new Error(message), { code, stage });
};
const rejected = (
  code: string,
  message: string,
  stage = "validation",
): ExecRejected => ({
  accepted: false,
  code,
  message,
  stage,
  recovery: ["Inspect status or matching documentation."],
});
const freezeDeep = (v: any): any => {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freezeDeep);
    Object.freeze(v);
  }
  return v;
};
const bounded = <T>(
  promise: Promise<T>,
  ms: number,
  fallback: () => T,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        try {
          resolve(fallback());
        } catch (e) {
          reject(e);
        }
      },
      Math.max(1, ms),
    );
    promise.then(
      (x) => {
        clearTimeout(timer);
        resolve(x);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
interface Method extends MethodDefinition {
  validate: ValidateFunction;
  validateResult: ValidateFunction;
}
interface Resource {
  expiry: NodeJS.Timeout;
  ref: ResourceValue;
  provider: string;
  definition: ResourceDefinition;
  methods: Map<string, Method>;
  epoch: string;
}
interface Active {
  id: string;
  context: TrustedCallContext;
  start: number;
  deadline: number;
  stopped: boolean;
  output: OutputItem[];
  receipts: ExternalReceipt[];
  pending: Map<string, AbortController>;
  seen: Set<string>;
  bytes: number;
  images: number;
  truncated: boolean;
  timer: NodeJS.Timeout;
  consumerBusy?: boolean;
  resolve: (r: ExecResult) => void;
  promise: Promise<ExecResult>;
  completion?: any;
  finalized: boolean;
}
interface Session {
  ref: SessionRef;
  config: TrustedSessionConfig;
  policy: ResourcePolicy;
  epoch: string;
  state: SessionStatus["state"];
  providers: Map<
    string,
    { version: string; documentation: string; methods: Map<string, Method> }
  >;
  resources: Map<string, Resource>;
  child?: ChildProcessWithoutNullStreams;
  starting?: Promise<void>;
  active?: Active;
  last?: ExecResult;
  blocked?: string;
  revision: string;
  revoked: boolean;
  cache: Map<
    string,
    { promise: Promise<ExecResult | ExecRejected>; at: number }
  >;
  lastUsed: number;
  rssTimer?: NodeJS.Timeout;
}
function methods(
  definitions: Record<string, MethodDefinition>,
): Map<string, Method> {
  return new Map(
    Object.entries(definitions).map(([name, def]) => {
      if (
        !/^[a-zA-Z][\w]*$/.test(name) ||
        ["constructor", "__proto__", "then"].includes(name)
      )
        throw new Error("Invalid method name");
      const copy = {
        ...def,
        params: structuredClone(def.params),
        result: structuredClone(def.result),
      };
      return [
        name,
        {
          ...copy,
          validate: ajv.compile(copy.params),
          validateResult: ajv.compile(copy.result),
        },
      ];
    }),
  );
}
function safeError(e: any): DomainError {
  return {
    code: typeof e?.code === "string" ? e.code : "SERVICE_ERROR",
    message: typeof e?.message === "string" ? e.message : "Service failed",
    stage: typeof e?.stage === "string" ? e.stage : "handler",
    recoverability:
      typeof e?.recoverability === "string"
        ? e.recoverability
        : "Inspect receipt before retrying.",
    ...(e?.receipt ? { receipt: e.receipt } : {}),
  };
}
function imageInfo(data: string, mime: string, policy: ResourcePolicy) {
  if (
    typeof data !== "string" ||
    !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
  )
    fail("IMAGE_INVALID", "Expected base64 bytes", "output");
  const b = Buffer.from(data, "base64");
  if (b.length > policy.imageBytes)
    fail("IMAGE_LIMIT", "Image exceeds budget", "output");
  // P0 PNG only; signature + IHDR + bounded dimensions. Full decode validation is done below by pngjs.
  if (
    mime !== "image/png" ||
    b.length < 33 ||
    b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    b.toString("ascii", 12, 16) !== "IHDR"
  )
    fail("IMAGE_INVALID", "Only valid PNG images are enabled", "output");
  const width = b.readUInt32BE(16),
    height = b.readUInt32BE(20);
  if (!width || !height || width * height > policy.imagePixels)
    fail("IMAGE_LIMIT", "Image dimensions exceed budget", "output");
  return { width, height, bytes: b };
}
export class ReplHost {
  #sessions = new Map<SessionRef, Session>();
  #disposed = new WeakMap<SessionRef, Session>();
  #idle: NodeJS.Timeout;
  constructor(
    readonly maxSessions = DEFAULT_POLICY.maxSessions,
    private readonly spawnKernel: typeof spawn = spawn,
  ) {
    this.#idle = setInterval(() => {
      for (const s of this.#sessions.values())
        if (
          !s.active &&
          !["disposed", "expired"].includes(s.state) &&
          Date.now() - s.lastUsed > s.policy.idleMs
        )
          void this.dispose(s.ref).then(() => {
            s.state = "expired";
          });
    }, 1000);
    this.#idle.unref();
  }
  async create(config: TrustedSessionConfig): Promise<SessionRef> {
    if (
      [...this.#sessions.values()].filter(
        (s) => !["disposed", "expired"].includes(s.state),
      ).length >= this.maxSessions
    )
      throw new Error("SESSION_LIMIT");
    if (config.semanticsVersion !== SEMANTICS_VERSION)
      throw new Error("SEMANTICS_VERSION_MISMATCH");
    if (
      !config.ownerKey ||
      !config.taskKey ||
      typeof config.authorize !== "function"
    )
      throw new Error("TRUSTED_CONTEXT_REQUIRED");
    const policy = { ...DEFAULT_POLICY, ...config.policy };
    for (const value of Object.values(policy))
      if (!Number.isSafeInteger(value) || value < 1)
        throw new Error("INVALID_POLICY");
    if (policy.wallMs > policy.maxWallMs) throw new Error("INVALID_POLICY");
    const providers = new Map<string, any>();
    for (const p of config.providers ?? []) {
      if (
        !/^[a-zA-Z]\w*$/.test(p.name) ||
        providers.has(p.name) ||
        ["constructor", "__proto__"].includes(p.name)
      )
        throw new Error("INVALID_PROVIDER");
      providers.set(p.name, {
        version: p.version,
        documentation: p.documentation,
        methods: methods(p.methods),
      });
    }
    for (const module of config.modules ?? [])
      if (
        !/^[a-zA-Z@][\w@/.-]*$/.test(module.name) ||
        module.name.includes("..") ||
        module.name.startsWith("node:")
      )
        throw new Error("INVALID_MODULE");
    const ref = Object.freeze({ sessionId: uuid() });
    const snapshot = {
      ...config,
      providers: (config.providers ?? []).map((p) => ({
        ...p,
        facade: p.facade ? { ...p.facade } : undefined,
      })),
      modules: structuredClone(config.modules ?? []),
    };
    this.#sessions.set(ref, {
      ref,
      config: snapshot,
      policy,
      epoch: uuid(),
      state: "new",
      providers,
      resources: new Map(),
      revision: config.authorizationRevision,
      revoked: false,
      cache: new Map(),
      lastUsed: Date.now(),
    });
    return ref;
  }
  #get(ref: SessionRef) {
    const s = this.#sessions.get(ref) ?? this.#disposed.get(ref);
    if (!s) throw new Error("INVALID_SESSION_REFERENCE");
    return s;
  }
  async status(ref: SessionRef): Promise<SessionStatus> {
    const s = this.#get(ref);
    return {
      sessionId: ref.sessionId,
      kernelEpoch: s.epoch,
      state: s.state,
      executionId: s.active?.id,
      canContinue:
        !s.blocked && !["disposed", "expired", "faulted"].includes(s.state),
      capabilityRevision: s.config.capabilityRevision,
      authorizationRevision: s.revision,
      blockedReason: s.blocked,
      kernelPid: s.child?.pid,
      lastResult: s.last,
    };
  }
  docs(ref: SessionRef, topic?: string) {
    const s = this.#get(ref);
    if (topic) {
      const [provider, method] = topic.split(".");
      const p = s.providers.get(provider);
      if (!p)
        return {
          code: "UNSUPPORTED_CAPABILITY",
          capabilityRevision: s.config.capabilityRevision,
        };
      const m = p.methods.get(method);
      return m
        ? {
            provider,
            method,
            params: m.params,
            result: m.result,
            documentation: m.documentation,
            capabilityRevision: s.config.capabilityRevision,
          }
        : { documentation: p.documentation, methods: [...p.methods.keys()] };
    }
    return {
      version: VERSION,
      semantics: SEMANTICS_VERSION,
      schema: SCHEMA_VERSION,
      capabilityRevision: s.config.capabilityRevision,
      language:
        "Persistent cell scope; top-level await. Old closures keep old scalar bindings; objects remain shared. Explicit output.text/value/image. Static imports rejected. No guest timers/Proxy/eval/Node globals. output/services and facade globals are reserved. Inherited const writes produce compile warnings.",
      lifecycle:
        "cancel stops a cell; reset clears JS and revokes handles; provider stop ends external control; dispose ends session. None implies OS rollback.",
      providers: [...s.providers].map(([name, p]) => ({
        name,
        version: p.version,
        documentation: p.documentation,
      })),
      modules: s.config.modules?.map(({ source, ...m }) => m),
      unsupported: ["audio", "files", "arbitrary npm install"],
    };
  }
  /** Host control plane: keeps computation memory, immediately invalidates old authorization. */
  revoke(ref: SessionRef, newRevision: string) {
    const s = this.#get(ref);
    s.revision = newRevision;
    s.revoked = true;
    for (const c of s.active?.pending.values() ?? []) c.abort();
  }
  authorizeRevision(ref: SessionRef, revision: string) {
    const s = this.#get(ref);
    s.revision = revision;
    s.revoked = false;
  }
  /** Only the trusted host may reconcile unknown effects, after checking its backend. */
  reconcile(ref: SessionRef, result: Cleanup) {
    const s = this.#get(ref);
    if (result === "confirmed") s.blocked = undefined;
  }
  execute(
    ref: SessionRef,
    input: ExecInput,
    context: TrustedCallContext,
  ): Promise<ExecResult | ExecRejected> {
    const s = this.#get(ref);
    if (
      context.ownerKey !== s.config.ownerKey ||
      context.taskKey !== s.config.taskKey
    )
      return Promise.resolve(
        rejected("PERMISSION_DENIED", "Owner/task mismatch"),
      );
    if (!context.callKey || !context.turnKey)
      return Promise.resolve(
        rejected("CONTEXT_REQUIRED", "Trusted call and turn keys required"),
      );
    const cached = s.cache.get(context.callKey);
    if (cached)
      return Date.now() - cached.at > s.policy.retentionMs
        ? Promise.resolve(
            rejected(
              "CALL_EXPIRED",
              "Call cache expired; never replay automatically",
            ),
          )
        : cached.promise;
    if (["disposed", "expired"].includes(s.state))
      return Promise.resolve(
        rejected("SESSION_DISPOSED", "Session is no longer usable"),
      );
    if (s.active || s.starting)
      return Promise.resolve(rejected("BUSY", "Another cell is running"));
    if (s.blocked || s.state === "faulted")
      return Promise.resolve(
        rejected("SESSION_BLOCKED", s.blocked ?? "Reset required"),
      );
    if (
      context.authorizationRevision !== s.revision ||
      s.revoked ||
      context.signal?.aborted
    )
      return Promise.resolve(
        rejected(
          "AUTHORIZATION_REVOKED",
          "Authorization is stale or cancelled",
        ),
      );
    if (
      typeof input?.code !== "string" ||
      Buffer.byteLength(input.code) > s.policy.codeBytes
    )
      return Promise.resolve(
        rejected("INVALID_CODE", "Code must fit the UTF-8 byte limit"),
      );
    if (
      input.timeoutMs !== undefined &&
      (!Number.isInteger(input.timeoutMs) ||
        input.timeoutMs < 1 ||
        input.timeoutMs > s.policy.maxWallMs)
    )
      return Promise.resolve(
        rejected("INVALID_TIMEOUT", "Timeout must fit host wall policy"),
      );
    if (s.cache.size >= s.policy.maxRetainedCalls)
      return Promise.resolve(
        rejected(
          "CALL_HISTORY_LIMIT",
          "Create a new session; deduplication history cannot be discarded safely",
        ),
      );
    const promise = this.#execute(s, input, { ...context });
    s.cache.set(context.callKey, { promise, at: Date.now() });
    return promise;
  }
  async #execute(
    s: Session,
    input: ExecInput,
    context: TrustedCallContext,
  ): Promise<ExecResult | ExecRejected> {
    let resolve!: (r: ExecResult) => void;
    const promise = new Promise<ExecResult>((r) => {
      resolve = r;
    });
    const id = uuid(),
      start = Date.now(),
      deadline =
        start +
        Math.min(input.timeoutMs ?? s.policy.wallMs, s.policy.maxWallMs);
    const active: Active = {
      id,
      context,
      start,
      deadline,
      stopped: false,
      output: [],
      receipts: [],
      pending: new Map(),
      seen: new Set(),
      bytes: 0,
      images: 0,
      truncated: false,
      timer: setTimeout(
        () => void this.#terminate(s, "timed_out", "WALL_DEADLINE"),
        Math.max(1, deadline - start),
      ),
      resolve,
      promise,
      finalized: false,
    };
    s.active = active;
    s.state = "running";
    s.lastUsed = start;
    const abort = () => {
      void this.cancel(s.ref, id);
    };
    context.signal?.addEventListener("abort", abort, { once: true });
    try {
      await this.#start(s);
      if (!active.stopped)
        this.#send(s, {
          type: "execute",
          epoch: s.epoch,
          cell: id,
          code: input.code,
          deadline,
          globals: s.config.providers
            ?.filter((p) => p.facade)
            .map((p) => p.facade!.global),
        });
    } catch {
      if (!active.finalized)
        await this.#terminate(s, "crashed", "BOOTSTRAP_FAILED");
    }
    const result = await promise;
    context.signal?.removeEventListener("abort", abort);
    return result;
  }
  #send(s: Session, message: unknown) {
    const frame = JSON.stringify(message);
    if (Buffer.byteLength(frame) > s.policy.frameBytes)
      throw new Error("FRAME_LIMIT");
    if (!s.child?.stdin.writable) throw new Error("KERNEL_EOF");
    s.child.stdin.write(frame + "\n");
  }
  async #start(s: Session) {
    if (s.child) return;
    if (s.starting) return s.starting;
    const work = fileURLToPath(new URL("./kernel/worker.js", import.meta.url));
    const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
    const node = realpathSync(
      process.env.PERSISTENT_REPL_NODE ?? process.execPath,
    );
    const args = ["--max-old-space-size=128", work];
    let command = node,
      spawnArgs = args;
    if (process.platform === "darwin") {
      const quote = (p: string) => JSON.stringify(p);
      const profile = `(version 1)(deny default)(allow process-exec (literal ${quote(node)}))(allow process-info*)(allow signal (target self))(allow sysctl-read)(allow mach-lookup)(allow file-read-metadata)(allow file-read* (literal "/") ${dependencyReadRoots(
        root,
      )
        .map((path) => `(subpath ${quote(path)})`)
        .join(
          " ",
        )} (subpath ${quote(process.versions.electron ? node.slice(0, node.indexOf(".app/") + 5) : node.slice(0, node.lastIndexOf("/")))}) (subpath "/System/Library") (subpath "/usr/lib") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))(allow file-write* (literal "/dev/null"))`;
      command = "/usr/bin/sandbox-exec";
      spawnArgs = ["-p", profile, node, ...args];
    } else if (process.env.PERSISTENT_REPL_FIXTURE_UNSANDBOXED !== "1") {
      throw new Error("UNSUPPORTED_PLATFORM");
    }
    const child = this.spawnKernel(command, spawnArgs, {
      cwd: root,
      env: {
        LANG: "en_US.UTF-8",
        TZ: "UTC",
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    s.child = child;
    let buffer = "",
      readyResolve!: () => void,
      readyReject!: (e: Error) => void;
    const ready = new Promise<void>((res, rej) => {
      readyResolve = res;
      readyReject = rej;
    });
    const startup = setTimeout(() => {
      readyReject(new Error("STARTUP_TIMEOUT"));
      void this.#terminate(s, "crashed", "STARTUP_TIMEOUT");
    }, s.policy.startupMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > s.policy.frameBytes * 2) {
        void this.#terminate(s, "crashed", "FRAME_LIMIT");
        return;
      }
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (Buffer.byteLength(line) > s.policy.frameBytes) {
          void this.#terminate(s, "crashed", "FRAME_LIMIT");
          return;
        }
        try {
          const message = JSON.parse(line);
          if (message.epoch !== s.epoch || s.child !== child) continue;
          if (message.type === "ready") {
            clearTimeout(startup);
            readyResolve();
          } else
            void this.#message(s, message).catch(() =>
              this.#terminate(s, "crashed", "PROTOCOL_FAILURE"),
            );
        } catch {
          void this.#terminate(s, "crashed", "INVALID_FRAME");
        }
      }
    });
    child.stderr.on("data", () => {
      /* Raw engine diagnostics may contain source; intentionally discarded. */
    });
    child.on("error", () => {
      clearTimeout(startup);
      readyReject(new Error("KERNEL_START"));
      void this.#terminate(s, "crashed", "KERNEL_START");
    });
    child.on("exit", () => {
      clearTimeout(startup);
      readyReject(new Error("KERNEL_EXIT"));
      if (s.child === child) {
        s.child = undefined;
        clearInterval(s.rssTimer);
        if (s.active && !s.active.finalized)
          void this.#terminate(s, "crashed", "KERNEL_EXIT");
        else if (!["disposed", "expired"].includes(s.state))
          s.state = "faulted";
      }
    });
    s.rssTimer = setInterval(() => {
      if (!child.pid) return;
      execFile(
        "/bin/ps",
        ["-o", "rss=", "-p", String(child.pid)],
        { timeout: 500 },
        (err, out) => {
          if (
            !err &&
            Number(out.trim()) * 1024 > s.policy.rssBytes &&
            s.child === child
          )
            void this.#terminate(s, "crashed", "RSS_LIMIT");
        },
      );
    }, 200);
    s.rssTimer.unref();
    s.starting = ready.finally(() => {
      s.starting = undefined;
    });
    this.#send(s, {
      type: "init",
      capabilityRevision: s.config.capabilityRevision,
      epoch: s.epoch,
      policy: s.policy,
      providers: [...s.providers].map(([name, p]) => ({
        name,
        methods: [...p.methods.keys()],
      })),
      modules: s.config.modules,
      facades: s.config.providers?.flatMap((p) => (p.facade ? [p.facade] : [])),
    });
    await s.starting;
  }
  async #message(s: Session, m: any) {
    const a = s.active;
    if (!a || a.finalized) return;
    if (!["fatal", "output", "rpc", "complete"].includes(m.type)) {
      await this.#terminate(s, "crashed", "INVALID_FRAME");
      return;
    }
    if (m.type === "fatal") {
      await this.#terminate(s, "crashed", m.code);
      return;
    }
    if (m.type === "output") {
      try {
        const item = JSON.parse(m.frame);
        if (item.cell !== a.id || a.stopped) return;
        await this.#output(s, a, item);
      } catch (e) {
        a.completion = { status: "failed", error: safeError(e), warnings: [] };
        await this.#terminate(s, "failed", "OUTPUT_INVALID");
      }
      return;
    }
    if (m.type === "rpc") {
      await this.#rpc(s, a, m);
      return;
    }
    if (m.type === "complete" && m.cell === a.id) {
      a.completion = m;
      if (a.pending.size) {
        await bounded(
          new Promise<void>((res) => {
            const timer = setInterval(() => {
              if (!a.pending.size || a.finalized) {
                clearInterval(timer);
                res();
              }
            }, 5);
            timer.unref();
          }),
          s.policy.drainMs,
          () => undefined,
        );
        if (a.pending.size && !a.finalized) {
          await this.#terminate(s, "failed", "PENDING_DRAIN_TIMEOUT");
          return;
        }
      }
      this.#finish(s, a, m.status, m.error, m.warnings);
    }
  }
  async #output(s: Session, a: Active, item: any) {
    const bytes = Buffer.byteLength(JSON.stringify(item));
    if (item.type === "image") {
      if (++a.images > s.policy.images) {
        a.truncated = true;
        return;
      }
      const info = imageInfo(item.data, item.mimeType, s.policy);
      PNG.sync.read(info.bytes, { checkCRC: true });
      item.width = info.width;
      item.height = info.height;
    } else if (!["text", "value"].includes(item.type))
      fail("OUTPUT_INVALID", "Unknown output type", "output");
    if (item.type !== "image" && a.bytes + bytes > s.policy.outputBytes) {
      a.truncated = true;
      return;
    }
    if (item.type !== "image") a.bytes += bytes;
    const { cell, ...payload } = item;
    const output = {
      ...payload,
      itemId: uuid(),
      executionId: a.id,
      seq: a.output.length + 1,
    } as OutputItem;
    a.output.push(output);
    if (s.config.onOutput) {
      if (a.consumerBusy) {
        a.truncated = true;
        return;
      }
      a.consumerBusy = true;
      try {
        const consumption = s.config.onOutput({
          ...output,
          sessionId: s.ref.sessionId,
          kernelEpoch: s.epoch,
        });
        if (consumption && typeof consumption.then === "function") {
          void bounded(
            Promise.resolve(consumption),
            s.policy.consumerMs,
            () => {
              a.truncated = true;
            },
          )
            .catch(() => {
              a.truncated = true;
            })
            .finally(() => {
              a.consumerBusy = false;
            });
        } else a.consumerBusy = false;
      } catch {
        a.consumerBusy = false;
        a.truncated = true;
      }
    }
  }
  async #rpc(s: Session, a: Active, m: any) {
    if (a.seen.has(m.rpcId)) return; // duplicate frames never redispatch
    if (a.seen.size >= s.policy.rpcCount) {
      await this.#terminate(s, "failed", "RPC_LIMIT");
      return;
    }
    a.seen.add(m.rpcId);
    const correlation = {
      sessionId: s.ref.sessionId,
      kernelEpoch: s.epoch,
      executionId: a.id,
      rpcId: String(m.rpcId),
    };
    const receipt: ExternalReceipt = {
      ...correlation,
      provider: "unknown",
      method: "unknown",
      stage: "validation",
      dispatched: "no",
      outcome: "known",
    };
    let controller: AbortController | undefined,
      timeout: NodeJS.Timeout | undefined;
    const reply = (response: unknown) => {
      if (s.active === a && !a.finalized && s.child)
        this.#send(s, {
          type: "rpcResult",
          epoch: s.epoch,
          rpcId: m.rpcId,
          response,
        });
    };
    try {
      if (a.receipts.length >= s.policy.rpcCount)
        fail("RPC_LIMIT", "RPC budget exceeded");
      if (m.capabilityRevision !== s.config.capabilityRevision)
        fail("CAPABILITY_REVISION_CHANGED", "Stale RPC capability revision");
      const request = JSON.parse(m.request);
      if (request.cell !== a.id) {
        reply({
          error: {
            code: "EXECUTION_STALE",
            message: "Callback belongs to a completed cell",
            stage: "dispatch",
          },
        });
        return;
      }
      a.receipts.push(receipt);
      if (m.capabilityRevision !== s.config.capabilityRevision)
        fail("CAPABILITY_REVISION_CHANGED", "Stale RPC capability revision");
      if (Buffer.byteLength(m.request) > s.policy.codeBytes)
        fail("RPC_FRAME_LIMIT", "RPC arguments exceed budget");
      if (
        request.cell !== a.id ||
        a.stopped ||
        a.context.authorizationRevision !== s.revision ||
        s.revoked
      )
        fail(
          "AUTHORIZATION_REVOKED",
          "Execution authorization is no longer valid",
        );
      if (a.pending.size >= s.policy.pending)
        fail("PENDING_LIMIT", "Pending RPC budget exceeded");
      let method: Method | undefined, resource: Resource | undefined;
      if (request.provider === "$resource") {
        resource = s.resources.get(request.resourceId);
        if (
          !resource ||
          resource.epoch !== s.epoch ||
          resource.definition.expiresAt < Date.now()
        )
          fail("RESOURCE_EXPIRED", "Resource is no longer valid");
        method = resource!.methods.get(request.method);
        receipt.provider = resource!.provider;
      } else {
        receipt.provider = request.provider;
        method = s.providers.get(request.provider)?.methods.get(request.method);
      }
      receipt.method = request.method;
      if (!method) fail("UNSUPPORTED_CAPABILITY", "Method is not registered");
      const args = freezeDeep(structuredClone(request.args));
      if (!method!.validate(args))
        fail("INVALID_ARGUMENT", "Arguments do not match method schema");
      controller = new AbortController();
      a.pending.set(m.rpcId, controller);
      timeout = setTimeout(
        () => controller!.abort(),
        Math.min(s.policy.rpcMs, Math.max(1, a.deadline - Date.now())),
      );
      const authRequest = {
        ...correlation,
        provider: receipt.provider,
        method: receipt.method,
        args,
        target: resource?.definition.target,
        context: Object.freeze({ ...a.context }),
        signal: controller.signal,
      };
      receipt.stage = "authorization";
      const allow = await bounded(
        Promise.resolve(s.config.authorize(Object.freeze(authRequest))),
        Math.min(s.policy.approvalMs, a.deadline - Date.now()),
        () => false,
      );
      if (allow !== true)
        fail(
          "PERMISSION_DENIED",
          "Authorization denied or expired",
          "authorization",
        );
      if (
        a.stopped ||
        controller.signal.aborted ||
        s.revoked ||
        s.revision !== a.context.authorizationRevision ||
        s.active !== a ||
        (resource &&
          (s.resources.get(resource.ref.resourceId) !== resource ||
            resource.definition.expiresAt < Date.now()))
      )
        fail(
          "AUTHORIZATION_REVOKED",
          "Authorization changed before dispatch",
          "authorization",
        );
      receipt.stage = "handler";
      receipt.dispatched = "yes";
      receipt.outcome = method!.mutation ? "unknown" : "known";
      const context: HandlerContext = {
        ...correlation,
        trusted: authRequest.context,
        signal: controller.signal,
        deadline: Math.min(a.deadline, Date.now() + s.policy.rpcMs),
        resource: (definition) => {
          if (a.stopped || s.active !== a || controller!.signal.aborted)
            fail(
              "EXECUTION_STALE",
              "Cannot register a resource after cancellation",
            );
          if (s.resources.size >= s.policy.handles)
            fail("HANDLE_LIMIT", "Resource budget exceeded");
          const ref = Object.freeze({ resourceId: uuid() });
          const expiry = setTimeout(
            () => {
              const resource = s.resources.get(ref.resourceId);
              if (!resource) return;
              s.resources.delete(ref.resourceId);
              void bounded(
                Promise.resolve().then(() =>
                  resource.definition.cleanup("deadline"),
                ),
                s.policy.cleanupMs,
                () => "unknown" as Cleanup,
              ).then(
                (result) => {
                  if (result !== "confirmed") s.blocked = "CLEANUP_UNKNOWN";
                },
                () => {
                  s.blocked = "CLEANUP_UNKNOWN";
                },
              );
            },
            Math.max(
              1,
              Math.min(definition.expiresAt - Date.now(), s.policy.retentionMs),
            ),
          );
          expiry.unref();
          s.resources.set(ref.resourceId, {
            ref,
            expiry,
            provider: receipt.provider,
            definition: { ...definition },
            methods: methods(definition.methods),
            epoch: s.epoch,
          });
          return ref;
        },
        receipt: (details) => {
          if (!a.finalized) Object.assign(receipt, structuredClone(details));
        },
      };
      const value = await bounded(
        Promise.resolve(
          method!.handler(args, context, resource?.definition.value),
        ),
        Math.max(1, context.deadline - Date.now()),
        () => {
          controller!.abort();
          fail(
            "RPC_TIMEOUT",
            "Service deadline reached; effect may be unknown",
            "handler",
          );
        },
      );
      if (a.stopped || controller.signal.aborted)
        fail(
          "RPC_CANCELLED",
          "Call cancelled; effect may be unknown",
          "handler",
        );
      const encoded = this.#encode(s, value);
      if (!method!.validateResult(encoded))
        fail(
          "INVALID_RESULT",
          "Provider result does not match schema",
          "result",
        );
      if (receipt.stage === "handler") {
        receipt.stage = "completed";
        receipt.outcome = "known";
      }
      reply({ value: encoded });
    } catch (e) {
      receipt.error = safeError(e);
      receipt.stage = receipt.error.stage;
      if (receipt.dispatched === "yes" && receipt.outcome === "unknown")
        s.blocked = "UNKNOWN_EXTERNAL_EFFECT";
      reply({ error: receipt.error });
    } finally {
      if (timeout) clearTimeout(timeout);
      a.pending.delete(m.rpcId);
    }
  }
  #encode(s: Session, value: any): Json {
    if (value && typeof value === "object") {
      const resource = s.resources.get(value.resourceId);
      if (resource && resource.ref === value)
        return {
          __resource: value.resourceId,
          methods: [...resource.methods.keys()],
        };
      if (Object.hasOwn(value, "__resource"))
        return fail(
          "INVALID_RESULT",
          "Reserved resource envelope in ordinary JSON",
          "result",
        );
      if (Array.isArray(value)) return value.map((v) => this.#encode(s, v));
      const result: Record<string, Json> = Object.create(null);
      for (const [k, d] of Object.entries(
        Object.getOwnPropertyDescriptors(value),
      )) {
        if (!("value" in d))
          fail(
            "INVALID_RESULT",
            "Provider results must not contain accessors",
            "result",
          );
        result[k] = this.#encode(s, d.value);
      }
      return result;
    }
    if (value === undefined) return null;
    if (
      value === null ||
      ["string", "number", "boolean"].includes(typeof value)
    )
      return value;
    return fail(
      "INVALID_RESULT",
      "Provider must return JSON or registered resources",
      "result",
    );
  }
  #finish(
    s: Session,
    a: Active,
    status: ExecResult["status"],
    error?: DomainError,
    warnings: ExecResult["warnings"] = [],
  ) {
    if (a.finalized) return;
    a.finalized = true;
    clearTimeout(a.timer);
    const unknown = a.receipts.some((r) => r.outcome === "unknown");
    if (unknown) s.blocked = "UNKNOWN_EXTERNAL_EFFECT";
    const result: ExecResult = {
      accepted: true,
      executionId: a.id,
      kernelEpoch: s.epoch,
      status,
      output: a.output,
      bindings: s.child ? "retained" : "unavailable",
      error,
      warnings,
      externalCalls: {
        pending: a.pending.size,
        outcome: unknown ? "unknown" : a.receipts.length ? "known" : "none",
      },
      receipts: structuredClone(a.receipts),
      diagnostics: {
        truncated: a.truncated,
        durationMs: Date.now() - a.start,
        recovery: s.blocked
          ? [
              "Reconcile external effects with backend before reset or further input.",
            ]
          : s.child
            ? ["Continue with a new cell."]
            : ["Reset to create a new epoch; bindings are lost."],
      },
    };
    s.last = result;
    s.active = undefined;
    s.state = s.child ? "ready" : "faulted";
    s.lastUsed = Date.now();
    try {
      s.config.onDiagnostic?.({
        sessionId: s.ref.sessionId,
        kernelEpoch: s.epoch,
        executionId: a.id,
        stage: "terminal",
        code: status,
        durationMs: result.diagnostics.durationMs,
      });
    } catch {}
    a.resolve(result);
  }
  async #terminate(s: Session, status: ExecResult["status"], code: string) {
    const a = s.active;
    if (a?.stopped) return;
    if (a) a.stopped = true;
    for (const controller of a?.pending.values() ?? []) controller.abort();
    const child = s.child;
    s.child = undefined;
    clearInterval(s.rssTimer);
    child?.kill("SIGKILL");
    if (child)
      await bounded(
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once("exit", () => resolve());
        }),
        s.policy.cleanupMs,
        () => undefined,
      );
    if (a)
      this.#finish(
        s,
        a,
        status,
        a.completion?.error ?? {
          code,
          message: "Execution stopped; inspect external receipts separately.",
          stage: "supervisor",
        },
        a.completion?.warnings,
      );
    s.state = "faulted";
  }
  async cancel(ref: SessionRef, executionId: string): Promise<CancelResult> {
    const s = this.#get(ref);
    if (s.active?.id !== executionId)
      return {
        stopped: !s.active,
        kernelAlive: !!s.child,
        cleanup: s.blocked ? "unknown" : "confirmed",
        executionId,
        recovery: [],
      };
    await this.#terminate(s, "cancelled", "CELL_CANCELLED");
    return {
      stopped: true,
      kernelAlive: false,
      cleanup: s.blocked ? "unknown" : "confirmed",
      executionId,
      recovery: ["Reconcile unknown effects, then reset."],
    };
  }
  async #cleanup(s: Session, reason: string): Promise<Cleanup> {
    for (const resource of s.resources.values()) clearTimeout(resource.expiry);
    const calls = [...s.resources.values()].map((r) =>
      Promise.resolve().then(() => r.definition.cleanup(reason)),
    );
    s.resources.clear();
    for (const p of s.config.providers ?? [])
      if (p.dispose)
        calls.push(
          Promise.resolve().then(() => p.dispose!(s.ref.sessionId, reason)),
        );
    const result = await bounded(
      Promise.allSettled(calls),
      s.policy.cleanupMs,
      () => [],
    );
    if (
      result.length !== calls.length ||
      result.some((r) => r.status !== "fulfilled" || r.value !== "confirmed")
    ) {
      s.blocked = "CLEANUP_UNKNOWN";
      return "unknown";
    }
    return s.blocked ? "unknown" : "confirmed";
  }
  async reset(ref: SessionRef): Promise<ResetResult> {
    const s = this.#get(ref),
      oldEpoch = s.epoch;
    if (s.active || ["disposed", "expired"].includes(s.state) || s.blocked)
      return {
        reset: false,
        oldEpoch,
        kernelEpoch: s.epoch,
        invalidated: [],
        cleanup: s.blocked ? "unknown" : "confirmed",
        error: s.active ? "BUSY" : (s.blocked ?? "SESSION_DISPOSED"),
      };
    const cleanup = await this.#cleanup(s, "reset");
    if (cleanup !== "confirmed")
      return {
        reset: false,
        oldEpoch,
        kernelEpoch: s.epoch,
        invalidated: ["resources"],
        cleanup,
        error: "CLEANUP_UNKNOWN",
      };
    const child = s.child;
    s.child = undefined;
    clearInterval(s.rssTimer);
    child?.kill("SIGKILL");
    if (child)
      await bounded(
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once("exit", () => resolve());
        }),
        s.policy.cleanupMs,
        () => undefined,
      );
    s.epoch = uuid();
    s.state = "new";
    s.last = undefined;
    s.lastUsed = Date.now();
    // Lazy epoch: bootstrap is performed at next execute; never report ready before it succeeds.
    return {
      reset: true,
      oldEpoch,
      kernelEpoch: s.epoch,
      invalidated: ["bindings", "modules", "resources", "documentation"],
      cleanup,
    };
  }
  async dispose(ref: SessionRef): Promise<DisposeResult> {
    const s = this.#get(ref);
    if (s.active) await this.cancel(ref, s.active.id);
    const child = s.child;
    s.child = undefined;
    clearInterval(s.rssTimer);
    child?.kill("SIGKILL");
    if (child)
      await bounded(
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once("exit", () => resolve());
        }),
        s.policy.cleanupMs,
        () => undefined,
      );
    const cleanup = await this.#cleanup(s, "dispose");
    s.state = "disposed";
    s.cache.clear();
    s.last = undefined;
    s.providers.clear();
    s.config = {
      ...s.config,
      providers: [],
      modules: [],
      onOutput: undefined,
      onDiagnostic: undefined,
    };
    this.#disposed.set(ref, s);
    this.#sessions.delete(ref);
    return {
      disposed: true,
      stopped: true,
      kernelAlive: false,
      cleanup,
      recovery: cleanup === "unknown" ? ["Reconcile external effects."] : [],
    };
  }
  async close() {
    clearInterval(this.#idle);
    await Promise.all(
      [...this.#sessions.keys()].map((ref) => this.dispose(ref)),
    );
  }
}
