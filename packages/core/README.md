# Persistent REPL Core

Version 0.2.0. Standalone delivery; no Hi environment required.

Provides ReplHost, typed providers, cancellation, output and durable recovery. No CUA, MCP, Electron or product SDK dependency. macOS Seatbelt is the supported isolation platform. Node 22.19 through 24.x. Configure host-owned identity, authorization and providers through the public SDK. Heap budgets and an RSS watchdog are active; an instantaneous hard RSS cap is not claimed.

Install the supplied release bundle with `npm ci`. Packages can also be installed individually from their `.tgz` files; adapter consumers supply the matching Core peer. No public npm publication is implied. Full scope, acceptance and migration instructions are in the source/release bundle docs.
