import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";

const lock = JSON.parse(readFileSync("npm-shrinkwrap.json", "utf8"));
const core = JSON.parse(readFileSync("packages/core/package.json", "utf8"));
const packages = {
  "": {
    name: core.name,
    version: core.version,
    license: core.license,
    engines: core.engines,
    dependencies: core.dependencies,
  },
};
function resolve(from, name) {
  let directory = from;
  for (;;) {
    const location = posix.join(directory, "node_modules", name);
    if (lock.packages[location] && !lock.packages[location].link)
      return location;
    if (!directory || directory === ".") return undefined;
    directory = posix.dirname(directory);
  }
}
function visit(from, dependencies, optional = false) {
  for (const name of Object.keys(dependencies ?? {})) {
    const location = resolve(from, name);
    if (!location && optional) continue;
    assert.ok(location, `Missing locked runtime dependency ${from} -> ${name}`);
    if (packages[location]) continue;
    const entry = structuredClone(lock.packages[location]);
    assert.ok(
      entry.integrity &&
        entry.resolved?.startsWith("https://registry.npmjs.org/"),
      `Non-public runtime dependency ${location}`,
    );
    delete entry.dev;
    delete entry.devOptional;
    packages[location] = entry;
    visit(location, entry.dependencies);
    visit(location, entry.optionalDependencies, true);
    visit(location, entry.peerDependencies, true);
  }
}
visit("", core.dependencies);
assert.ok(!packages["node_modules/@modelcontextprotocol/sdk"]);
writeFileSync(
  "packages/core/npm-shrinkwrap.json",
  JSON.stringify(
    {
      name: core.name,
      version: core.version,
      lockfileVersion: 3,
      requires: true,
      packages,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Core lock: ${Object.keys(packages).length - 1} public runtime dependencies`,
);
