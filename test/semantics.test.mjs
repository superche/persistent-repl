import test from "node:test";
import assert from "node:assert/strict";
import { fixture, values } from "./helpers.mjs";
test("AT01 AT02: persistent identities, cell closures, declarations and top-level await", async (t) => {
  const { run } = await fixture(t);
  assert.equal(
    (
      await run(
        "let count=1; let box={value:1}; function readOldCount(){return count}; function readSharedBox(){return box.value}; const original=box; class C {value(){return 4}}; const [a,b]=[3,4];",
      )
    ).status,
    "completed",
  );
  assert.deepEqual(
    values(
      await run(
        "count=2; box.value=2; output.value([count,readOldCount(),readSharedBox(),original===box,new C().value(),a,b]);",
      ),
    )[0],
    [2, 1, 2, true, 4, 3, 4],
  );
  assert.equal(
    (
      await run(
        "let count=8; const a=7; var b=6; class C {}; function f(){}; output.value(await Promise.resolve(count));",
      )
    ).status,
    "completed",
  );
  assert.equal(
    (await run("let duplicate=1; let duplicate=2;")).error.code,
    "SYNTAX_ERROR",
  );
});
test("AT03: inherited const writes warn, same-cell const remains immutable", async (t) => {
  const { run } = await fixture(t);
  await run("const fixed=1; function read(){return fixed;}");
  const result = await run(
    "fixed++; fixed+=2; ({fixed}={fixed:9}); output.value([fixed,read()]);",
  );
  assert.deepEqual(values(result)[0], [9, 1]);
  assert.ok(result.warnings.length >= 3);
  assert.equal((await run("const local=1; local=2;")).status, "failed");
});
const cases = [
  ["let old=fail();", "output.value(old)", [10]],
  ["let [a,b=fail()]=[1,undefined];", "output.value(a); b;", [1]],
  [
    'throw new Error("fixture"); var v=1; function later(){return 1;}',
    "v;",
    [],
  ],
  [
    'throw new Error("fixture"); var v=1; function later(){return 1;}',
    "later;",
    [],
  ],
  ['v=4; throw new Error("fixture"); var v;', "output.value(v)", [4]],
  [
    'var v; throw new Error("fixture");',
    "output.value(v)",
    [{ $type: "Undefined" }],
  ],
  [
    'output.value(later()); throw new Error("fixture"); function later(){return 7;}',
    "output.value(later())",
    [7],
  ],
];
for (const [code, next, expected] of cases)
  test("AT03 AT04 oracle: " + code, async (t) => {
    const { run } = await fixture(t);
    await run('let old=10; function fail(){throw new Error("fixture")}');
    assert.equal((await run(code)).status, "failed");
    const r = await run(next);
    assert.deepEqual(values(r), expected);
    if (next === "v;" || next === "later;" || next.endsWith(" b;"))
      assert.equal(r.status, "failed");
  });
test("AT04: partial progress survives; no history replay", async (t) => {
  const { run, counter } = await fixture(t);
  await run(
    "let keep={n:1}; let before=10; await services.counter.add({amount:1});",
  );
  await run(
    'keep.n=2; let ready=3; throw new Error("fixture"); let unreachable=4;',
  );
  assert.deepEqual(
    values(await run("output.value([keep.n,before,ready]);"))[0],
    [2, 10, 3],
  );
  assert.equal((await run("unreachable;")).status, "failed");
  await run("let syntax = ;");
  assert.equal(counter.calls.length, 1);
});
test("AT05: registered module cache/reload, dependency boundaries, static imports", async (t) => {
  const { run } = await fixture(t, {
    modules: [
      {
        name: "fixture",
        version: "1",
        license: "MIT",
        kind: "package",
        source: "export const object={};",
      },
      {
        name: "workspace",
        version: "1",
        license: "MIT",
        kind: "workspace",
        reload: "next-cell",
        source: "export const object={};",
      },
    ],
  });
  await run(
    'const m=await import("fixture"); const w=await import("workspace");',
  );
  assert.deepEqual(
    values(
      await run(
        'output.value([m===(await import("fixture")),w===(await import("workspace"))]);',
      ),
    )[0],
    [true, false],
  );
  for (const path of [
    "node:fs",
    "../secret",
    "/etc/passwd",
    "https://example.com",
    "file:///etc/passwd",
  ])
    assert.equal(
      (await run(`await import(${JSON.stringify(path)});`)).status,
      "failed",
    );
  assert.match(
    (await run('import x from "fixture";')).error.message,
    /Static import/,
  );
});
test("AT16: safe deterministic values never call getters/toJSON", async (t) => {
  const { run } = await fixture(t);
  const r = await run(
    'let hits=0; let v={get secret(){hits++;return 1},toJSON(){hits++;return "bad"}}; v.self=v; output.value([undefined,12n,new Map([[1,2]]),new Set([3]),new Uint8Array([4,5]),new Error("fixture"),v]); output.value(hits);',
  );
  assert.equal(r.status, "completed");
  assert.equal(values(r)[1], 0);
  assert.equal(values(r)[0][0].$type, "Undefined");
  assert.equal(values(r)[0][1].$type, "BigInt");
  assert.equal(values(r)[0][6].secret.$type, "Accessor");
});
test("AT10 AT19: module async errors, dependency denial and Promise combinations preserve boundaries", async (t) => {
  const { run, counter } = await fixture(t, {
    modules: [
      {
        name: "async-fixture",
        kind: "package",
        version: "1",
        license: "MIT",
        source:
          'export async function fail(){throw new Error("module rejection")}; export async function join(p){return await p};',
      },
      {
        name: "denied-dependency",
        kind: "package",
        version: "1",
        license: "MIT",
        source: 'import "node:fs"; export const x=1;',
      },
    ],
  });
  await run('let m=await import("async-fixture");');
  assert.equal((await run("m.fail();")).error.code, "UNHANDLED_REJECTION");
  assert.equal(
    (await run('await import("denied-dependency")')).status,
    "failed",
  );
  assert.equal(
    (
      await run(
        "output.value(await Promise.all([m.join(3),Promise.resolve(4)]));",
      )
    ).status,
    "completed",
  );
  await run(
    "let done; let p=new Promise(r=>done=r); Promise.all([p]).finally(()=>services.counter.add({amount:90}));",
  );
  await run("done(1); await Promise.resolve();", {}, { turnKey: "turn/new" });
  assert.equal(counter.calls.length, 0);
});
test("AT16: typed-array and DataView shadowing getters never run during output", async (t) => {
  const { run, counter } = await fixture(t);
  const r = await run(
    'let touched=0; let typed=new Uint8Array([7,8]); let view=new DataView(new Uint8Array([9,10]).buffer); for(const v of [typed,view])for(const key of ["buffer","byteOffset","byteLength"])Object.defineProperty(v,key,{get(){touched++;services.counter.add({amount:1});throw new Error("getter called")}});output.value(typed);output.value(view);output.value(touched);',
  );
  assert.equal(r.status, "completed");
  assert.equal(counter.calls.length, 0);
  assert.deepEqual(values(r), [
    { $type: "TypedArray", values: [7, 8] },
    { $type: "TypedArray", values: [9, 10] },
    0,
  ]);
});
