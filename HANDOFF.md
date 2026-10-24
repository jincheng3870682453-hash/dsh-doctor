# DSH Doctor · 交接文档

> **给接手的 Agent / 维护者**：读完这一份就能接着干，不需要翻聊天记录。
> 最后更新：2026-10-24 · 当前版本 **v0.13.7** · 仓库：`github.com/jincheng3870682453-hash/dsh-doctor`

---

## 0. 这是什么

DSH 桌面端在 Windows 上会踩一批"系统状态"级的坑（最出名的是把桌面目录打成低完整性标签，导致图标全变白）。这个项目是 **DSH 私人医生**：

- 定位：**DSH 桌面端的底层运行时急救箱**——不满足于清症状，直接改回底层状态；
- 口号：**只要是 DSH 引起的毛病，无论什么奇葩症状，我都能治好。**
- 动作口号：**点一下修复。**
- 原则：默认只读 → 修复先备份 → 改最小 → 改完复检 → 失败可回滚；
- 许可证：**MIT**（非官方项目，与深度求索无关）。

---

## 1. 当前状态快照

| 项 | 值 |
|---|---|
| 最新 Release | `v0.13.7`（5 个资产：exe / doctor-sys.exe / unix tar / 环境包 / 插件 zip） |
| 插件版本 | `plugin/package.json` → 0.13.7 |
| npm | **`dsh-doctor-plugin@0.13.7`**（latest；发布账号 `jinchengszj123`，安全密钥型 2FA） |
| 分支 | `main`（本地与远端内容一致；因网络限制，本地 git 无法 fetch/push，靠 API 推送） |
| CI | `.github/workflows/ci.yml`（三系统冒烟 + 集成 + 压力）、`build.yml`（构建 + 产物冒烟 + tag 自动发版） |
| 桌面端运行时 | 本机 `E:\dsh`，DSH 0.2.1-rc.2，Electron 44.x |
| 本机 GUI | `http://127.0.0.1:50819`（端口每次重启会变，以运行时上下文为准） |
| 仓库话题 | dsh / deepseek-harness / windows / macos / linux / sandbox / permissions / diagnostics / repair / plugin 等 18 个 |

---

## 2. 目录地图

| 路径 | 作用 |
|---|---|
| `plugin/` | **核心插件**：`lib/index.js`（host ~2100 行）、`lib/client.js`（面板）、`lib/scan-worker.mjs`（后台扫描线程）、`locale/*.json`、`cordis.patch.yml`、`icon.svg`、`package.json`（声明 `dsh.bundle.patch`） |
| `doctor-sys/` | **Rust 底层原语引擎**（设计文档 D1/§9 的 P0 落地）：零第三方依赖、静态单文件、JSON over stdio、15 个原语 + selftest。协议与实测坑见 `doctor-sys/README.md` |
| `docs/install.md` | 安装方式详解（npm / 本地 zip / 命令行 / AI + 桌面端限制） |
| `docs/fixable.md` / `docs/traps.md` / `docs/catalog.md` / `docs/baseline.md` / `docs/protocol.md` / `docs/design.md` | 修复清单 / 踩雷 / 修复目录 / 差异基线 / 检查包协议 / 架构设计 |
| `bugs/` | Bug 图鉴：`01`–`11` 已确认；`unverified.md` 是**疑似未验证清单**（排雷线索，不当结论用） |
| `tools/cli.mjs` | 跨平台菜单式 CLI（scan/fix/history/rescue/report/diff） |
| `tools/mcp.mjs` | stdio MCP server（doctor_scan / doctor_history / doctor_fix / doctor_rescue / doctor_sys_list / doctor_sys） |
| `tools/watch.mjs` | 外部守护脚本（Windows 气泡通知，引擎优先） |
| `tools/build.ps1` | 构建 Windows EXE（C# 启动器内嵌 PowerShell）+ Unix 包 + 插件 zip |
| `tools/package-unix.sh` | 打 Linux/macOS 包（核心发布为 `index.mjs`，避免 CJS 误判） |
| `tools/push.mjs` | 用 GitHub REST Git Data API 推提交（本机 `github.com:443` 不可达，`api.github.com` 可用） |
| `tools/strip-icons.ps1` | 去 emoji（历史遗留工具） |
| `tools/worker-check.mjs` | worker 线程自检 |
| `src/` | PowerShell 版实现（EXE 用）：`dsh-doctor.ps1` + `src/lib/{common,checks,fixes,report}.ps1` |
| `baseline/expected.json` | **标准 DSH 基线**（差异报告用） |
| `bugs/` | Bug 图鉴（10 个 MD，记录踩过的问题/根因/修法） |
| `docs/` | fixable（修复清单）、baseline（差异报告）、catalog、traps（14 类坑）、protocol（检查包协议）、design（架构） |
| `protocol/` | 检查包 JSON Schema |
| `examples/checks/` | 示例检查包 |
| `tests/` | 冒烟/集成测试 |
| `dist/release/` | 构建产物（不入库） |

