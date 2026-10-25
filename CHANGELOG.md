# Changelog

## v0.14.1 — 2026-10-25

修「网页版明明打开了，医生却提示逃生失败 / 页面报 Failed to fetch」：

- **根因**：Windows 的 `dsh.cmd` shim 把子进程 stdout 写进自己的控制台，Node 重定向抓不到 `dsh web` 打印的 **token URL**；医生拿不到 token，浏览器打开的是不带 token 的地址（401），面板又按"没起来"处理。
- **修复**：解析出 `node_modules/@deepseek-ai/dsh/lib/bin.js`，用 `node` 直接启动（输出能落盘）；统一加 `--no-open` 避免双开浏览器；HTTP 就绪后最多等 3 秒补抓 token；npx 兜底从 `@latest` 改为 `@next`（与桌面端 rc.3 对齐）。
- 实测：新起实例的日志 1223 字节，含 `?token=...`，返回消息明确"已用带 token 的地址打开浏览器"。

## v0.14.0 — 2026-10-25

**发行简化：只保留 3 个下载文件**，其余全部收进内部组件。

- Release 资产从 6 个减到 **3 个**：`dsh-doctor.exe`（Windows）、`dsh-doctor-env-win-x64.zip`（无 Node 环境包）、`dsh-doctor-unix.tar.gz`（Linux/macOS）。
- `doctor-sys.exe`、`dsh-doctor-native.exe`、`dsh-doctor-plugin.zip` 不再作为下载项发布；插件安装走 npm 包名或 `git clone` 后指向 `plugin/`。
- npm 包 README 重写：第一段就是「DSH 还能用 → 装插件」，第二段是「DSH 起不来 → 只下载这 3 个文件」的表格。
- 根 README 同步简化下载表；`docs/install.md` 去掉插件 zip 的离线安装说明。
- Rust 原生 CLI（`doctor-sys` 的 `scan`/`fix`）继续作为内部能力维护；完整替换主 EXE 需要把逃生/报告/差异等命令也迁进 Rust（P2）。

## v0.13.14 — 2026-10-25

- **27 个 danger-full-access 会话现在能一键修**：`permission-too-broad` 带 `fixId`。修复会往每个旧会话日志末尾追加合法的 `permission/preset` + `sandbox/mode` + `approval/policy` 事件（回放时最后生效），同步更新投影缓存；原会话文件与缓存先备份，**跳过当前正在用的会话**（它需要 `/permission` 自己切）。实测合成会话：追加 seq 连续、缓存同步、备份齐全。
- **修「修复完成但按钮还在」**：修复成功后面板先本地摘掉该卡片，再带 `?force=1` 强制重新扫描（绕过 8 秒缓存），按钮不再残留。
- **后台自动隔离宿主包副本**：auto-guard 每 30 秒顺带检查 profile，发现 schemastery 等副本自动隔离（每小时上限 3 次），防止插件安装/升级后下次启动崩在 `reading 'prepare'`。
- **贡献者徽章**：新增 `assets/contributor-badge.svg`，README 顶部加 Contributors 徽章；[CONTRIBUTORS.md](CONTRIBUTORS.md) 提供可直接复制的 Markdown。

## v0.13.13 — 2026-10-25

- **逃生最终修复**：PowerShell 常把 npm 的 `dsh` 解析成 `dsh.ps1` shim，跨进程启动会瞬间退出（菜单显示"逃生进程提前退出（出口代码 ）"）。现在发现 `.ps1` 时自动改用同目录的 **`dsh.cmd`**，仍保留 `powershell -File` 兜底。
- 逃生进程提前退出时，会把 stdout/stderr 尾部一起打出来，不再只显示空出口码。
- 用提取出的真实 `Start-RescueWeb` 函数实测：`dsh.cmd web` 十几秒内返回带 token 的 URL 并成功打开浏览器。

## v0.13.12 — 2026-10-25

修 v0.13.11 引入的 EXE 问题，以及「起网页版（逃生）卡飞」：

