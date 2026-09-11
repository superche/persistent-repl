import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileRecoveryJournal,
  ReplHost,
  SEMANTICS_VERSION,
} from "@superche/persistent-repl";
import { createCounterProvider } from "@superche/persistent-repl-testing";
const base = {
  ownerKey: "fixture",
  taskKey: "durable-task",
  semanticsVersion: SEMANTICS_VERSION,
  capabilityRevision: "1",
  authorizationRevision: "1",
  authorize: () => true,
};
const ctx = (callKey) => ({
  ownerKey: "fixture",
  taskKey: "durable-task",
  turnKey: "1",
  callKey,
  authorizationRevision: "1",
});
const directory = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "repl-recovery-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
test(
  "AT13 AT14: killed supervisor leaves durable intent, fresh host blocks until trusted reconciliation",
  { timeout: 15000 },
  async (t) => {
    const dir = directory(t);
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
 import {ReplHost,FileRecoveryJournal,SEMANTICS_VERSION} from '@superche/persistent-repl';
 const host=new ReplHost();
 let session;
 session=await host.create({ownerKey:'fixture',taskKey:'durable-task',semanticsVersion:SEMANTICS_VERSION,capabilityRevision:'1',authorizationRevision:'1',recovery:new FileRecoveryJournal(process.env.REPL_TEST_JOURNAL),authorize:()=>true,providers:[{name:'writer',version:'1',documentation:'fixture',methods:{write:{params:{type:'object'},result:{},documentation:'fixture',mutation:true,handler:async()=>{process.stdout.write(String((await host.status(session)).kernelPid)+'\\n');return new Promise(()=>{});}}}}]});
 await host.execute(session,{code:'await services.writer.write({secret:"SYNTHETIC_SECRET_ONLY"})'},{ownerKey:'fixture',taskKey:'durable-task',turnKey:'1',callKey:'1',authorizationRevision:'1'});
 `,
      ],
      {
        env: { ...process.env, REPL_TEST_JOURNAL: dir },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    t.after(() => child.kill("SIGKILL"));
    const [data] = await once(child.stdout, "data");
    const kernelPid = Number(String(data).trim());
    assert.ok(kernelPid > 1);
    const exit = once(child, "exit");
    child.kill("SIGKILL");
    await exit;
    const host = new ReplHost();
    t.after(() => host.close());
    const counter = createCounterProvider();
    const session = await host.create({
      ...base,
      providers: [counter.provider],
      recovery: new FileRecoveryJournal(dir),
    });
    assert.equal(
      (await host.status(session)).blockedReason,
      "RECOVERY_REQUIRED",
    );
    assert.equal(host.recoveryStatus(session).pending.length, 1);
    assert.equal(
      (
        await host.execute(
          session,
          { code: "await services.counter.add({amount:1})" },
          ctx("2"),
        )
      ).code,
      "SESSION_BLOCKED",
    );
    assert.equal((await host.reset(session)).reset, false);
    assert.equal(counter.calls.length, 0);
    const journal = readFileSync(
      join(dir, readdirSync(dir)[0], "state.json"),
      "utf8",
    );
    assert.ok(
      !journal.includes("SYNTHETIC_SECRET_ONLY") &&
        !journal.includes("await services"),
    );
    host.reconcile(session, "confirmed");
    assert.equal(
      (
        await host.execute(
          session,
          { code: "await services.counter.add({amount:1})" },
          ctx("3"),
        )
      ).status,
      "completed",
    );
    assert.equal(counter.calls.length, 1);
    assert.equal(host.recoveryStatus(session).pending.length, 0);
    await host.close();
    assert.equal(readdirSync(dir).length, 0);
    let alive = true;
    for (let i = 0; i < 100; i++) {
      try {
        process.kill(kernelPid, 0);
      } catch {
        alive = false;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(alive, false, "kernel terminates after supervisor pipe EOF");
  },
);
test("AT14: concurrent live host cannot steal a task lease; completed cleanup allows a new epoch", async (t) => {
  const dir = directory(t);
  const journal = new FileRecoveryJournal(dir);
  const a = new ReplHost(),
    b = new ReplHost();
  t.after(() => Promise.all([a.close(), b.close()]));
  const one = await a.create({ ...base, recovery: journal });
  const two = await b.create({
    ...base,
    recovery: new FileRecoveryJournal(dir),
  });
  assert.equal((await b.status(two)).canContinue, false);
  assert.throws(() => b.reconcile(two, "confirmed"), /RECOVERY_OWNER_ACTIVE/);
  await b.close();
  await a.close();
  const c = new ReplHost();
  t.after(() => c.close());
  const three = await c.create({ ...base, recovery: journal });
  assert.notEqual(
    (await c.status(three)).kernelEpoch,
    (await a.status(one)).kernelEpoch,
  );
  assert.equal((await c.status(three)).canContinue, true);
});
test("AT14: durable intent failure refuses dispatch and unknown outcome blocks the same cell", async (t) => {
  const counter = createCounterProvider();
  const host = new ReplHost();
  t.after(() => host.close());
  const session = await host.create({
    ...base,
    providers: [counter.provider],
    recovery: {
      open: () => ({
        blocked: false,
        pending: [],
        begin() {
          throw Error("fixture disk full");
        },
        settle() {},
        reconcile() {},
        close() {},
      }),
    },
  });
  const r = await host.execute(
    session,
    { code: "await services.counter.add({amount:1})" },
    ctx("1"),
  );
  assert.equal(counter.calls.length, 0);
  assert.equal(r.receipts[0].dispatched, "no");
  assert.equal(r.error.code, "RECOVERY_WRITE_FAILED");
  const other = await host.create({ ...base, providers: [counter.provider] });
  const unknown = await host.execute(
    other,
    {
      code: "try { await services.counter.unknown({}); } catch {} try { await services.counter.add({amount:1}); } catch {}",
    },
    ctx("2"),
  );
  assert.equal(unknown.externalCalls.outcome, "unknown");
  assert.equal(unknown.receipts.at(-1).dispatched, "no");
});
test(
  "AT13: supervisor death interrupts a running guest loop without waiting for the wall deadline",
  { timeout: 15000 },
  async (t) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
 import {ReplHost,SEMANTICS_VERSION} from '@superche/persistent-repl';
 const h=new ReplHost();let s;
 s=await h.create({ownerKey:'fixture',taskKey:'cpu-crash',semanticsVersion:SEMANTICS_VERSION,capabilityRevision:'1',authorizationRevision:'1',authorize:()=>true,onOutput:()=>{h.status(s).then(x=>process.stdout.write(String(x.kernelPid)+'\\n'))}});
 await h.execute(s,{code:'output.text("started"); while(true){}'},{ownerKey:'fixture',taskKey:'cpu-crash',turnKey:'1',callKey:'1',authorizationRevision:'1'});
 `,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    t.after(() => child.kill("SIGKILL"));
    const [data] = await once(child.stdout, "data");
    const pid = Number(String(data).trim());
    assert.ok(pid > 1);
    const exit = once(child, "exit");
    child.kill("SIGKILL");
    await exit;
    let alive = true;
    for (let i = 0; i < 100; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(alive, false);
  },
);
