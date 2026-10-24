# Changelog

## v0.10.4 — 2026-10-24

- **安装文档对齐真实的「添加插件」对话框**（输入框提示：包名 / GitHub 仓库地址 / 本地目录路径）：
  - 给出可直接照抄的步骤：解压 → 粘绝对目录 → 保持默认安装源 → 点安装；
  - 说明「插件在本机以你的权限运行」是所有插件的通用警告；
  - 明确 **不要填本仓库 GitHub 地址**（bundle 在 `plugin/` 子目录，仓库根不是 package，会判 `not-a-bundle`），要远程装先 `git clone` 再填 `...\dsh-doctor\plugin`。

## v0.10.3 — 2026-10-24

- **按 DSH 实际的安装机制重写安装文档**（来源：`@deepseek-ai/dsh-plugin-manager` 的 README 与 CLI）：
  - 桌面端：侧边栏 → 插件（Plugins）→ 添加 / 安装 → 选本地目录或粘贴绝对路径；
  - 非桌面 profile：`dsh plugin --profile <name> add <spec>`，内部是 pnpm，支持包名 / 本地目录 / git / tarball；
  - 会话内：`plugin_manager` 的 `install_bundle`，`target` 填绝对目录；
  - 明确 `desktop` profile 由 Electron 应用独占，命令行会拒绝；
  - 说明 bundle 必须声明 `dsh.bundle.patch`，否则判为 `not-a-bundle`；安装默认启用，无 HMR 时需重启。
- CONTRIBUTING 增加「把开发版装进 DSH 调试」，说明本地目录安装是 `link:` 语义。

## v0.10.2 — 2026-10-24

- README 新增「桌面端已经彻底报废？」一节：说明 EXE 不依赖 DSH / Node / 联网，报废时仍可体检、修图标、生成差异报告；并说明面板按钮与 `dsh-doctor.exe diff` 是同一套逻辑。
- 去掉 `Get-DoctorEnvironmentSnapshot` 里写死的安装路径（原来只认某两个固定盘符），改为"常见安装目录 + 从运行中的桌面端进程反查"，任意盘符都能识别。
- 文档示例路径统一为通用占位（`D:\项目名`），不再出现个人机器路径。

## v0.10.1 — 2026-10-24

- **报告自动脱敏**（JS 与 PowerShell 双实现，同一套规则）：
  `C:\Users\<名字>` → `C:\Users\user`、`/home/<名字>` 与 `/Users/<名字>` → `user`、
  散落的当前用户名 → `user`、主机名 → `<machine>`、邮箱 → `user@example.com`。
  作用于：求助报告、环境差异报告、逃生交接报告、CLI 输出，以及 EXE 的 diff 模式。
- 修正 EXE 在无法写文件时把真实路径打印到警告里的问题（现在提示文字也脱敏）。
- 非用户目录（如 `G:\项目名`）保留原样，方便维护者定位。

## v0.10.0 — 2026-10-24

- **环境差异报告**（新能力）：`baseline/expected.json` 定义"标准 DSH"，逐项对比本机：
  危险工作区、profile 缺少标准 bundle、依赖里出现宿主包、node_modules 里出现宿主包副本、
  桌面低完整性/拒绝项、PATH 失效入口、崩溃日志、僵尸进程。
  输出一个 MD（环境快照 + 差异 + 后端报错 + 提交方式）到桌面，可直接提 issue/PR。
- 四个入口：插件页脚按钮（`POST /dsh-doctor/diff/save`）、`GET /dsh-doctor/diff`、
  `node dsh-doctor.mjs diff`、`dsh-doctor.exe diff`（纯 PowerShell，不需要 Node）。
- 修正基线归一化：`baseline/expected.json` 的分组字段（`profiles.*`）与代码形状不一致导致的
  `undefined.filter` 崩溃；`guiProfiles` 单独判断，避免每个 profile 都要求 `dsh-web-app`。
- EXE 写文件失败（例如在 DSH 沙箱终端里运行）时不再静默：会说明原因并把报告打印到控制台，可手动复制。

## v0.9.0 — 2026-10-24

- **体检不再卡住宿主**：整包扫描移到 worker 线程，并缓存 8 秒；面板、图标轮询、报告生成不会反复全量扫描。
- **ACL 修改加互斥锁**：自动巡检与手动修复不会再互相覆盖（`~/.dsh/dsh-doctor/acl.lock`，2 分钟过期）。
- **插件包**：Release 新增 `dsh-doctor-plugin.zip`，解压后 `install_bundle` 指向解压目录即可，不再依赖 `link:` 安装（仓库一挪就坏）。
- **逃生交接报告升级**：直接复用「给 AI 的求助报告」——问题按严重度排好、带提示词约束，丢给网页版 DSH 就能接着修，减少无意义 token。
- **Bug 图鉴**：新增 [bugs/](bugs/README.md)，10 个条目记录遇到的每个问题、根因、修法与验证。

