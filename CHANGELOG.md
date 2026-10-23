# Changelog

## v0.4.0 — 2026-10-23

- **跨平台**：检测、修复、通知、逃生全部按平台实现——Windows / macOS / Linux。Windows 专属的只剩完整性标签（改成 POSIX 权限位检查）与急救 EXE。
- **完成即提示**：体检结束弹结果摘要，修复/逃生结束弹结果（面板右上角 6 秒自动消失 + 系统通知：Windows 气泡 / macOS 通知中心 / Linux notify-send）。
- **通知去噪**：侧边栏红点只对 High 亮，修复后立刻消失。
- 系统命令抽象成 `shell()`（Windows 用 PowerShell，其它平台用 `/bin/sh`），`dsh` 探测走各平台各自的 `where/which`。

## v0.3.1 — 2026-10-23

- **侧边栏红点只对 High 亮**：Medium（历史崩溃日志之类）不再点亮提示点，修复完成后点立刻消失。
- 修复/逃生成功后广播状态变更，图标立即重算，不用等 30 秒轮询。
- 图标新增 `title` / `aria-label`，悬停就能看到"还有几个高危问题"。
- PS 端补上 `restore-patch-layer`；`workspace-entry` 的兜底路径改成结构级删除（不再按字符串抠 JSON）。

## v0.3.0 — 2026-10-23

- **修复录（history）**：每次修复落 `~/.dsh/dsh-doctor/history.jsonl`（时间 / 动作 / 结果 / 备份路径），面板底部显示最近 8 条，接口 `GET /dsh-doctor/history`。
- **网页版逃生**：面板「起网页版」按钮 → 探测 `dsh` / `npx` 运行时 → 在 47000–48999 里选空闲端口起隔离实例 → 自动打开浏览器。桌面端瘫痪时不用等修复就能继续工作。
- **常驻守护**：`tools/watch.mjs`，独立于 DSH 的进程，连续 3 次探测失败弹 Windows 原生气泡（10 分钟冷却）。写在 DSH 里的东西救不了 DSH。
- **MCP 面**：`tools/mcp.mjs`，stdio JSON-RPC，四个工具 `doctor_scan` / `doctor_history` / `doctor_fix`（默认 dry-run）/ `doctor_rescue`。让任何 agent 通过受控工具调用医生，没有 shell 通道。
- **修复目录**：`docs/catalog.md` —— 检查项、修复项、备份位置、验证方式、为什么有些只报告。

## v0.2.0 — 2026-10-23

- **工作区修复重做**：优先调用 DSH 自己的 `workspaceRegistry.delete()`，不再直接改写 `workspace.json`（旧实现按字符串删除会写出非法 JSON）；文件兜底改为结构级删除（记录 + `global.workspaceIds` 引用）。
- **社区检查包协议 v1**：`docs/protocol.md` + JSON Schema + 示例；检查包是纯数据，放在 `%USERPROFILE%\.dsh\dsh-doctor\checks\` 即生效。
- **新增检查**：老会话里的 `kind:"plugin"` 旧写法（zstd 解帧只读扫描）、credentials 版本、`cordis.patch.yml` 被清空、PATH 里指向死路径的 `dsh`。
- **新增修复**：`restore-patch-layer`（从最近备份恢复 patch 层）。
- **插件面板**：发现项标注来源（`builtin` / 检查包 id），相同问题自动去重。

## v0.1.0 — 2026-10-23

- 检测器：桌面完整性标签、危险工作区注册、profile 宿主包副本、会话写桌面、崩溃日志。
- 一键修复：`desktop-label`、`workspace-entry`、`profile-host-dup`（均带备份与复检）。
- DSH 侧边栏插件（`sidebar.panellist` + `main` 面板）与同源路由 `/dsh-doctor/status`、`/dsh-doctor/fix`。
- PowerShell 命令行版（`scan` / `fix` / `watch` / `report`）与冒烟测试。
- 踩雷清单 `docs/traps.md`、架构设计 `docs/design.md`。
