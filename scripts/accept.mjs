import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
mkdirSync("artifacts", { recursive: true });
const report = {
  scope: "standalone component and adapters",
  hiIntegration: "excluded by user instruction: 解耦Hi，独立交付和验收",
  started: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  release: os.release(),
  checks: [],
  backendEvidence:
    "synthetic contract fixtures; no Hi or device/model integration claim",
  remainingP0: [
    "R15 / AT13, AT19, AT27: instantaneous hard RSS contract is unresolved; this scope change does not approve the footprint proposal",
  ],
};
const steps = [
  ["source-and-contracts", "check"],
  ["lifecycle-benchmark", "bench"],
  ["distribution", "pack:all"],
  ["clean-install-and-core-isolation", "verify:packages"],
];
for (const [name, script] of steps) {
  const result = spawnSync("npm", ["run", script], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 ** 2,
  });
  writeFileSync(
    `artifacts/${name}.log`,
    (result.stdout ?? "") + (result.stderr ?? ""),
  );
  report.checks.push({ name, pass: result.status === 0 });
  console.log(`${name}: ${result.status === 0 ? "pass" : "FAIL"}`);
  if (result.status === 0 && name === "lifecycle-benchmark") {
    const start = result.stdout.indexOf("{\n");
    writeFileSync(
      "artifacts/benchmark.json",
      JSON.stringify(JSON.parse(result.stdout.slice(start)), null, 2) + "\n",
    );
  }
  if (result.status !== 0) break;
}
report.finished = new Date().toISOString();
report.automatedAcceptance =
  report.checks.length === steps.length && report.checks.every((r) => r.pass)
    ? "pass"
    : "fail";
report.fullP0Acceptance = "not-closed";
writeFileSync(
  "artifacts/acceptance.json",
  JSON.stringify(report, null, 2) + "\n",
);
if (report.automatedAcceptance !== "pass") process.exitCode = 1;
