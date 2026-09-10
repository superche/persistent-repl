import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const lock = JSON.parse(fs.readFileSync("npm-shrinkwrap.json", "utf8"));
const packages = Object.entries(lock.packages)
  .filter(([key]) => key.startsWith("node_modules/"))
  .map(([location, p]) => ({
    name: p.name ?? location.split("node_modules/").at(-1),
    version: p.version,
    license: p.license ?? "See package license",
    development: !!p.dev,
    integrity: p.integrity ?? null,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(
  "THIRD_PARTY_LICENSES.md",
  "# Third-party dependency inventory\n\nGenerated from npm-shrinkwrap.json. Runtime and development dependencies are distinguished. Original package license notices ship with their respective installed packages; the npm bundle does not vendor their source. Install from the locked public npm registry artifacts.\n\n| Package | Version | License | Use |\n| --- | --- | --- | --- |\n" +
    packages
      .map(
        (p) =>
          `| ${p.name} | ${p.version} | ${p.license} | ${p.development ? "development" : "runtime"} |`,
      )
      .join("\n") +
    "\n",
);
const wasm =
  "node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm";
const manifest = {
  package: "@superche/persistent-repl",
  version: "0.1.0",
  semantics: "cell-scope/1.0.0",
  schema: "1.0.0",
  adapter: "synthetic-cua/1.0.0",
  quickjsEmscripten: "0.32.0",
  engineWasmSha256: crypto
    .createHash("sha256")
    .update(fs.readFileSync(wasm))
    .digest("hex"),
  lockSha256: crypto
    .createHash("sha256")
    .update(fs.readFileSync("npm-shrinkwrap.json"))
    .digest("hex"),
  dependencies: packages,
};
fs.writeFileSync(
  "docs/version-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