---

## 3. 架构

### 3.1 插件（宿主 + 面板）

**Host（`plugin/lib/index.js`）**
- Cordis 插件：`apply(ctx)` 里 `ctx.inject(['webServer'])` 注册 `/dsh-doctor/*` 路由，并启动自动巡检。
- 路由：`GET /status`、`GET /history`、`POST /fix`、`POST /rescue`、`GET/POST /report[/save]`、`GET /update`、`POST /update/open`、`GET/POST /diff[/save]`、`POST /notify`。
- 扫描流水线：内置检查数组 → 每条 `try/catch` 独立降级为 finding → 社区检查包合并 → 去重。
- **扫描跑在 worker 线程**（`scan-worker.mjs`），结果缓存 8 秒；worker 起不来自动退回同步扫描。
- **自动巡检**：每 30 秒检查桌面 SDDL；发现 `S:(ML;;…;;;LW)` 或 `Everyone:(D;…;;;WD)` 就重置 + `SHChangeNotify`；一小时内最多自动修 5 次（防和 DSH 打乒乓）。
- **ACL 修改互斥**：`~/.dsh/dsh-doctor/acl.lock`（2 分钟过期），避免自动巡检与手动修复互相覆盖。
- 修复动作：`desktop-label`、`workspace-entry`、`profile-host-dup`、`restore-patch-layer`、`workspace-acl`、`reap-zombies`、`refresh-shell`。
- 所有写操作：先备份 → 改最小 → 复检 → 记入 `~/.dsh/dsh-doctor/history.jsonl`。

**Client（`plugin/lib/client.js`）**
- 侧边栏图标（只有 High 才亮红点，修复后广播 `dsh-doctor:refresh` 立即重算）。
- 主面板：hero + 状态统计 + 按严重度排序的问题卡片 + 修复录 + 页脚。
- 页脚按钮：**环境差异报告**、测试通知；主操作行：**检查更新 / 生成报告 / 起网页版 / 重新体检**。
- 所有提示都是**内容流横幅**（禁止 `position: fixed`，不能盖住窗口按钮）。

### 3.2 四个入口

| 入口 | 适用 |
|---|---|
| 插件面板 | DSH 正常时（推荐） |
| `dsh-doctor.exe` | 无 Node、无命令行；**桌面端报废时唯一可用**（不依赖 DSH/Node/联网） |
| `dsh-doctor-env-win-x64.zip` | 连 Node 都没有（自带 node.exe + start.cmd） |
| CLI / MCP | 有 Node 的自动化场景 |

### 3.3 网页版逃生（最后一招）

- 复用已运行实例（`~/.dsh/dsh-doctor/rescue.json`）；从启动日志抠 `?token=` 地址打开；地址落到桌面 `dsh-doctor-网页版地址.txt`。
- 桌面端已经报废时**没法用**（这是 EXE 存在的原因）。
- 启动前生成**交接报告** = 求助报告 + 逃生说明，问题按严重度排好，直接丢给网页版 DSH。

### 3.4 报告体系（全部自动脱敏）

| 报告 | 生成方式 | 内容 |
|---|---|---|
| 给 AI 的求助报告 | 面板「生成报告」/ `node dsh-doctor.mjs report` | 提示词约束 + 体检结果 + 修复录 + 环境 |
| 环境差异报告 | 面板页脚 / `node dsh-doctor.mjs diff` / `dsh-doctor.exe diff` | 快照 + 与基线差异 + 后端报错 + 提交方式 |
| 逃生交接报告 | 起网页版时自动生成到桌面 | 逃生说明 + 求助报告 |

**脱敏规则**（JS `sanitizeText` / PS `Get-SanitizedText`）：
`C:\Users\<名字>`→`C:\Users\user`、`/home|/Users/<名字>`→`user`、散落用户名→`user`、主机名→`<machine>`、邮箱→`user@example.com`。非用户目录路径（`D:\项目名`）保留。

### 3.5 基线（标准 DSH）

