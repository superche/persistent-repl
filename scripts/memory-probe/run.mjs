// Bounded experimental fixture. This does not change the default ReplHost.
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir, release, cpus } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ReplHost, SEMANTICS_VERSION } from "@superche/persistent-repl";

if (process.argv[2] === "sandbox-child") {
  let readDenied = false;
  try {
    readFileSync("/etc/hosts");
  } catch (error) {
    readDenied = ["EPERM", "EACCES"].includes(error.code);
  }
  const processDenied = ["EPERM", "EACCES"].includes(
    spawnSync("/usr/bin/true").error?.code,
  );
  const networkDenied = await new Promise((resolve) => {
    const server = createServer();
    server.once("error", (error) =>
      resolve(["EPERM", "EACCES"].includes(error.code)),
    );
    server.listen(0, "127.0.0.1", () => server.close(() => resolve(false)));
  });
  console.log(
    JSON.stringify({
      readDenied,
      processDenied,
      networkDenied,
      pid: process.pid,
      parent: process.ppid,
    }),
  );
  process.exit(readDenied && processDenied && networkDenied ? 0 : 1);
}
if (process.argv[2] === "buffer-child") {
  const buffers = [];
  console.log(
    JSON.stringify({
      event: "identity",
      pid: process.pid,
      parent: process.ppid,
    }),
  );
  for (let i = 0; i < 128; i++) {
    buffers.push(Buffer.alloc(1024 * 1024, (i % 254) + 1));
    if ((i + 1) % 8 === 0)
      console.log(
        JSON.stringify({
          event: "allocation",
          allocatedMiB: i + 1,
          ...process.memoryUsage(),
        }),
      );
  }
  process.exit(0);
}

assert.equal(process.platform, "darwin", "This probe requires macOS.");
const directory = realpathSync(
  mkdtempSync(join(tmpdir(), "persistent-repl-memory-")),
);
const source = fileURLToPath(new URL("./", import.meta.url));
const launcher = join(directory, "footprint-exec");
const native = join(directory, "native-memory-probe");
const node = realpathSync(process.execPath);
const childPids = new Set();
const liveChildren = new Set();
let host;
const report = {
  fixture: true,
  experimental: true,
  changesDefaultRuntime: false,
  date: new Date().toISOString(),
  node: process.version,
  release: release(),
  arch: process.arch,
  cpu: cpus()[0].model,
  uid: process.getuid(),
  metric: "physical footprint; not identical to RSS",
};
const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { LANG: "en_US.UTF-8", TZ: "UTC" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    childPids.add(child.pid);
    liveChildren.add(child);
    let stdout = "",
      stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 5000);
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      liveChildren.delete(child);
      resolve({
        code,
        signal,
        timedOut,
        pid: child.pid,
        records: stdout.trim().split("\n").filter(Boolean).map(JSON.parse),
        stderr,
      });
    });
  });
