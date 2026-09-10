# Process memory containment evidence

Reference machine: macOS arm64 / Darwin 25.5.0 / Apple M5 Pro. Probe date: 2026-09-11 Asia/Shanghai.

The kernel uses a 64 MiB QuickJS allocation limit (including guest ArrayBuffer/TypedArray allocations), a 1 MiB QuickJS stack limit, a 128 MiB V8 old-space limit and a 200 ms process RSS watchdog with a default 256 MiB threshold. Input/output/RPC buffers are separately bounded. The memory pressure fixture uses repeated 1 MiB Uint8Array allocations under an 8 MiB heap policy and observes an error/termination with a live supervisor. Benchmarks report sampled RSS, never an instantaneous hard cap.

An unrestricted local command called `memorystatus_control(7, ownPid, 0, limits, 16)` with active/inactive 256 MiB fatal limits in its own short-lived probe process. It returned -1 / errno 1 (EPERM). No user application, system permission, root helper or signing entitlement was changed. This failure is outside the Codex filesystem sandbox.

Apple's [XNU memorystatus implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_memorystatus.c) checks root or the memorystatus entitlement before memory-limit commands. Its [public source header](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/kern_memorystatus.h) identifies the entitlement as private. [RLIMIT_AS implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_resource.c) sets an address-space limit; that is not equivalent to physical RSS and cannot be substituted without validating the runtime's address reservation needs. These source observations support the design limitation; they do not certify a shipping product configuration.

AT13/AT19/AT27 retain this unclosed hard-budget subcase. Final acceptance requires a supported product containment mechanism plus pressure testing in its signed runtime, or an explicit agreement to a different bounded policy/overshoot budget. The implementation does not silently treat its watchdog as satisfying a hard RSS requirement.