`baseline/expected.json` 定义：必需 bundle（`dsh-base`；GUI profile 另需 `dsh-web-app`）、禁止依赖的宿主包、禁止的 node_modules 顶层、禁止的工作区路径、桌面完整性/ patch 层/会话格式的状态要求。代码里有一份等价的内置默认（`DEFAULT_BASELINE`），发行包缺文件时用内置的。

---

## 4. 专项清单（26 项，全部已落地）

| # | 专项 | 状态 | 入口/文件 |
|---|---|---|---|
| 1 | 桌面 Low 完整性标签（图标变白） | 一键修 | `desktop-label` / docs/traps #1 |
| 2 | 整桌闪烁（会话写桌面） | 检测 | `checkDesktopSessions` / traps #13 |
| 3 | 工作区注册在桌面（断根） | 一键修 | `workspace-entry`（优先 `workspaceRegistry.delete`） |
| 4 | 工作区不可写 | 一键修 | `workspace-not-writable` → `workspace-acl` |
| 5 | 工作区无法授权（grantWrite Win32 5） | 一键修 | `workspace-not-grantable`（owner/WRITE_DAC 判据） |
| 6 | 宿主包副本（`reading 'prepare'`） | 一键修 | `profile-host-dup`（只挪关键副本，**绝不整目录改名**） |
| 7 | 版本错配（`is incompatible with dsh`） | 一键修 | 同上机制，隔离旧副本 |
| 8 | 会话 v4 拒收 `kind:"plugin"` | 只检测 | `session-legacy-kind`（zstd 解帧，不改写） |
| 9 | patch 层被清空 | 一键修 | `restore-patch-layer` |
| 10 | credentials 版本矛盾 | 只检测 | `checkCredentials` |
| 11 | PATH 里有死掉的 dsh | 只检测 | `path-dead-dsh` |
| 12 | 崩溃日志 | 只检测 | `desktop-crash-logs` |
| 13 | 僵尸 DSH 进程（端口已死进程还挂） | 一键修 | `zombie-dsh-process` → `reap-zombies`（杀前复核命令行） |
| 14 | 自动巡检（后台挂） | 已实现 | `startAutoGuard`（开关 `DSH_DOCTOR_AUTOFIX=0`） |
| 15 | 外壳刷新（不用重启 explorer） | 已实现 | `refresh-shell`（`SHChangeNotify`） |
| 16 | ACL 修改互斥 | 已实现 | `acl.lock` |
| 17 | 扫描异步化（不卡宿主） | 已实现 | `scan-worker.mjs` + 8 秒缓存 |
| 18 | 网页版逃生（复用/token/地址落盘） | 已实现 | `rescueWeb` |
| 19 | 交接报告 | 已实现 | `writeHandoffReport` |
| 20 | 求助报告（提示词约束） | 已实现 | `buildAiReport` |
| 21 | 环境差异报告（EXE 也有） | 已实现 | `buildDiffReport` / PS `Get-RescueDiffReport` |
| 22 | 报告自动脱敏 | 已实现 | `sanitizeText` / `Get-SanitizedText` |
| 23 | 自动更新（检查+打开下载页） | 已实现 | `checkUpdate` + `POST /update/open`（只允许本仓库 URL） |
| 24 | 系统通知归因 DSH（不是 PowerShell） | 已实现 | 渲染层 `new Notification`；host 通知默认关闭 |
| 25 | 打包（EXE / doctor-sys / Unix / 环境包 / 插件 zip） | 已实现 | `tools/build.ps1`、`tools/package-unix.sh`、CI `build.yml` |
| 26 | 文档体系（README/UPDATES/CONTRIBUTING/bugs/baseline/fixable/catalog/traps/protocol/design） | 已实现 | 根目录 + docs/ |
| 27 | Rust 原语引擎 doctor-sys（设计 §9，P0） | 已实现 | `doctor-sys/`：15 原语 + selftest + 单元测试，随 Release 分发；build/ci 均有专门 job |
| 28 | history.jsonl 轮转（256 KB → history.1.jsonl） | 已实现 | `appendHistory`，读侧自动从上一代补齐 |
| 29 | 救援多实例互斥（rescue.lock，3 分钟过期） | 已实现 | `rescueWeb` 包 acquire/release；锁建不起来不拦逃生（fail-open） |
| 30 | 插件 ACL/外壳动作桥接 doctor-sys（P1） | 已实现 | `DSH_DOCTOR_SYS` 指向 exe 时 `aclSddl` / `fixDesktopLabelUnlocked` / `refreshShellIcons` 优先走引擎，PowerShell 兜底；`tests/bridge.test.mjs` 进 CI ubuntu |
| 31 | watch.mjs 气泡走引擎 notify | 已实现 | `enginePath()`：`DSH_DOCTOR_SYS` 或仓库 cargo 产物优先，WinForms 兜底 |
| 32 | MCP 代理引擎原语表 | 已实现 | `doctor_sys_list` + `doctor_sys`：读原语直通，写原语 dryRun+一次性 token 两段式（5 分钟过期、参数须一致）；`tests/mcp.test.mjs` 进 CI（ubuntu 无引擎路径 + windows 有引擎路径）；serverInfo 版本改为跟 package.json |
| 33 | npm 上架 | **已发布** | 包名 **`dsh-doctor-plugin`**，latest `0.13.7`，发布账号 `jinchengszj123`（安全密钥型 2FA）。`dsh-doctor` 已被第三方同名包占用（astra3294/dsh-doctor 0.4.3），注意甄别。旧账号 `jinchengszj` 因"新号+新设备登录+首次发布+误用恢复码当 OTP"被 npm 安全自动化临时冻结，与代码无关，可忽略。npm 处理期会短暂显示 `0.0.0-stage` 占位，扫描完成后出现正式版本 |
| 34 | bundle 标识漂移（包名/依赖名/client id 不一致） | 已实现 | `bundle-identity-drift`：宿主正常但图标/面板消失的隐形杀手。DSH client-modules 用**包名**标识浏览器模块；改包名后必须同步 `cordis.patch.yml` 的 `id/name` 和 `client.js` 的 `__ModuleLoader__.load({ id })`。案例见 `bugs/11-bundle-identity-drift.md` |
| 35 | 插件版本与运行时不一致 | 已实现 | `bundle-version-skew`：profile 里 `@deepseek-ai/*` 固定在旧版本 → 兼容性守卫禁用（列表里有、功能没有）。本机实测 subagent-codex/claude-code 仍 rc.1 |
| 36 | runtime.json 版本过期 | 已实现 | `runtime-metadata-stale`：桌面端更新后 `~/.dsh/dsh-runtimes/.../runtime.json` 不刷新（本机仍写 rc.2）；Electron 宿主里用 app.asar 比对 |
| 40 | 原生 Rust CLI（P1） | 已实现 | `doctor-sys/src/doctor.rs`：`scan`（8 项检查）+ `fix`（desktop-label / profile-host-dup / restore-patch-layer），编出 `dsh-doctor-native.exe`（纯 Rust，无 PS/Node 依赖）。P2：workspace-entry、会话 zstd 扫描迁入后替换默认 EXE |
| 39 | EXE 与 JS 检查表同步 | 已实现 | EXE 走 PowerShell 检查表、插件走 JS；新增检查要**两边都加**（本版补了 PS 版 `permission-too-broad`） |
| 38 | 权限过宽检查 | 已实现 | `permission-too-broad`：读 `~/.dsh/storages/session_projcache.json`，列出 `danger-full-access`（+ `approval: never`）的会话；本机实测 27 个。误删恢复流程见 `docs/recovery.md` |
| 37 | 全量升级比对工具 | 已实现 | `tools/snapshot-asar.mjs` + `tools/diff-asar-snapshots.mjs`：解包 rc.N 安装包 → 快照依赖/包版本 → 与新版本 diff |

