# Persistent REPL MCP Adapter

Version 0.2.0. Standalone delivery; no Hi environment required.

Exports createMcpServer(host, session, contextFactory), plus the persistent-repl-mcp stdio command. Core is an explicit peer dependency. The CLI has no registered external services: use persistent JavaScript and explicit output, or embed the server and register trusted providers. It does not depend on CUA or synthetic fixtures.

Install the supplied release bundle with `npm ci`. Packages can also be installed individually from their `.tgz` files; adapter consumers supply the matching Core peer. No public npm publication is implied. Full scope, acceptance and migration instructions are in the source/release bundle docs.