const assertGone = (pid) =>
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
try {
  for (const [name, output] of [
    ["footprint-exec", launcher],
    ["native-memory-probe", native],
  ])
    execFileSync(
      "/usr/bin/clang",
      [
        "-O0",
        "-Wall",
        "-Wextra",
        "-Werror",
        join(source, name + ".c"),
        "-o",
        output,
      ],
      { stdio: "pipe" },
    );
  report.nativeBaseline = await run(native, ["none"]);
  assert.equal(report.nativeBaseline.records.at(-1).exit, 0);
  report.machSelf = await run(native, ["mach"]);
  report.nativeSpawn = await run(native, ["spawn"]);
  assert.equal(report.nativeSpawn.records.at(-1).signal, 9);
  assert.ok(report.nativeSpawn.records.some((r) => r.allocatedMiB === 28));
  report.nativeSetExec = await run(launcher, ["32", native, "child"]);
  assert.equal(report.nativeSetExec.signal, "SIGKILL");
  const childArgs = [fileURLToPath(import.meta.url), "buffer-child"];
  report.nodeBaseline = await run(node, childArgs);
  assert.equal(report.nodeBaseline.code, 0);
  assert.equal(report.nodeBaseline.records.at(-1).allocatedMiB, 128);
  report.nodeLimited = await run(launcher, ["96", node, ...childArgs]);
  assert.equal(report.nodeLimited.signal, "SIGKILL");
  assert.equal(report.nodeLimited.timedOut, false);
  assert.equal(
    report.nodeLimited.records[0].pid,
    report.nodeLimited.pid,
    "SETEXEC must preserve the host-visible PID",
  );
  assert.equal(report.nodeLimited.records[0].parent, process.pid);
  assert.ok(report.nodeLimited.records.at(-1).allocatedMiB < 128);

  const exits = [];
  report.fixtureStderr = [];
  let sandboxProfile;
  host = new ReplHost(1, (command, args, options) => {
    assert.equal(command, "/usr/bin/sandbox-exec");
    assert.equal(args[0], "-p");
    const profile =
      args[1] +
      `(allow process-exec (literal ${JSON.stringify(launcher)}))(allow file-read* (literal ${JSON.stringify(launcher)}))`;
    sandboxProfile = profile;
    const child = spawn(
      command,
      ["-p", profile, launcher, "128", ...args.slice(2)],
      options,
    );
    childPids.add(child.pid);
    child.stderr.on("data", (data) => report.fixtureStderr.push(String(data)));
    child.once("exit", (code, signal) =>
      exits.push({ pid: child.pid, code, signal }),
    );
    return child;
  });
  const config = {
    ownerKey: "memory-fixture",
    taskKey: "memory-probe",
    semanticsVersion: SEMANTICS_VERSION,
    capabilityRevision: "1",
    authorizationRevision: "1",
    authorize: () => true,
    // Deliberately raise the guest cap above the OS fixture cap to exercise process memory.
    // Keep RSS watchdog above the finite fixture allocation to distinguish an OS termination.
    policy: { heapBytes: 256 * 1024 ** 2, rssBytes: 512 * 1024 ** 2 },
  };
  const session = await host.create(config);
  let call = 0;
  const execute = (code) =>
    host.execute(
      session,
      { code, timeoutMs: 4000 },
      {
        ownerKey: config.ownerKey,
        taskKey: config.taskKey,
        turnKey: "1",
        callKey: String(++call),
        authorizationRevision: "1",
      },
    );
  report.initial = await execute("let saved=42; output.value(saved)");
  assert.equal(report.initial.status, "completed");
  report.sandbox = await run("/usr/bin/sandbox-exec", [
    "-p",
    sandboxProfile,
    launcher,
    "128",
    node,
    fileURLToPath(import.meta.url),
    "sandbox-child",
  ]);
  assert.equal(report.sandbox.code, 0);
  assert.equal(report.sandbox.records[0].pid, report.sandbox.pid);
  assert.equal(report.sandbox.records[0].parent, process.pid);
  const pid = (await host.status(session)).kernelPid;
  const began = performance.now();
  const pressure = await execute(
    "let buffers=[]; for(let i=0;i<192;i++){let b=new Uint8Array(1024*1024); b.fill(i%254+1); buffers.push(b)}",
  );
  const pressureMs = performance.now() - began;
  assert.equal(pressure.status, "crashed");
  assert.equal(exits.find((e) => e.pid === pid)?.signal, "SIGKILL");
  assertGone(pid);
  const reset = await host.reset(session);
  assert.equal(reset.reset, true);
  const afterReset = await execute("output.value(typeof saved)");
  assert.equal(afterReset.status, "completed");
  assert.equal(afterReset.output[0].value, "undefined");
  report.repl = {
    startup: "completed",
    pressureStatus: pressure.status,
    pressureMs,
    pressureDiagnostics: pressure.diagnostics,
    exits,
    reset: reset.reset,
    newEpoch: reset.kernelEpoch !== reset.oldEpoch,
    nextCell: afterReset.status,
    launcherAfterSandbox: true,
  };
  await host.close();
  host = undefined;
  for (const pid of childPids) assertGone(pid);
  report.remainingPids = 0;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ...report, failure: error.message }, null, 2));
  throw error;
} finally {
  await host?.close();
  for (const child of liveChildren) child.kill("SIGKILL");
  rmSync(directory, { recursive: true, force: true });
}