## v0.8.1 — 2026-10-24

自查后修掉的 5 个隐患：

- **发行包缺 `package.json`**：更新检查读不到版本会退化成 `0.0.0`，永远提示"有新版本"。现在 EXE 包、Unix 包、环境包都带上 `plugin/package.json`。
- **环境包的 `.cmd` 带 BOM**：`cmd.exe` 会把 BOM 当成命令的一部分；现在改写无 BOM 的 `start.cmd`（纯 ASCII 内容）。
- **自动巡检可能和 DSH 打乒乓**：桌面标签被反复改写时，硬拉会造成反复闪屏。现在一小时内最多自动修 5 次，超出就暂停并在修复录里说明"该去改工作区了"。
- **僵尸进程回收可能误杀**：杀之前复核命令行（含端口 + dsh），防 PID 在扫描与杀之间被复用。
- **写权限探针可能留垃圾**：改用 `finally` 清理，成功失败都不留临时文件。

## v0.8.0 — 2026-10-24

- **自动更新**：面板新增「检查更新」——查询 GitHub 最新 Release，与本地版本比较；有新版本时出现卡片，可一键「打开下载页」（只允许打开本仓库的 Release 地址）。接口：`GET /dsh-doctor/update`、`POST /dsh-doctor/update/open`。
- **去掉所有图标 emoji**：README、docs、CHANGELOG、CLI 输出、求助报告里一律不再出现 emoji；状态用「[高危]/[提醒]/[信息]」「[可修]/[只查]」表达。品牌 Logo 与面板配色保留。
- 「测试通知」从主按钮行移到页脚，主操作只剩：检查更新 / 生成报告 / 起网页版 / 重新体检。

## v0.7.0 — 2026-10-24

**把宣传里的话兑现**（不再只是"清症状"）：

-  **后台自动巡检**：每 30 秒检查桌面完整性标签与拒绝项，被 DSH 降级就立刻重置并记进修复录；开关 `DSH_DOCTOR_AUTOFIX=0`。
-  **僵尸进程回收**：清理"命令行含 dsh+web+--port 且端口已死"的残余实例，不影响正在用的进程。
-  **刷新外壳图标**：修完标签自动 `SHChangeNotify`，不用重启资源管理器（新增 `refresh-shell` 动作）。
- README 换成新的对外文案（"底层运行时急救箱"），插件描述同步；`docs/fixable.md` 补三条对应条目。

## v0.6.3 — 2026-10-24

- **新宣传标语**：「只要是 DSH 引起的毛病，无论什么奇葩症状，我都能治好。」
- **新增 [docs/fixable.md](docs/fixable.md) · 修复清单**：按"你看到的现象"排，每条给根因、医生怎么做（ 一键修 /  只查）、以及对应的踩坑条目。
- README 的「能修什么」改成可点击的表格，直接跳到清单里对应的一条；同时补上"不负责的花屏/蓝屏"边界说明。
- 插件描述同步新标语。

## v0.6.2 — 2026-10-24

- **修 CI 抓到的打包 bug**：发行包里核心文件原来是 `plugin/lib/index.js`，脱离 `plugin/package.json` 的 `"type": "module"` 后会被 Node 当成 CommonJS，ESM 命名导入直接报错。现统一发布为 `index.mjs`，与环境无关。
- 环境包同步修正；CI 现在会真正运行环境包里的 `node.exe` 做冒烟。

## v0.6.1 — 2026-10-24

- **回应「双击了在运行，但看不到页面」**：逃生原来只等 30 秒、且不给明确反馈。现在：
  - 走 npx 时最多等 **3 分钟**（首次要下载）；
  - 失败时直接说明"这台机器没有可用 Node 环境，请用环境包"；
  - 成功时把**带 token 的地址写到桌面** `dsh-doctor-网页版地址.txt`，浏览器没弹出来也能手动复制。
- **新增 Windows 环境包** `dsh-doctor-env-win-x64.zip`：自带 `node.exe` + 医生 CLI + `启动.cmd`，解压即用，不需要装 Node，也不需要 DSH 能启动。
- CI 增加 envpack 构建任务，并**在云端实际运行环境包里的 node.exe** 做冒烟。

## v0.6.0 — 2026-10-23

- **给 AI 的求助报告**：面板新增「生成报告」——内容含体检结果、修复录、环境，以及**给 AI 的提示词约束**（基于证据、给命令与回滚、不许推荐"删图标缓存"偏方、破坏性操作先确认、不知道就说不知道）。
  - 「复制」：直接粘贴给 DSH / 任何 AI；
  - 「保存到桌面」：留档为 `dsh-doctor-求助报告-<时间>.md`；不保存也行。
  - 命令行：`node dsh-doctor.mjs report` 直接打印同一份报告。

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
