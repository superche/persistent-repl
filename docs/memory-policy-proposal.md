# 可审阅的内存约束方案（尚未批准替换验收口径）

当前默认 REPL 运行时保持原有内存策略。新增的 `scripts/memory-probe` 是可编译、可执行的接入原型；完整实测在 [memory-probe.json](evidence/memory-probe.json)。

建议的产品候选策略：

- 在 Seatbelt 建立之后，用 `POSIX_SPAWN_SETEXEC` 和 `posix_spawnattr_setjetsam_ext` 为最终 kernel 设置 active/inactive fatal physical-footprint limit，建议 256 MiB。
- 保留 256 MiB RSS / 200 ms 看门狗、QuickJS 64 MiB 分配上限、V8 old-space 128 MiB 及现有输入/输出/RPC 预算。
- launcher 用 exec 替换自己，kernel PID/父进程关系保持不变；Stop、EOF、宿主死亡检查继续针对实际 kernel。
- API 缺失或设置失败时拒绝启动，不回退到无约束执行。该 API 是 macOS 私有 SPI，最终平台/架构/签名组合必须单独验证；不能把本机实验推广成所有 macOS 的兼容承诺。
- 进程退出按原有 crashed/reset 路径处理。SIGKILL 本身不足以区分内存限制与其他外部终止，因此不凭信号编造精确 OOM 原因。

实测已覆盖 native malloc、Node Buffer、sandbox 后的真实 REPL kernel 压力终止、宿主存活、Reset 后新 cell、无遗留 PID。负向用例确认文件读取、网络监听和创建子进程仍被原 Seatbelt 策略拒绝。探针均使用有限分配，不制造整机内存压力。

**需要明确的范围决定：是否将上述 physical-footprint 系统硬限制与 RSS 看门狗组合，接受为 R15 / AT13、AT19、AT27 的进程内存验收口径。** Physical footprint 与 RSS 不相同，不能承诺 RSS 瞬时绝不超过 256 MiB。原型的 Node 样例在 96 MiB footprint 限制下就有大于 96 MiB 的 RSS 样本，直接证明了两者的差异。

若接受，后续将此启动顺序接入默认运行路径，并在固定的 Node/Electron/平台组合下回归、重新压测、验证分发与界面，随后更新相应验收行。若继续要求严格的瞬时 RSS 上限，此原型不能关闭该项；应由目标产品选定可支持该度量的隔离环境，或继续保留未完成项。未获得明确决定前，不修改原始需求，也不把实验成功改写成 Gate A 已通过。
