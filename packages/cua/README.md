# Persistent REPL CUA Adapter

Version 0.2.0. Standalone delivery; no Hi environment required.

Inject any implementation of CuaClient into createCuaProvider(client). Core is an explicit peer dependency. This package contains no device driver, model client or product SDK. Target identity, observations, action receipts and cleanup belong to the injected backend.

Install the supplied release bundle with `npm ci`. Packages can also be installed individually from their `.tgz` files; adapter consumers supply the matching Core peer. No public npm publication is implied. Full scope, acceptance and migration instructions are in the source/release bundle docs.
