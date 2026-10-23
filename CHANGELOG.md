# Changelog

## v0.5.3 — 2026-10-23

- **新增「工作区能不能被 DSH 接管」检查**（此前完全没查，是盲区）：
  - `workspace-not-writable`：真写一个临时文件再删，失败即高危（表现是起不来 / `grantWrite Win32 5`）；
  - `workspace-not-grantable`（Windows）：owner 不是你、也没有 WRITE_DAC 时，DSH 无法给沙箱授权；
  - 修复 `workspace-acl`：先 `icacls /save` 备份，再给当前账号补完全控制，改完**复测可写**才报成功。
- 命令行 / MCP 自动获得同一能力（共用核心）。

## v0.5.2 — 2026-10-23

- **图标统一**：插件图标换成品牌 Logo（渐变环 + 粉色状态点），与 README、发行包一致。
- **README 大幅精简**：从两百多行压到一屏能看完——它做什么 / 安装 / 能修什么 / 文档索引 / 安全；细节全部沉到 `docs/`。

## v0.5.1 — 2026-10-23

- **全流程上云**：GitHub Actions 负责编译与测试，本机不再手工出包。
  - `ci.yml`：三系统冒烟（ubuntu / macos / windows）+ PowerShell 冒烟 + 假 DSH 目录上的集成修复测试（校验记录删除、引用清理、备份存在）+ **30 次连续扫描压力测试**；
  - `build.yml`：云端编译 Windows EXE 与 Unix 包，并对产物本身跑一次 `scan`；打 `v*` tag 时自动创建 GitHub Release 并上传资产。
- 本地 `tools/build.ps1` 与 CI 使用同一份布局；Unix 包由 `tools/package-unix.sh` 生成。

## v0.5.0 — 2026-10-23

- **三平台发行包**：不再只有 Windows 的 EXE。
  - Windows：`dsh-doctor.exe`（自包含，内嵌 PowerShell 逻辑）；
  - Linux / 任意带 Node 的平台：`dsh-doctor.sh` + `dsh-doctor.mjs`（与插件共用同一份核心逻辑）；
  - macOS：`dsh-doctor.command`（双击可跑）+ 同一份 CLI；
  - 通用：`node dsh-doctor.mjs scan|fix|history|rescue`。
- 构建脚本 `tools/build.ps1` 一次产出全部产物到 `dist/release/`。
- 面板美化：Hero（Logo + 口号）、状态胶囊、按严重度着色的卡片、加载/空状态。
- 新增 `assets/logo.svg`，README 按项目统一风格重写。

## v0.4.4 — 2026-10-23

- **通知归因修正**：系统通知改由**渲染层（DSH 自己）**发出，Windows 上显示的是 DeepSeek Harness，不再出现"Windows PowerShell"；host 侧 PowerShell 弹窗默认关闭（可用 `DSH_DOCTOR_NOTIFY=host` 打开）。
- 面板新增「测试通知」按钮，直接看当前通知权限状态。
- 背景：host 进程里 `require('electron')` 拿到的是空壳（`default` / `module.exports` 都是 `{}`），拿不到 `Notification`，所以只能由页面发。

## v0.4.3 — 2026-10-23

- **逃生实例复用**：不再每次点都新开一个。端口登记在 `~/.dsh/dsh-doctor/rescue.json`，活着就复用并重开浏览器，死了才新起。
- **带 token 打开浏览器**：从启动日志里抠出 `?token=...` 地址。之前开的是裸地址，页面能加载但 API 全部 `Failed to fetch`（设置页读不到插件、Agent 预设报错的真因之一）。
- **逃生实例日志落盘**：`~/.dsh/dsh-doctor/rescue-<port>.log`，起不来时有证据。
- **新检查 `rescue-instance-dead`**：识别"上次逃生实例已失效"，并说明旧标签页报 `Failed to fetch` 不是数据坏了。
- **修复宿主包隔离误伤**：原来会把整个 `@deepseek-ai` 目录改名，连合法插件一起干掉；现在只挪走 `dsh-tools / dsh-skill / schemastery / dsh-util-values / cordis` 这几份副本，同目录其它插件不动（JS 与 PS 两条路径都改了）。
- **去掉写坏的 BOM**：`package.json` 曾被我方脚本加 BOM，插件加载器报 `Unexpected token '\uFEFF'`。

## v0.4.2 — 2026-10-23

- **结果提示不再悬浮**：从 `position: fixed` 改成面板内容流里的一行横幅，不会再盖住窗口右上角的三颗控件或面板按钮；多行（交接报告）停留 15 秒，单行 6 秒。
- 去掉重复的结果展示（原来同一条结果会在横幅和消息区各出现一次）。

## v0.4.1 — 2026-10-23

- **网页版逃生的定位改了**：不再是"平替"，而是最后一招。还有可一键修复的高危问题时，第一次点只提醒、第二次才启动。
- **交接报告**：启动网页版时在桌面生成 `dsh-doctor-交接-<时间>.md`（体检结果 + 已试过的修复 + 给网页版 DSH 的话），提示你把它拖给网页版继续修。
- `/status` 增加 `summary`（high / medium / fixableHigh / unfixableHigh），面板据此判断"还能不能自己修"。
- 面板消息支持多行显示。

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
