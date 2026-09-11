import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const allowed = {
  core: [],
  cua: ["@superche/persistent-repl"],
  mcp: ["@superche/persistent-repl"],
  testing: ["@superche/persistent-repl", "@superche/persistent-repl-cua"],
  bridge: ["@superche/persistent-repl"],
};
function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)],
  );
}
for (const [name, dependencies] of Object.entries(allowed)) {
  const manifest = JSON.parse(
    readFileSync(`packages/${name}/package.json`, "utf8"),
  );
  assert.equal(
    manifest.private,
    undefined,
    "Delivery packages must be packable consumers",
  );
  for (const dep of Object.keys({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  })) {
    if (dep.startsWith("@superche/"))
      assert.ok(
        dependencies.includes(dep),
        `${name} has a reversed package dependency: ${dep}`,
      );
    if (name === "core")
      assert.ok(
        !["@modelcontextprotocol/sdk", "electron"].includes(dep),
        `core installs optional host dependency ${dep}`,
      );
  }
  for (const path of files(`packages/${name}/src`)) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\()\s*["']([^"']+)["']/g,
    )) {
      const specifier = match[1];
      if (specifier.startsWith("@superche/"))
        assert.ok(
          dependencies.includes(specifier),
          `${path} must use an allowed public package boundary: ${specifier}`,
        );
      if (specifier.startsWith(".."))
        assert.ok(
          !specifier.includes("/packages/") && !specifier.includes("/src/"),
          `${path} imports another package's source`,
        );
      if (name === "core")
        assert.ok(
          !specifier.startsWith("@modelcontextprotocol/") &&
            specifier !== "electron",
          `${path} imports an optional host`,
        );
    }
  }
}
console.log(
  JSON.stringify({
    check: "package-boundaries",
    pass: true,
    dependencyDirection: allowed,
  }),
);