- **PS 检查表语法/空值修复**：`Test-DoctorPluginBootFailure` 的续行符后有空格导致内嵌脚本解析失败（EXE 会把源码当报错打出来）；空 crash 日志触发 `$text.Length` 异常。两处都修了，EXE 恢复可运行。
- **逃生网页卡飞的真因**：EXE 之前轮询 `http://127.0.0.1:<port>/` 但 `dsh web` 需要 token，返回 401 → EXE 一直轮询到超时，网页其实早起来了。现在改为：
  - 从 `dsh web` 输出里提取**带 token 的 URL** 再打开；
  - 加 `--no-open`，避免 `dsh web` 和 EXE 各开一次浏览器；
  - 轮询期间每 10 秒打印进度，进程提前退出会显示 stderr 尾部；失败自动结束子进程；
  - PATH 里的 dsh 是旧版（非 0.2.1）时自动改用 `npx @deepseek-ai/dsh@next`。
- **逃生兼容 npm 的 .ps1 shim**：Get-Command dsh 可能解析到 dsh.ps1，之前被当成 Win32 程序启动会报 %1 不是有效的 Win32 应用程序；现在用 powershell -File 启动。
- 两个 EXE 都重新编译并冒烟验证：`dsh-doctor.exe scan`、`dsh-doctor-native.exe scan --json` 均正常。

## v0.13.11 — 2026-10-25

回应「面板一打开就一直正在体检」和「启动弹窗找不到是哪个插件」：

- **面板改成按需体检**：打开只读上次结果（`~/.dsh/dsh-doctor/last-scan.json`），显示"上次体检：时间"；点「体检」才真正扫描。没有记录时显示"还没有体检记录，点体检开始"。
- **新增 `GET /dsh-doctor/cached`**：只返回落盘的上次结果，不触发扫描。
- **超时兜底**：扫描 worker 超过 30 秒会被终止并返回明确错误（不再退回同步扫描把宿主卡死）；面板会提示重试/改用 EXE。
- **`plugin-boot-failure` 增强**：除了带文件路径的 ReferenceError，现在也识别启动器写的 `<插件>: import failed`，直接报出是哪个插件没起来（本次 `dsh-our-free-model` 的自更新竞态就是这种）。
- 体检成功后自动落盘，供下次打开秒开。

## v0.13.10 — 2026-10-24

社区反馈：新网友的 DSH 打不开，**把 DSH 家目录改名后就能启动**——典型的"状态坏了、绕过家目录"救急。

- **新检查 `stale-home-backup`**（JS + PS）：扫描 `~/.dsh` 旁边被改名的旧家目录（如 `.dsh.bak`、`.dsh_old`），提醒旧会话/插件/设置还在里面，先别删。
- **新检查 `storage-corrupt`**（JS + PS）：解析 `~/.dsh/storages/*.json`，损坏时报出来（可能直接导致启动/加载失败）。
- 顺手修了 `storage-corrupt` 初版用 `readDirNames` 只遍历目录导致漏报的问题。
- `docs/traps.md` 加 #20（改名救急的正确处理顺序）；`docs/catalog.md` 加第 19、20 项。

## v0.13.9 — 2026-10-24

社区排障报告确认：qq-bridge 的根因不是插件入口，而是 **profile 注册的 stdio MCP server 里有一个加载失败**（`mcp-media.js` 把 `const server` 声明在 `if` 里、却在外面调用 `server.connect()` → ReferenceError）。**任何一个 MCP server 加载失败，DSH host 都会直接退出**，桌面端就是「应用无法启动」，shell 重启后行号变化，看起来像"老崩溃"。

- **新检查 `mcp-entry-broken`**（JS + PS 两套）：解析 profile `cordis.patch.yml` 里的 `@deepseek-ai/dsh-mcp-client` 行，检查入口文件是否存在、`node --check` 是否通过，启动前就能发现会拖垮 host 的入口。
- `docs/traps.md` 加 #19（含作用域 bug 示例）；`docs/catalog.md` 加第 18 项。
- 同时记录报告里的第二个问题：DSH 每次重启换 Web 端口，外部桥接只读启动时 `baseUrl` 会一直连旧端口（10114 vs 12377）——这类"端口漂移"要靠外部脚本轮询修正，医生不自动改外部配置。

