import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const delivery = resolve("artifacts", version);
const metadata = JSON.parse(readFileSync(`${delivery}/packages.json`, "utf8"));
const temporary = mkdtempSync(join(tmpdir(), "persistent-repl-distribution-"));
const cache = resolve("artifacts/npm-cache");
const logs = resolve("artifacts/package-verification");
mkdirSync(logs, { recursive: true });
const results = [];
function run(name, command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 16 * 1024 ** 2,
    env: { ...process.env, NODE_PATH: "" },
  });
  writeFileSync(
    join(logs, `${name}.log`),
    (result.stdout ?? "") + (result.stderr ?? ""),
  );
  assert.equal(
    result.status,
    0,
    `${name} failed; see ${join(logs, name + ".log")}`,
  );
  results.push({ check: name, pass: true });
  console.log(`${name}: pass`);
}
try {
  for (const item of metadata.packages)
    assert.equal(
      createHash("sha256")
        .update(readFileSync(join(delivery, item.filename)))
        .digest("hex"),
      item.sha256,
    );
  const bundle = join(temporary, "bundle");
  cpSync(delivery, bundle, { recursive: true });
  run(
    "bundle-install",
    "npm",
    [
      "ci",
      "--ignore-scripts",
      "--cache",
      cache,
      "--registry=https://registry.npmjs.org",
    ],
    bundle,
  );
  run("bundle-tests", "npm", ["test"], bundle);
  for (const [name, script] of [
    ["generic", "generic"],
    ["cua", "cua"],
    ["mcp", "mcp-client"],
    ["backend-contract", "backend-contract"],
  ])
    run(name, process.execPath, [`examples/${script}.mjs`], bundle);
  const core = metadata.packages.find(
    (p) => p.name === "@superche/persistent-repl",
  );
  const isolated = join(temporary, "core-only");
  mkdirSync(isolated);
  cpSync(join(delivery, core.filename), join(isolated, core.filename));
  cpSync("examples/core-only.mjs", join(isolated, "verify.mjs"));
  writeFileSync(
    join(isolated, "package.json"),
    JSON.stringify({
      name: "core-only-consumer",
      private: true,
      type: "module",
      dependencies: { [core.name]: `file:./${core.filename}` },
    }),
  );
  run(
    "core-only-install",
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--cache",
      cache,
      "--registry=https://registry.npmjs.org",
    ],
    isolated,
  );
  run("core-only-execution", process.execPath, ["verify.mjs"], isolated);
  const installed = JSON.parse(
    readFileSync(
      join(
        isolated,
        "node_modules/@superche/persistent-repl/npm-shrinkwrap.json",
      ),
      "utf8",
    ),
  );
  for (const name of [
    "@modelcontextprotocol/sdk",
    "electron",
    "@superche/persistent-repl-cua",
  ])
    assert.ok(!installed.packages[`node_modules/${name}`]);
  writeFileSync(
    "artifacts/package-verification.json",
    JSON.stringify(
      {
        pass: true,
        version,
        checks: results,
        noHiEnvironment: true,
        coreOnly: "no CUA/MCP/testing/Electron packages installed",
        memoryHardRss: "not closed; unchanged policy",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
