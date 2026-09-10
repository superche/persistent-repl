import { readFileSync, realpathSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
/** Enumerate only the package's locked runtime dependency roots in the trusted host. */
export function dependencyReadRoots(root: string): string[] {
  const roots = new Set<string>();
  const visit = (directory: string) => {
    directory = realpathSync(directory);
    if (roots.has(directory)) return;
    roots.add(directory);
    const manifest = join(directory, "package.json");
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    const require = createRequire(manifest);
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      let entry: string;
      try {
        entry = require.resolve(name + "/package.json");
      } catch {
        entry = require.resolve(name);
      }
      let candidate = dirname(realpathSync(entry));
      while (candidate !== dirname(candidate)) {
        const file = join(candidate, "package.json");
        if (
          existsSync(file) &&
          JSON.parse(readFileSync(file, "utf8")).name === name
        ) {
          visit(candidate);
          break;
        }
        candidate = dirname(candidate);
      }
    }
  };
  visit(root);
  return [...roots];
}