## v0.13.8 — 2026-10-24

社区反馈：DSH 启动直接弹「应用无法启动」，错误是 `ReferenceError: server is not defined`，栈指向 `.../default-workspace/qq-bridge/index.js`。

- **新检查 `plugin-boot-failure`**（JS + PS 两套）：扫描桌面端 crash 日志里的 `ReferenceError / TypeError / SyntaxError / RangeError` 和 `file:///…` 栈帧，直接报出**是哪个插件文件**把 DSH 启动搞崩，并给出恢复顺序。
- 实测能识别截图里的案例：插件 `qq-bridge` 在模块加载阶段引用未声明变量（ESM 严格模式）。
- `docs/traps.md` 加 #18；`docs/catalog.md` 加第 17 项。

## v0.13.7 — 2026-10-24

- **原生 Rust CLI（P1）**：`doctor-sys` 增加 `scan` / `fix` 子命令，编出 `dsh-doctor-native.exe`（单文件、纯 Rust、无 PowerShell / Node / 第三方 crate）。`scan` 覆盖 8 项检查，`fix` 支持桌面标签 / 宿主包副本 / patch 层恢复。
- CI doctorsys job 增加原生冒烟测试，Release 增加该资产。
- 为什么之前不是纯二进制：检查逻辑在 PS（EXE）和 JS（插件）两侧，Rust 只做底层原语；P2 再把剩余能力迁入并替换默认 EXE。

## v0.13.6 — 2026-10-24

- **EXE 同步**：v0.13.5 的 `permission-too-broad` 只加在 JS 插件侧，`dsh-doctor.exe` 走的是 PowerShell 检查表，所以 EXE 扫不到。本版补上 PS 版 `Test-DoctorPermissionTooBroad`（读 `session_projcache.json`，按会话列出 `danger-full-access`），并重新打包 EXE。
- 实测 EXE 现在输出：`[High] Sessions run with danger-full-access and approval never: 27`。
- 记录一个结构性事实：**EXE 与插件的检查表是两套**（PS / JS），以后新增检查两边都要加（已写进 HANDOFF 专项 #39）。

## v0.13.5 — 2026-10-24

回应社区反馈：**权限给太大，DSH 把自己的文件删了**。

- **新检查 `permission-too-broad`**：读 `~/.dsh/storages/session_projcache.json` 里每个会话的权限投影，列出所有 `danger-full-access`（尤其再叠加 `approval: never`）的会话。本机实测 50 个会话里 **27 个**是这种配置——等于把整台机器交给模型，误删不经过回收站。
- **新增 [docs/recovery.md](docs/recovery.md)**：文件被 DSH 删了怎么救——先停手 → 判断在 Git/回收站/卷影哪一层 → Git 恢复 → VSS/文件历史/网盘 → 数据恢复软件 → 从 DSH 会话日志找线索 → 防复发。
- `docs/fixable.md` 增加「文件被 DSH 删了」条目（明确：不是一键修复，给恢复顺序）；`docs/traps.md` 加 #17；`bugs/unverified.md` 加 U13。
- `bundle-version-skew` 修正：只有从 app.asar 读到**准确**运行时版本时才启用，避免 CLI 读到过期 runtime.json 时产生误报。

## v0.13.4 — 2026-10-24

全量拆包比对 DSH 0.2.1-rc.2 → rc.3（下载 rc.2 安装包、提取 app.asar、与 rc.3 逐包比对），并据此补两个检查：

- **`bundle-version-skew`**：profile 里 `@deepseek-ai/*` 插件固定在旧版本（本次实测：`dsh-subagent-codex` / `dsh-subagent-claude-code` 还是 rc.1，运行时已 rc.3）时直接报提醒——这正是"插件还在列表里但功能不工作"的原因。
- **`runtime-metadata-stale`**：`~/.dsh/dsh-runtimes/dsh-primary-runtime/runtime.json` 在桌面端更新后没有刷新（仍写 rc.2，实际 rc.3），任何依赖它判断版本的逻辑都会误判。
- 审计工具：`tools/snapshot-asar.mjs`、`tools/diff-asar-snapshots.mjs`，下次升级可以一条命令复现这份比对。

