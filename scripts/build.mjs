import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, rmSync } from "node:fs";

for (const name of ["core", "cua", "testing", "mcp", "bridge"]) {
  rmSync(`packages/${name}/dist`, { recursive: true, force: true });
  execFileSync(
    "node_modules/.bin/tsc",
    ["-p", `packages/${name}/tsconfig.json`],
    { stdio: "inherit" },
  );
}
cpSync(
  "packages/core/src/kernel/bootstrap.js",
  "packages/core/dist/kernel/bootstrap.js",
);
chmodSync("packages/mcp/dist/cli.js", 0o755);
