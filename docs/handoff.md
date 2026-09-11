# Standalone delivery and remaining work

Version 0.2.0 implements the owner's explicit scope change: **“解耦Hi，独立交付和验收”**. The delivery consists of independently packaged Core/CUA/MCP/testing, a reference host, source and locks, a reusable backend contract runner, and `npm run accept`. See [scope.md](scope.md). Hi integration is outside this delivery; there is no pending Hi environment request.

## Remaining component P0 item

R15 / AT13, AT19 and AT27 retain the instantaneous hard-RSS subcase. The default runtime uses the same QuickJS allocation limit, V8 old-space limit and 200 ms RSS watchdog. The successful physical-footprint prototype remains explicit and is not enabled by the scope change. Its metric differs from RSS; [memory-policy-proposal.md](memory-policy-proposal.md) records the pending decision. Automated independence/contract/distribution checks do not waive this condition.

Durable host crash recovery is provided by FileRecoveryJournal. A real host configures a persistent directory and stable task identity, then reconciles unknown external actions with its chosen backend. The synthetic examples deliberately omit persistence when their effects disappear with the fixture.

## Optional adoption work

Any future host, including Hi, supplies its own identity/authorization, CuaClient driver, model-image delivery/acknowledgement, preview consumer and UI. Those are public extension points rather than dependencies of Core. The driver can first run [backend-conformance.md](backend-conformance.md); actual device actions and model consumption must have separate evidence. Product signing, notarization and release integration belong to the adopting product and do not block the source/npm/reference-host delivery.

Historical rc.3 Electron and rc.4 memory-prototype records are retained with their exact tested revision and synthetic evidence labels. They are not relabeled as tests of changed binaries. Current delivery validation is recorded in [acceptance.md](acceptance.md) and its versioned evidence files.

P1 audio, general artifacts and execution tickets remain outside the implemented scope. Repository ownership remains with superche.