本次比对结论（rc.2 → rc.3）：新增包只有 `@deepseek-ai/dsh-client-ui-entry-customization`（界面自定义 More 菜单），无删除；296 个包统一升到 rc.3；新增 3 个客户端插槽（`sidebar.panellist.actions`、`conversation.session.header.views.actions`、`sidebar.right.tab.guide.actions`）；base/plugin-manager/session-format/renderer 代码未变。

- 文档重整：README 首屏改为「坏了直接下急救包」，安装细节移到 `docs/install.md`；`bugs/unverified.md` 新增 12 条疑似未验证问题；subagent 插件升到 rc.3。

## v0.13.3 — 2026-10-24

**修「DSH 更新后插件图标被挤掉」的真正原因**：不是 DSH 挤掉，是我们改了 npm 包名（`dsh-doctor` → `dsh-doctor-plugin`）但标识没同步。

- DSH 客户端模块用**包名**标识浏览器模块（`client-modules`：manifest package name identifies the browser module）。
- 旧状态：`package.json.name = dsh-doctor-plugin`，但 `cordis.patch.yml` 的 `id/name` 和 `client.js` 的 `__ModuleLoader__.load({ id })` 还是 `dsh-doctor` → 宿主半边正常（接口/体检都能跑），浏览器半边静默不注册 → 侧边栏图标和面板消失、插件列表却显示"已启用无报错"。
- 修复：`cordis.patch.yml` 改为 `id/name: dsh-doctor-plugin`；`client.js` 模块 id 改为包名；移除旧 bundle 后按新包名重装。
- **新增检查 `bundle-identity-drift`**：依赖名 ≠ 包名、或 client 模块 id ≠ 包名时直接报高危，以后这类漂移会被医生当场抓住。
- 新增 Bug 图鉴 #11、traps #15、catalog 第 13 项。

## v0.13.2 — 2026-10-24

修外部评审提出的 14 条（逐条核验后处理）：

- **`set-integrity-label --recursive` 双重设置**（必修）：`recursive` 已经用 `(OI)(CI)` 继承设置父目录，又遍历整棵树逐个 `SetNamedSecurityInfoW`——桌面几千文件会慢到不可接受。现在 `recursive` 只设父目录继承，要覆盖子项显式标签时用新的 `--forceChildren`。
- **`restore_sddl` owner 判断**（必修）：`starts_with("O:")` 对 `D:...O:...` 合法 SDDL 会漏判；改成看 `parts.owner` 指针是否为空。
- **`selftest` 临时文件**（必修）：抽出 `selftest_acl_read()`，无论写入/acl-read 是否失败都在返回前清理实际写过的路径。
- **`baseline` 的 `requiredFiles` 未被使用**（必修）：`normalizeBaseline` 映射该字段，`computeEnvironmentDiff` 检查每个 profile 的 `package.json` / `cordis.patch.yml`，缺失报 medium。
- **报告脱敏漏带空格的用户名**（小）：`C:\Users\John Doe\...` 之前会变成 `C:\Users\user Doe\...`；改为匹配到下一个反斜杠/斜杠为止，并新增 `tests/sanitize.test.mjs` 进 CI。
- **`checkWorkspaceWritability` 清理不彻底**：写入抛错时也会尝试删除半截临时文件。
- **桥接支持 `.cmd/.bat` 引擎**：Windows 上 `spawnSync` 直接跑 `.cmd` 会 EINVAL；现在按 `cmd.exe /c` 包装，`tests/bridge.test.mjs` 在 Windows 上也能验证正向协议（不再只测回退分支）。
- **版本号不再硬编码**：`tools/cli.mjs version` 读 `plugin/package.json`；EXE 构建时把 `$script:DshDoctorVersion` 替换成真实版本。
- **构建冗余**：`build.ps1` 支持 `DSH_DOCTOR_SKIP_SYS=1`，CI 的 windows job 跳过 Rust 构建（引擎只由 `doctorsys` job 出）。
- **文档修复**：fixable 的 rescue 链接指向 `bugs/07-rescue-pitfalls.md`；protocol 的通用原语补表头；UPDATES 合并重复的 v0.12.0 并按版本重排；HANDOFF 标题版本号对齐。
- 澄清：仓库根目录**没有** `package.json`，`plugin/package.json` 是唯一包定义（已是 0.13.2 + `files: ["lib/"]`，`npm pack --dry-run` 9 个文件含 `scan-worker.mjs`）。