---

## 5. 关键 DSH 内部知识（踩过的坑，必读）

### 5.1 插件安装

- 桌面端：「添加插件」对话框接受 **包名 / GitHub 仓库地址 / 本地目录路径**（截图确认）。
- 本地目录安装 = pnpm `link:` 语义：**目录不能移动/删除**，否则插件失效。
- `desktop` profile **由 Electron 应用独占**：`dsh plugin --profile desktop ...` 会报
  `profile "desktop" is managed exclusively by the Electron application`。
- 非桌面 profile 用 `dsh plugin --profile <name> add <spec>`（内部 pnpm，支持包名/目录/git/tarball）。
- 包根 `package.json` 必须声明 `dsh.bundle.patch`，否则判 `not-a-bundle`。
- 我们的 bundle 在 `plugin/` 子目录，**不能直接用仓库根 GitHub 地址装**（先 clone 再填 `...\dsh-doctor\plugin`）。
- 安装后默认启用；无 HMR 需重启。依赖有构建脚本时 UI 会提示「允许这些脚本并重试」。

### 5.2 图标变白的根因（1 号坑）

DSH 把桌面注册成工作区 → 授沙箱写权限时在桌面上盖：

```
S-1-4-xxx:(OI)(CI)(W,D,DC)        能力 ACE
Everyone:(CI)(DENY)(DC)           拒绝删除，永不回收
Mandatory Label\Low:(OI)(CI)(NW)  低完整性 ← 图标变白的直接原因
```

