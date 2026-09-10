# Handoff and remaining acceptance work

## Delivery scope and gates

0.1.0 delivers source, public declarations, the supervisor/kernel, generic providers, CUA client adapter/mock, CLI/MCP/Electron examples, test fixtures, benchmarks, dependency inventory and deployment/rollback instructions.

**Gate A is an integration candidate, not fully closed.** The implemented test suite passes, but the remaining P0 items below are not waived. **Gate B is blocked**: the user confirmed on 2026-09-10 that Hi's SDK/model image confirmation/authorized test environment are not yet available, and authorized referring to Codex's existing CUA for tests. Codex CUA was used to operate the real Electron sample. That validates the sample's controls; it is not a Hi backend/model bridge integration.

## Remaining P0 items

| Item | R / AT | Current behavior | Required completion |
| --- | --- | --- | --- |
| Process-wide hard RSS enforcement | R15, AT13/AT19/AT27 | QuickJS allocation cap + Node old-space cap + 200 ms RSS watchdog; no proof of an instantaneous OS hard RSS limit | Validate/freeze a macOS runtime containment strategy and its overshoot budget with the target product configuration, or record an explicitly approved requirement change. |
| Host crash/restart recovery barrier | R11/R12/R20, AT13/AT14/AT25 | Controlled EOF/quit/cancel cleans up; unknown effects block the current host. Host memory is lost if the supervisor itself is killed. | Add a durable host/backend recovery journal or lease-reconciliation hook and prove that a fresh host cannot resume unknown input. The product owns the persistent task/lease identity needed across restarts. |
| Comprehensive adversarial protocol/async audit | R09/R15, AT09/AT10/AT19 | Tested duplication, late callback ownership, opaque resources, import/global/prototype attacks and bounded frames | Raw duplicate RPC/terminal, malformed frame and stale-revision fault injection now passes. Extend the remaining reordered-frame and adversarial Promise/module combinations; current named tests are not an exhaustive sandbox certification. |
| Full production image provenance/consumer integration | R14/R18/R20, AT18/AT24 | PNG validation + mock image/digest/target guard + separate model/preview consumers; model-supplied output metadata never grants authority | Connect real image artifact/provenance and model-observed acknowledgement to the existing model/chat consumers; prove cross-task routing and backpressure in that environment. |
| Product packaging and target version freeze | R15/R16/R20, AT25/AT26 | Source/npm package plus Electron 44.3.0 development sample; local ad-hoc fixture identity tested | Supply final macOS/architecture/Electron/Node, signing/entitlement constraints and distribution position, then validate the signed product package. |

The absence of a real Hi service is not an excuse to mark incomplete independent work as passed. The first and third rows require further component work/validation; the second needs component support plus a product-owned durable identity contract. No P0 item has been marked not-applicable.

## Gate B input checklist

- A CuaClient implementation or official SDK/protocol with supported methods, ownership/target/observation fields and original receipts/error codes.
- A trusted owner/task/turn/call context factory, revision/revocation events, and persistent task/lease recovery policy.
- Model image delivery + explicit acknowledgement, chat/preview destinations and destination ownership validation.
- Authorized Browser/Native fixture targets, a real model entrypoint and stop/permission test window.
- Final runtime/platform/packaging constraints and agreed benchmark reference conditions.

Run the D subcases of AT15, AT18, AT21–AT25 once these are supplied. Preserve per-action receipts and corresponding post-observations; do not replace device proof with screenshots of a tool catalog or an action ACK. Product internal wiring, device drivers and release deployment remain outside this repository.

## Follow-on scope

P1 (not implemented): audio, general file artifacts, yield/wait execution tickets, more module options and memory optimizations. No dates or commercial promises are inferred. Maintenance contact/ownership is the GitHub repository owner `superche` until the receiving team designates an integration contact.