## v0.13.1 — 2026-10-24

- **修 npm 包漏文件**：`files` 字段只列了 `lib/index.js` 和 `lib/client.js`，漏掉 `lib/scan-worker.mjs`；从 npm 安装后 worker 线程不可用，会退回同步扫描（正是 v0.9.0 修掉的卡顿问题）。改为 `"lib/"` 整目录打包，`npm pack --dry-run` 复核 9 个文件。
- 该修复在上架 npm 之前完成；npm 账号冻结与代码无关。

## v0.13.0 — 2026-10-24

- **MCP 代理引擎原语表（设计 §10 的"外部 agent"一层补全）**：
  - 新工具 `doctor_sys_list`（原语表 + 引擎可用性）和 `doctor_sys`（调原语）；
  - 读原语（acl-read / proc-list / port-probe / port-pid / selftest / version）直通；
  - 写原语（ACL 修改 / 隔离 / 快照 / 杀树 / 通知 / 外壳刷新）走**两段式**：
    第一次调用只回 dryRun 计划 + 一次性 token（5 分钟过期），带 `confirm: <token>`
    重复**完全相同**的调用才执行；token 单次有效，重放回到 dryRun；
  - 没有新 shell 通道：原语表是封闭白名单，未知 op 一律拒绝；
  - 修了 MCP `serverInfo.version` 硬编码 0.4.1 的陈旧问题（改为跟 plugin/package.json）；
  - `tests/mcp.test.mjs` stdio 回归（10 项断言）：CI ubuntu 验无引擎路径、Windows 验有引擎路径。
- **npm 上架准备**：插件包发布化为 **`dsh-doctor-plugin`**——npm 上的 `dsh-doctor` 名字
  已被第三方同名包占用（astra3294/dsh-doctor 0.4.3，同领域撞名，非本项目）。
  `plugin/package.json` 去 private、补 repository/license/keywords、新增包级 README；
  `npm pack` 验证 8 文件 38 KB。发布只差 `npm login` + `npm publish`（见 HANDOFF 风险表）。

## v0.12.0 — 2026-10-24

- **插件 ACL/外壳动作桥接 doctor-sys（P1）**：设 `DSH_DOCTOR_SYS` 指向引擎 exe 后，
  `aclSddl`（读 SDDL）、桌面标签修复（`set-integrity-label` + `remove-deny-ace`）、外壳刷新（`shell-refresh`）
  优先走 Rust 引擎，PowerShell 兜底；不设则完全是原行为，零风险灰度。自动巡检（30 秒巡逻）同样受益。
  桌面备份仍用 icacls `/save` 格式（EXE 的回滚路径认它），引擎只在 icacls 不可用时兜底备份。
  实测价值：DSH 沙箱对未签名 exe 的 ACL 写有差别待遇（引擎被拒、微软签名的 icacls 放行），
  引擎失败自动落 icacls 的分层正好扛住这类环境。
- **Low 标签判据修复 + 统一**：原来只认 `S:(ML;;NW;;;LW)`（DSH 直写形态），
  漏掉带 AI 控制位/继承标志的形态（`S:AI(ML;ID;NW;;;LW)`——沙箱/引擎写出的样子）。
  判据收敛为单一常量 `LOW_LABEL_PATTERN`（JS 七处 + PS 一处同源），配套真相表测试
  `tests/label-pattern.test.mjs`（9 种 SDDL 形态）。
