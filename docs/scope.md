# Approved standalone delivery scope — 0.2.0

On 2026-09-11 the requirement owner instructed: **“解耦Hi，独立交付和验收”**. This is the authority for the following scope change. The original attachment remains unchanged in [requirements.md](requirements.md); where it requires Hi-specific delivery/environment, this approved scope takes precedence. This is not a unilateral P0 waiver.

## Independent delivery

- Five separately installable npm packages: Core, CUA adapter, agent-neutral execute Bridge, MCP adapter and explicitly synthetic testing support.
- Core exposes a persistent Node/V8 kernel mode (`kernel: "node"`) alongside the compatibility QuickJS mode. The Bridge is the coding-agent boundary; it forwards one code cell into the existing session and preserves dynamic RPC/CUA execution.
- A product-neutral Electron reference host, public host/provider/backend contracts, source and dependency locks.
- Source and clean-distribution acceptance, Core-only install/run proof, contract tests and lifecycle/benchmark evidence on the supported macOS runtime.
- No Hi package, repository, SDK, login, service URL, model access or signing identity is a prerequisite for independent acceptance.

## Boundary

| Concern | Component responsibility | Adopting host responsibility |
| --- | --- | --- |
| Execution | Isolated kernel, semantics, budgets, control plane, recovery hooks | Create/configure the host and durable task store |
| Identity and authority | Validate host-provided context, schemas and revision; block unknown effects | Supply trusted identity, authorization/revocation policy and backend access |
| CUA | Provider facade and typed backend contract | Supply the chosen real driver/client and its target leases/receipts |
| Images | Validate and route output; maintain correlation | Deliver images to the actual model/preview and acknowledge only actual model consumption |
| UI | Runnable independent reference application | Wire into the host's own UI and deployment |

Dependency direction is host → optional adapter → Core. Core has no host or adapter import. Device clients can implement the public contract without importing Core internals. Test-only fixtures are imported explicitly from the testing package.

The actual closed loop is: coding agent → Bridge `execute(code)` → persistent Node REPL → trusted CUA provider RPC → external CUA executor → structured result/image → REPL continuation → Bridge result. This repository proves the first five stages with the synthetic backend. It does not claim a real device executor or model image acknowledgement without an adopting host endpoint.

## Acceptance mapping

The original C/S/M cases stay in the component matrix. The Hi-specific D subcases of AT15, AT18 and AT21–AT25 are moved out of this delivery into a future, separately scoped product integration; they are neither marked passed nor counted as a blocker of the standalone distribution. Generic target/image/receipt/cleanup contracts continue to be tested. Real device/model verification remains distinct from synthetic tests.

The original process-memory requirement remains in scope. R15 / AT13, AT19 and AT27 still retain the hard-RSS subcase. The owner has not approved changing its metric to physical footprint. The independent automation reports both its check result and this remaining P0 condition rather than silently relabeling full acceptance.