修法：`icacls /setintegritylevel '(OI)(CI)Medium'` + `/remove:d '*S-1-1-0'` + `SHChangeNotify`，
断根 = 把桌面从 `workspace.json` 移除。

### 5.3 授不了权限的判据

DSH 要 `SetNamedSecurityInfoW` 需要 **owner 是你** 或 **ACL 里给你 WRITE_DAC**。
"我能写文件" ≠ "DSH 能授权"——所以有 `workspace-not-writable` 和 `workspace-not-grantable` 两个检查。

### 5.4 会话格式

v4 拒收 `{"kind":"plugin"}`；迁移表只收录了 5 个插件 id，实际出现过 12 个。
医生只检测不改写（改写会话出错会丢历史）。

### 5.5 通知

Host 进程里的 `import('electron')` 是空壳（`{}`），**系统通知必须由渲染层发** `new Notification(...)`，
否则来源显示成 "Windows PowerShell"。

### 5.6 本机开发环境的坑

- 本机 shell 有沙箱：`spawn` 出来的 **EXE 写 Desktop / %TEMP% / `~/.dsh` 会被拒绝**（DSH 沙箱只放行工作区），
  但读、扫描正常；EXE 已做降级（打印报告 + 提示手动复制；启动横幅提示别在 DSH 终端里跑写操作）。
- PowerShell 5.1：**禁止** `Get-Content/Set-Content` 处理含中文的源码（ANSI 读 + BOM 写会毁文件），
  一律用 `[IO.File]::ReadAllText/WriteAllText(...UTF8Encoding($false))`。
- `$HOME` 是只读自动变量，脚本里别用 `$home` 做变量名（EXE 曾因此崩）。
- `spawn` `.cmd/.bat` 在 Windows 上抛 EINVAL → 必须 `cmd.exe /c`。
- 打包的 `.js` 脱离 `plugin/package.json` 的 `"type":"module"` 会被当 CJS → 发行包里核心一律 `.mjs`。

---

## 6. 操作手册

### 开发

```powershell
node tools/cli.mjs scan            # 只读体检
node tools/cli.mjs fix workspace-entry
node tools/cli.mjs report          # 求助报告
node tools/cli.mjs diff            # 环境差异报告（写桌面）
node --check plugin/lib/index.js
node --check plugin/lib/client.js
node tools/worker-check.mjs        # 验证 worker 线程
cargo build --release --manifest-path doctor-sys/Cargo.toml   # Rust 原语引擎
doctor-sys/target/release/doctor-sys.exe selftest             # 15 原语自检
```

插件调试：桌面端装本地目录（`plugin/` 绝对路径），改完重启；或 `plugin_manager set_bundle` 关→开 热重载。

### 构建

```powershell
powershell -File tools/build.ps1    # dist/release/{exe, unix.tar.gz, plugin.zip}
bash tools/package-unix.sh          # Unix 包
```

### 测试 / CI

- `ci.yml`：ubuntu/macos/windows 冒烟 + PowerShell 冒烟 + 假 `DSH_HOME` 集成修复 + 30 次压力扫描；
- `build.yml`：云端构建四个产物，并**真跑** `scan`、`diff`（Windows）、`sh dsh-doctor.sh scan`（Unix）；
- 打 `v*` tag → 自动建 Release，资产来自 CI。

### 发布（本机特殊流程）

`github.com:443` 不可达，所以**不能用 git push**：

```powershell
$env:GH_TOKEN = (gh auth token)
node tools/push.mjs                                  # 用 REST Git Data API 推 main
# tag 必须建在【远端】main 的 sha 上（本地有 API 推送造成的分叉）
$sha = gh api repos/jincheng3870682453-hash/dsh-doctor/git/ref/heads/main --jq .object.sha
# POST /git/refs {ref:"refs/tags/vX.Y.Z", sha:$sha}
```

推送后等 CI，确认 `gh release view vX.Y.Z` 有四个资产。

---

## 7. 已知风险 / 未完成（接手优先看）

