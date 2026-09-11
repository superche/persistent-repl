# Process memory containment evidence

Reference machine: macOS arm64 / Darwin 25.5.0 / Apple M5 Pro. Probe date: 2026-09-11 Asia/Shanghai.

The kernel uses a 64 MiB QuickJS allocation limit (including guest ArrayBuffer/TypedArray allocations), a 1 MiB QuickJS stack limit, a 128 MiB V8 old-space limit and a 200 ms process RSS watchdog with a default 256 MiB threshold. Input/output/RPC buffers are separately bounded. The memory pressure fixture uses repeated 1 MiB Uint8Array allocations under an 8 MiB heap policy and observes an error/termination with a live supervisor. Benchmarks report sampled RSS, never an instantaneous hard cap.

An unrestricted local command called `memorystatus_control(7, ownPid, 0, limits, 16)` with active/inactive 256 MiB fatal limits in its own short-lived probe process. It returned -1 / errno 1 (EPERM). No user application, system permission, root helper or signing entitlement was changed. This failure is outside the Codex filesystem sandbox.

Apple's [XNU memorystatus implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_memorystatus.c) checks root or the memorystatus entitlement before memory-limit commands. Its [public source header](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/kern_memorystatus.h) identifies the entitlement as private. [RLIMIT_AS implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_resource.c) sets an address-space limit; that is not equivalent to physical RSS and cannot be substituted without validating the runtime's address reservation needs. These source observations support the design limitation; they do not certify a shipping product configuration.

## Follow-up: effective physical-footprint limit prototype

The failed self-limit call does not establish that every macOS mechanism is unavailable. A second controlled investigation tested the private `posix_spawnattr_setjetsam_ext` SPI. Our source-only prototype and assertions are in [scripts/memory-probe](../scripts/memory-probe); [machine-readable results](evidence/memory-probe.json) were produced with Node 22.19.0, outside the Codex command sandbox, as ordinary UID 501. No root helper, signing entitlement or system setting was changed.

| Probe | Observation |
| --- | --- |
| Own-task Mach `task_set_phys_footprint_limit` | Result 8 (`KERN_NO_ACCESS`). |
| Native malloc control | All 64 MiB allocated/touched; exit 0. |
| Spawn with 32 MiB active/inactive fatal limit | Attribute call returned 0; child was actually killed with signal 9 after the 28 MiB sample. |
| SETEXEC with the same native limit | Actual SIGKILL, preserving the direct host/child process shape. |
| Node Buffer control | All 128 MiB allocated/touched; exit 0. |
| Node Buffer with 96 MiB footprint limit | Actual SIGKILL before completing the finite 128 MiB loop; fixture timeout did not fire. Host-visible PID and parent identity preserved. |
| Limit before sandbox-exec | Initial attempt incorrectly allowed the REPL's finite 192 MiB allocation to complete. Subsequent exec did not preserve the effective limit on the final kernel. This order is unsuitable. |
| Limit after sandbox-exec, immediately before Node | Real REPL started, then a finite allocation loop under a 128 MiB footprint cap ended as `crashed` / child SIGKILL. Guest heap cap was deliberately raised to 256 MiB and RSS watchdog to 512 MiB for this test. Supervisor remained alive; Reset created a new epoch; next cell completed. |
| Sandbox boundary after adding launcher | Exact canonical launcher read/exec path only; `/etc/hosts` read, local socket listen, and child creation remained denied. Initial `/var` vs `/private/var` path mismatch failed closed and was corrected with realpath. |
| Cleanup | All tracked probe/kernel PIDs gone. |

Reproduce from an installed/buildable package on macOS with Command Line Tools: `node scripts/memory-probe/run.mjs`. The probe compiles into a temporary directory, uses finite allocations of at most 192 MiB per child, emits only synthetic data and measurements, then removes its temporary files. It does not change the normal ReplHost spawn path. This is a prototype, not a new default or a shipping signed helper.

Apple's source at [XNU f6217f8: private spawn declarations](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/libsyscall/wrappers/spawn/spawn_private.h), [attribute construction](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/libsyscall/wrappers/spawn/posix_spawn.c) and [exec memlimit handling](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exec.c) explains the mechanism. These upstream source references are not a guarantee that all shipping macOS/architecture/signing combinations support it. A missing symbol or setting error in the prototype refuses execution; an attribute success alone is never counted as enforcement proof.

**Physical footprint and RSS are different metrics.** The 96 MiB footprint-limited Node probe reported RSS 132,497,408 bytes at its last 72 MiB Buffer sample. That observation directly rules out treating this limit as a 96 MiB instantaneous RSS cap. Likewise, signal 9 alone does not identify the termination cause in a production incident; the controlled control/limited comparison is what establishes this fixture's result.

AT13/AT19/AT27 retain the unclosed hard-RSS subcase. [The reviewable proposal](memory-policy-proposal.md) asks whether the footprint hard limit plus existing RSS watchdog is an acceptable budget contract, followed by default-path implementation, regression and target-product verification. There is no unilateral waiver and no claim that the default runtime already uses this SPI.
