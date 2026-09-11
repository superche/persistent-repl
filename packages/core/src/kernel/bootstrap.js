// Evaluated only inside QuickJS. Host receives JSON frames, never guest objects.
(function (sendRPC, emitFrame, config) {
  "use strict";
  const store = new Map(),
    kinds = new Map(),
    modules = new Map();
  let active, getters, declared, marks, origin;
  const NativePromise = Promise;
  const records = new Set(),
    promiseRecords = new WeakMap();
  let internalPromise = false;
  const observe = (promise, yes, no) => {
    const prior = internalPromise;
    internalPromise = true;
    try {
      return NativePromise.prototype.then.call(promise, yes, no);
    } finally {
      internalPromise = prior;
    }
  };
  function CellPromise(executor) {
    const promise = new NativePromise(executor);
    Object.setPrototypeOf(promise, CellPromise.prototype);
    const rec = {
      owner: origin || active?.id,
      handled: false,
      rejected: false,
    };
    records.add(rec);
    promiseRecords.set(promise, rec);
    observe(
      promise,
      () => {
        records.delete(rec);
      },
      () => {
        rec.rejected = true;
      },
    );
    return promise;
  }
  CellPromise.prototype = Object.create(null);
  Object.defineProperty(CellPromise.prototype, "constructor", {
    value: CellPromise,
  });
  Object.defineProperty(CellPromise, Symbol.species, {
    get() {
      return internalPromise ? NativePromise : CellPromise;
    },
  });
  CellPromise.prototype.then = function (fulfilled, rejected) {
    const rec = promiseRecords.get(this);
    if (!rec) throw new TypeError("Invalid Promise receiver");
    rec.handled = true;
    records.delete(rec);
    const owner = origin || active?.id;
    const wrap = (fn) =>
      typeof fn !== "function"
        ? fn
        : (value) => {
            const prior = origin;
            origin = owner;
            try {
              return fn(value);
            } finally {
              origin = prior;
            }
          };
    const p = observe(this, wrap(fulfilled), wrap(rejected));
    return new CellPromise((resolve, reject) => observe(p, resolve, reject));
  };
  CellPromise.prototype.catch = function (rejected) {
    return this.then(undefined, rejected);
  };
  CellPromise.prototype.finally = function (callback) {
    if (typeof callback !== "function") return this.then(callback, callback);
    return this.then(
      (value) => CellPromise.resolve(callback()).then(() => value),
      (error) =>
        CellPromise.resolve(callback()).then(() => {
          throw error;
        }),
    );
  };
  for (const name of [
    "resolve",
    "reject",
    "all",
    "allSettled",
    "any",
    "race",
    "withResolvers",
    "try",
  ])
    if (typeof NativePromise[name] === "function")
      Object.defineProperty(CellPromise, name, {
        value: function (...args) {
          return Reflect.apply(NativePromise[name], CellPromise, args);
        },
      });
  Object.setPrototypeOf(CellPromise, null);
  Object.defineProperty(NativePromise.prototype, "constructor", {
    value: undefined,
  });
  Object.freeze(NativePromise.prototype);
  Object.freeze(NativePromise);
  globalThis.Promise = CellPromise;
  const J = JSON,
    own = Object.getOwnPropertyDescriptors,
    keys = Object.keys;
  const str = String,
    freeze = Object.freeze,
    tag = Object.prototype.toString;
  const define = Object.defineProperty;
  const viewAccessors = [
    Object.getPrototypeOf(Uint8Array.prototype),
    DataView.prototype,
  ].map((prototype) =>
    ["buffer", "byteOffset", "byteLength"].map(
      (name) => own(prototype)[name].get,
    ),
  );
  function serialize(value, depth = 0, seen = new Map(), budget = { n: 0 }) {
    if (++budget.n > 2000 || depth > 12)
      return { $type: "Truncated", reason: depth > 12 ? "depth" : "items" };
    if (value === undefined) return { $type: "Undefined" };
    if (typeof value === "bigint")
      return { $type: "BigInt", value: str(value) };
    if (typeof value === "number" && !Number.isFinite(value))
      return { $type: "Number", value: str(value) };
    if (
      value === null ||
      ["boolean", "number", "string"].includes(typeof value)
    )
      return typeof value === "string" && value.length > 65536
        ? { $type: "Truncated", reason: "string", value: value.slice(0, 65536) }
        : value;
    if (typeof value === "function" || typeof value === "symbol")
      return { $type: typeof value };
    if (seen.has(value)) return { $type: "Reference", id: seen.get(value) };
    seen.set(value, seen.size + 1);
    const next = (v) => serialize(v, depth + 1, seen, budget);
    if (value instanceof Map)
      return {
        $type: "Map",
        entries: Array.from(Map.prototype.entries.call(value), ([k, v]) => [
          next(k),
          next(v),
        ]).slice(0, 2000),
      };
    if (value instanceof Set)
      return {
        $type: "Set",
        values: Array.from(Set.prototype.values.call(value), next).slice(
          0,
          2000,
        ),
      };
    if (ArrayBuffer.isView(value)) {
      // Read internal view slots through captured intrinsics. Own shadowing getters
      // such as value.buffer must never execute merely because a value is displayed.
      let fields;
      try {
        fields = viewAccessors[0].map((get) => Reflect.apply(get, value, []));
      } catch {
        fields = viewAccessors[1].map((get) => Reflect.apply(get, value, []));
      }
      return {
        $type: "TypedArray",
        values: Array.from(
          new Uint8Array(fields[0], fields[1], Math.min(fields[2], 2048)),
        ),
      };
    }
    const descriptors = own(value),
      result = Array.isArray(value) ? [] : Object.create(null);
    for (const k of keys(descriptors).slice(0, 2000)) {
      if (k === "length" && Array.isArray(value)) continue;
      const d = descriptors[k];
      define(result, k, {
        value:
          "value" in d ? next(d.value) : { $type: "Accessor", omitted: true },
        enumerable: true,
        configurable: true,
      });
    }
    if (value instanceof Error) return { $type: "Error", properties: result };
    return result;
  }
  function decode(value) {
    if (value && value.__resource) {
      const proxy = Object.create(null);
      define(proxy, "resourceId", {
        value: value.__resource,
        enumerable: true,
      });
      for (const name of value.methods)
        define(proxy, name, {
          value: (args = {}) =>
            rpc(origin || active.id, "$resource", name, args, value.__resource),
          enumerable: true,
        });
      return freeze(proxy);
    }
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === "object") {
      for (const k of keys(value)) value[k] = decode(value[k]);
    }
    return value;
  }
  function rpc(cell, provider, method, args, resourceId) {
    const payload = J.stringify({ cell, provider, method, args, resourceId });
    return CellPromise.resolve(sendRPC(payload)).then((raw) => {
      const response = J.parse(raw);
      if (response.error)
        throw Object.assign(new Error(response.error.message), response.error);
      return decode(response.value);
    });
  }
  const services = Object.create(null);
  for (const provider of config.providers) {
    const service = Object.create(null);
    for (const method of provider.methods)
      define(service, method, {
        value: (args = {}) =>
          rpc(origin || active.id, provider.name, method, args),
        enumerable: true,
      });
    services[provider.name] = freeze(service);
  }
  const facades = Object.fromEntries(
    config.facades.map((facade) => [facade.global, facade.factory(services)]),
  );
  function begin(id) {
    active = { id };
    getters = {};
    declared = [];
    marks = new Set();
    const out = (type, value) =>
      emitFrame(J.stringify({ cell: origin || active.id, type, ...value }));
    const output = freeze({
      text: (value) =>
        out("text", {
          text:
            typeof value === "string" ? value : J.stringify(serialize(value)),
        }),
      value: (value) => out("value", { value: serialize(value) }),
      image: (data, mimeType = "image/png", identity) =>
        out("image", {
          data,
          mimeType,
          identity: identity === undefined ? undefined : serialize(identity),
        }),
    });
    const globals = {
      output,
      services: freeze(services),
      console: freeze({
        log: (...v) => output.value(v),
        warn: (...v) => output.value(v),
        error: (...v) => output.value(v),
      }),
    };
    Object.assign(globals, facades);
    return freeze({
      ...globals,
      previous: (name) => store.get(name),
      register: (g, d) => {
        getters = g;
        declared = d;
      },
      assigned: (names, value) => {
        names.forEach((n) => marks.add(n));
        return value;
      },
      used: (name, value) => {
        marks.add(name);
        return value;
      },
      mark: (names) => names.forEach((n) => marks.add(n)),
      commit: () => {
        for (const name of keys(getters)) {
          const declaration = declared.find((b) => b.name === name);
          if (
            declaration &&
            ["var", "hoisted"].includes(declaration.kind) &&
            !marks.has(name)
          )
            continue;
          try {
            store.set(name, getters[name]());
            if (declaration) kinds.set(name, declaration.kind);
          } catch (_) {
            /* TDZ retains prior valid binding */
          }
        }
      },
      importModule: (name) => {
        if (typeof name !== "string")
          throw new TypeError("Module specifier must be a string");
        const registration = config.modules.find((m) => m.name === name);
        if (!registration)
          throw Object.assign(new Error("Module is not registered"), {
            code: "MODULE_DENIED",
            stage: "link",
          });
        const cacheKey =
          registration.reload === "next-cell" ? name + ":" + id : name;
        if (!modules.has(cacheKey))
          modules.set(
            cacheKey,
            config.loadModule(
              name,
              registration.reload === "next-cell" ? id : "",
            ),
          );
        return CellPromise.resolve(modules.get(cacheKey));
      },
    });
  }
  // No guest timer, Proxy, eval, process, require, fs, network, shell or IPC globals.
  globalThis.eval = undefined;
  globalThis.Proxy = undefined;
  for (const f of [
    function () {},
    async function () {},
    function* () {},
    async function* () {},
  ]) {
    const p = Object.getPrototypeOf(f);
    Object.defineProperty(p, "constructor", { value: undefined });
    Object.freeze(p);
  }
  globalThis.Function = undefined;
  // Preserve native constructors while preventing guest mutation of serializer primitives.
  for (const constructor of [
    Object,
    Array,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Error,
    TypeError,
    Number,
    String,
    Boolean,
    BigInt,
    RegExp,
    Date,
    Uint8Array,
    ArrayBuffer,
  ]) {
    freeze(constructor.prototype);
    freeze(constructor);
  }
  freeze(J);
  freeze(Math);
  freeze(Reflect);
  freeze(globalThis);
  return {
    begin,
    unhandled: () =>
      J.stringify(
        Array.from(records).filter(
          (r) => r.owner === active.id && r.rejected && !r.handled,
        ).length,
      ),
    names: () =>
      J.stringify(
        Array.from(store.keys(), (name) => ({
          name,
          kind: kinds.get(name) || "let",
        })),
      ),
    serialize,
  };
});
