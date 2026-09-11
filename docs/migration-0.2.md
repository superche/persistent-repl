# Migrating 0.1.x → 0.2.0

0.2.0 splits the previous umbrella package. Cell semantics (`cell-scope/1.0.0`), schemas (`1.0.0`) and the default memory policy are unchanged. This is a package/import migration, not a heap/history migration.

| Previous import | 0.2 import |
| --- | --- |
| `@superche/persistent-repl` | Unchanged; Core only |
| `@superche/persistent-repl/cua` | `@superche/persistent-repl-cua` |
| `MockCuaClient` from `/cua` | `@superche/persistent-repl-testing` |
| `@superche/persistent-repl/fixtures` | `@superche/persistent-repl-testing` |
| `@superche/persistent-repl/mcp` | `@superche/persistent-repl-mcp` |

The old subpaths are removed so Core never pulls optional adapters back in. Supply Core 0.2.0 alongside the adapters; the release bundle does this with local tarball dependencies and a consumer lock. No packages have been published publicly to npm.

The MCP binary name remains `persistent-repl-mcp`, now provided by the MCP adapter package. Its standalone CLI registers no counter/CUA services. For a synthetic counter or real services, embed `createMcpServer` with a host/session configured with the appropriate provider. The public CLI remains useful for persistent JS, output, status, reset and cancellation. Raw transport dedup and EOF tests remain covered.

Stop/reconcile/dispose existing sessions before upgrading. Create a fresh host/session using the new package set. Preserve the durable journal and task identity; never replay old code to reconstruct a heap. Roll back by reinstalling the earlier complete package set, following [operations.md](operations.md).