- **修复流程 fail-closed**：修复前读不到桌面 ACL 不再谎报"已经很干净"（明确失败）；
  修复后复检读不到不再当"验证通过"（报"无法验证"）；体检里桌面 ACL 读不到新增
  `desktop-acl-unreadable` 发现（与 PS 版对齐，原来静默漏报）。
- **watch.mjs 气泡优先走引擎 notify**：`DSH_DOCTOR_SYS` 或仓库 cargo 产物可用时用
  `Shell_NotifyIconW` 原生气泡，WinForms 兜底；没引擎时行为不变。
- **桥接协议测试**：`tests/bridge.test.mjs`——没配/配错回退 null、CLI 形式（布尔转旗标）、
  `ok:false` 原样返回、非 JSON/非 0 退出码回退；CI ubuntu 用假引擎全量验证，Windows 验回退分支。
- **CI 增补**：doctor-sys job 加"桥接修复端到端"（runner 正常上下文：种 Low 标签 → CLI 修复 →
  断言 Medium），integration job 加桥接与判据真相表两个测试。

## v0.11.1 — 2026-10-24

审计 Zcode 的 v0.11.0 后补的洞：

- **CI 补上写原语冒烟**：`doctor-sys` job 原来只跑 selftest + 只读探针，写原语（`set-integrity-label` / `snapshot-write` / `snapshot-restore` / `quarantine-dir`）零覆盖；现在在 runner 的正常桌面上下文里跑一遍。
- **`doctor-sys/README` 补「运行上下文」**：写原语在 DSH 沙箱内会被拒（Win32 5），`notify` 被 UIPI 拒（`shown:false`），`proc-kill-tree` 会杀掉传入 pid 的整棵树（别传当前 shell / 父进程 pid）。
- **救援锁区分"忙"与"锁建不起来"**：以前 IO 失败也报"另一个窗口在启动"，误导；现在锁失败不阻塞逃生，只是失去互斥保护。
- **HANDOFF 快照版本号修正**（0.10.4 → 0.11.1）。

## v0.11.0 — 2026-10-24

- **Rust 原语引擎 `doctor-sys.exe` 落地（设计文档 D1/§9 的 P0 里程碑）**：
  - 零第三方依赖（全部手写 Win32 FFI，离线可构建）、静态 CRT 单文件约 300 KB；
  - 15 个原语：ACL 读/备份/还原、完整性标签（可递归）、删拒绝 ACE、进程列表、
    杀进程树（拒绝杀系统进程/自己，支持 dryRun）、端口探测、端口归属 pid、
    外壳刷新、目录隔离、快照写/还原、原生气泡通知、自检；
  - 协议：JSON over stdio，每个请求一个进程；没有 exec、没有 shell；
  - 单元测试（JSON 解析器）+ `selftest` 自检进 CI；随 Release 分发第五个资产；
  - 修复构建脚本在 Git Bash 环境下 GNU tar 把 `D:\` 当远程主机的问题（改用系统 bsdtar）。
- **修复录轮转**：`history.jsonl` 超过 256 KB 轮转到 `history.1.jsonl`（只留一代），读侧自动补齐，面板修复录不再无限增长。
- **救援多实例互斥**：两个窗口同时点「起网页版」不再各起一个实例（`rescue.lock`，3 分钟过期，与 npx 下载等待上限对齐）。
- **修复中文 Windows 下 PS 5.1 无法解析源码的问题**：全部 `.ps1` 加 UTF-8 BOM——此前无 BOM 的 UTF-8 中文源码在 GBK 代码页的机器上会被 PS 5.1 按 ANSI 误读导致语法错误（CI 的 en-US 环境测不出来）；EXE 构建路径不受影响（Get-Content 会剥 BOM，C# 启动器自己再写 BOM）。
- 文档：UPDATES 补上 v0.10.3 / v0.10.4 条目，README 徽章对齐实际版本；设计文档 §9 原语表与里程碑更新为实况。

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