| 风险 | 说明 | 建议 |
|---|---|---|
| macOS / Linux 未实机验证 | 只有 Windows 真机跑过 | 找真机跑 Unix 包，补 CI 覆盖不到的部分 |
| 升级官方插件会带回宿主包副本 | 本次把 subagent 插件 rc.1→rc.3 后，profile 里出现 `schemastery` 副本（医生当场报 `profile-host-duplicate`） | 装/升级插件后立刻体检一次；`profile-host-dup` 修 |
| 疑似问题清单 | `bugs/unverified.md` 12 条待复现（第三方 id 漂移、npm 装完不启用、macOS 包、锁竞态等） | 有现场后按图鉴格式转正 |
| npm 发布流程（可复用） | 账号用**安全密钥型 2FA**：非 TTY 下 npm 把认证 URL 打码，必须用持久终端跑 `npm publish --access public --auth-type=web`，按 ENTER 开浏览器完成安全密钥验证 | 记录：旧号 `jinchengszj` 被冻（未解冻也不影响发布）；发布账号 `jinchengszj123`；`npm pack --dry-run` 必须包含 `lib/scan-worker.mjs`（9 文件） |
| 自动更新只打开下载页 | 不自动替换（link 安装也无法替换） | 可做 zip 下载覆盖 + 重启提示 |
| 外部守护未集成 | `tools/watch.mjs` 需手动跑（v0.12.0 起气泡优先走引擎 notify） | 做安装向导（自启/托盘/卸载） |
| AUMID 原生通知 | host 只能渲染层发；DSH 死透时没有通知 | `doctor-sys.exe notify` 原语 + watch.mjs 已接（v0.12.0）；沙箱内被 UIPI 拒，如实返回 shown:false |
| 基线未随版本演进 | 内置默认基线是静态的 | 定期对照新 DSH 版本更新 |
| 桥接默认不开启 | 插件走 doctor-sys 需设 `DSH_DOCTOR_SYS`（写原语在 host 上下文可用，已在 CI 冒烟） | 稳定期后考虑插件 zip 附带引擎 + 自动发现 |
| doctor-sys 未实机覆盖全部原语 | notify/quarantine/kill-tree 只在开发机 + CI runner 验证过；reg 原语未实现 | 真机矩阵补验；按需补 reg-read |
| EXE 在沙箱内写文件受限 | 已降级为打印报告 | 文档已提示"在桌面双击运行" |

---

## 8. 约定与风格（必须遵守）

- **中文、直接、短**；不要客套，不要"综上所述"。
- **不吹牛**：宣传必须能兑现；做不到就改文案或真做。宣传句与实际行为逐条对齐（v0.7.0 起）。
- **无 emoji**：README / docs / CLI 输出 / 报告里一律不用（历史已清理，`tools/strip-icons.ps1`）。
- **修复三原则**：默认只读、先备份、改最小、复检、可回滚。
- **不改 DSH 安装目录**、不注册服务/驱动、检查包无 shell 通道。
- 面板禁止 `position: fixed` 覆盖层（会盖住窗口按钮），用内容流横幅。
- 提交信息：`fix: / feat: / docs: / chore:` + 中文一句话。
- 单元/集成测试优先覆盖"假 DSH_HOME"上的行为，避免碰真机状态。

---

## 9. 接手先跑这 5 条

```powershell
node tools/cli.mjs scan            # 应正常输出体检结果
node tools/cli.mjs diff            # 应写出桌面 MD（已脱敏）
powershell -File tools/build.ps1   # 应产出 5 个产物（含 doctor-sys.exe，需要 cargo；没有则 4 个 + 跳过提示）
./dist/release/dsh-doctor.exe scan # EXE 应能跑
./dist/release/doctor-sys.exe selftest   # Rust 引擎自检应 ok:true
$env:GH_TOKEN=(gh auth token); node tools/push.mjs   # 应输出 PUSH_OK
```

如果 EXE 的 `diff` 在这台机器上写桌面失败：那是 DSH 沙箱限制，不是 bug（见 5.6）。

---

## 10. 上游与资料

- DSH 上游包：`@deepseek-ai/dsh-plugin-manager`（安装/启停语义）、`dsh-web-app`（Web 组合）、`dsh-client-ui-plugin-manager`（插件页 UI）。
- 本仓库文档：`README.md`、`UPDATES.md`、`CONTRIBUTING.md`、`docs/fixable.md`、`docs/baseline.md`、`bugs/`。
- 官方安装机制参考：`dsh-plugin-manager` 的 `README.md`（`installBundle` / `inspect` / registry 回退 / 版本豁免）。
