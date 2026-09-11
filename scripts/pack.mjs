import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const destination = resolve("artifacts", version);
const cache = resolve("artifacts/npm-cache");
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
execFileSync(process.execPath, ["scripts/lock-core.mjs"], { stdio: "inherit" });
const packages = [];
for (const directory of ["core", "cua", "mcp", "testing", "bridge"]) {
  cpSync(
    "THIRD_PARTY_LICENSES.md",
    `packages/${directory}/THIRD_PARTY_LICENSES.md`,
  );
  const output = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--workspace",
        `packages/${directory}`,
        "--pack-destination",
        destination,
        "--cache",
        cache,
        "--json",
      ],
      { encoding: "utf8" },
    ),
  )[0];
  const bytes = readFileSync(`${destination}/${output.filename}`);
  packages.push({
    name: output.name,
    version: output.version,
    filename: output.filename,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
writeFileSync(
  `${destination}/package.json`,
  JSON.stringify(
    {
      name: "persistent-repl-delivery",
      private: true,
      version,
      type: "module",
      scripts: {
        test: "node --test test/*.test.mjs",
        "demo:core": "node examples/generic.mjs",
        "demo:cua": "node examples/cua.mjs",
        "demo:bridge": "node examples/bridge.mjs",
        "demo:mcp": "node examples/mcp-client.mjs",
        "demo:contract": "node examples/backend-contract.mjs",
      },
      dependencies: Object.fromEntries(
        packages.map((p) => [p.name, `file:./${p.filename}`]),
      ),
    },
    null,
    2,
  ) + "\n",
);
for (const folder of ["test", "examples", "docs"])
  cpSync(folder, `${destination}/${folder}`, {
    recursive: true,
    filter: (source) => !source.split(/[\\/]/).includes("node_modules"),
  });
cpSync("README.md", `${destination}/README.md`);
cpSync("scripts/memory-probe", `${destination}/scripts/memory-probe`, {
  recursive: true,
});
execFileSync(
  "npm",
  [
    "install",
    "--prefix",
    destination,
    "--workspaces=false",
    "--package-lock-only",
    "--ignore-scripts",
    "--cache",
    cache,
    "--registry=https://registry.npmjs.org",
  ],
  { stdio: "pipe" },
);
renameSync(
  `${destination}/package-lock.json`,
  `${destination}/npm-shrinkwrap.json`,
);
writeFileSync(
  `${destination}/packages.json`,
  JSON.stringify(
    { version, packages, scope: "standalone; no Hi integration prerequisite" },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ destination, packages }));
