# 更新记录

> 每个版本一句话说清"给你带来了什么"。详细技术变更见 [CHANGELOG.md](CHANGELOG.md)，安装包见 [Releases](https://github.com/jincheng3870682453-hash/dsh-doctor/releases)。

## 怎么选入口

| 你的情况 | 用哪个 |
|---|---|
| DSH 正常，想平时体检 / 一键修 | **插件面板**（推荐，装 `dsh-doctor-plugin.zip`） |
| 没有 Node、没有命令行 | **`dsh-doctor.exe`**（自包含，双击即用） |
| DSH 桌面端已经彻底报废 | **`dsh-doctor.exe`**——不依赖 DSH、不依赖 Node、不联网，仍可体检 / 修图标 / 生成差异报告 |
| 想提交 issue / 找人帮忙 | 面板页脚「环境差异报告」或 `dsh-doctor.exe diff`，生成的 MD **已脱敏** |
| 连 Node 都没有（Linux/macOS 先装 Node） | Windows 用 `dsh-doctor-env-win-x64.zip`（自带 node.exe） |

## 装插件（三种方式）

1. **桌面端应用内**：侧边栏 → 插件 → 添加，弹出「添加插件」对话框（输入框支持**包名 / GitHub 仓库地址 / 本地目录路径**）。把解压后的绝对目录粘进去，例如 `D:\dsh-doctor-plugin`，点安装。装完默认启用，没生效就重启。
2. **命令行（非桌面 profile）**：`dsh plugin --profile web add "D:\dsh-doctor-plugin"`。内部是 pnpm，包名 / 本地目录 / git / tarball 都行。
3. **会话里让 AI 装**：`plugin_manager` 的 `install_bundle`，`target` 填绝对目录。

> 两个坑：① 桌面端的 `desktop` profile 由 Electron 应用独占，命令行会拒绝（`profile "desktop" is managed exclusively by the Electron application`）；② **别填本仓库 GitHub 地址**——bundle 在 `plugin/` 子目录，仓库根不是 package，会被判 `not-a-bundle`；要远程装先 `git clone`，再填 `...\dsh-doctor\plugin`。

---

## v0.11.0 — 2026-10-24

- **底层引擎「发扬光大」**：设计文档里规划的 Rust 原语引擎 `doctor-sys.exe` 真做出来了——零第三方依赖、单文件、双击就能体检/修底层状态。插件和 EXE 后续都会逐步改走它。
- **修复录不再无限长**：超过 256 KB 自动轮转，面板里的历史不丢。
- **两个窗口同时点「起网页版」不会各起一个实例了**（互斥锁）。
- 开发者：构建脚本在 Git Bash 下打 Unix 包失败的问题已修。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.11.0)

## v0.12.0 — 2026-10-24

- **Rust 引擎正式接入插件**：装了 `doctor-sys.exe` 并设置 `DSH_DOCTOR_SYS` 环境变量后，图标签修复、ACL 读取、图标刷新都走引擎——更快，也不再起 PowerShell 进程。不设置就是原来的行为，随时可以退回。
- **守护脚本的通知也换引擎了**（有引擎时）。
- 想尝鲜：下载 Release 里的 `doctor-sys.exe` 放到固定目录，然后 `setx DSH_DOCTOR_SYS "C:\你的目录\doctor-sys.exe"`，重启 DSH 生效。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.12.0)

## v0.11.1 — 2026-10-24

- 审计 v0.11.0 后补的洞：CI 补上 Rust 写原语冒烟（之前写原语零覆盖）；`doctor-sys/README` 写清哪些原语在 DSH 沙箱里会被拒、`proc-kill-tree` 的误杀风险；救援锁不再把"锁建不起来"误报成"另一个窗口在启动"。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.11.1)

## v0.10.4 — 2026-10-24

- **安装步骤可直接照抄**：对齐真实「添加插件」对话框——解压插件包到固定目录 → 粘**绝对目录**进去 → 保持默认安装源 → 点安装；并说明对话框里那句「插件在本机以你的权限运行」是所有插件的通用警告。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.10.4)

## v0.10.3 — 2026-10-24

- **安装文档按 DSH 真实机制重写**（来源：`@deepseek-ai/dsh-plugin-manager`）：桌面端在插件页添加、非桌面 profile 用 `dsh plugin --profile <name> add`、会话里让 AI 用 `install_bundle`；说明 `desktop` profile 由 Electron 独占、bundle 必须声明 `dsh.bundle.patch`。
- CONTRIBUTING 新增「把开发版装进 DSH 调试」（本地目录 = `link:` 语义，目录别移动）。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.10.3)

## v0.10.2 — 2026-10-24

- **新增「桌面端报废时怎么办」说明**：DSH 完全起不来时，插件用不了，但 `dsh-doctor.exe` 照常可用——不依赖 DSH、不依赖 Node、不联网，双击就能体检 / 修图标 / 生成环境差异报告。
- **去掉写死的安装路径**：不再假设 DSH 装在某个盘；改为查常见安装目录 + 从正在运行的桌面端进程反查，装在哪个盘都能识别。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.10.2)

## v0.10.1 — 2026-10-24

- **报告自动脱敏**：所有对外报告（求助报告、环境差异报告、逃生交接）里的用户名、主机名、邮箱、用户主目录自动替换成 `user` / `<machine>` / `user@example.com`，目录结构保留。可以直接提 issue、贴给 AI，不用手动改。
- 连"写文件失败"的提示文字也脱敏，避免顺手把路径漏出去。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.10.1)

## v0.10.0 — 2026-10-24

- 新增**环境差异报告**：把本机 DSH 和标准基线逐项对比（工作区、profile 依赖、宿主包副本、桌面完整性、崩溃日志），差异 + 后端报错写成一个 MD 到桌面，可直接提 issue/PR。
- 三个入口都有：插件页脚「环境差异报告」、`node dsh-doctor.mjs diff`、`dsh-doctor.exe diff`（不需要 Node）。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.10.0)

## v0.9.0 — 2026-10-24

- 体检移到后台线程，不再卡 DSH 界面（有缓存，面板秒开）。
- 自动巡检与手动修复加互斥锁，不会互相覆盖。
- 新增**插件包** `dsh-doctor-plugin.zip`：解压安装，仓库挪动也不会坏。
- 网页版逃生交接报告升级：问题清单已排好序，直接丢给 AI 就能接着修。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.9.0)

## v0.8.1 — 2026-10-24

- 自查修掉 5 个隐患：发行包版本文件缺失、环境包 `.cmd` 带 BOM、自动巡检与 DSH 反复拉扯、僵尸进程可能误杀、写探针残留垃圾。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.8.1)

## v0.8.0 — 2026-10-24

- 面板新增**检查更新**按钮，可一键打开下载页。
- 去掉全部 emoji 图标，文档与输出更干净。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.8.0)

## v0.7.0 — 2026-10-24

- **后台自动巡检**：桌面标签被 DSH 偷偷降级，30 秒内自动拉回并刷新图标。
- **僵尸进程回收**：清理"端口已死、进程还挂"的残余实例。
- 文案升级为「底层运行时急救箱」。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.7.0)

## v0.6.3 — 2026-10-24

- 新标语：「只要是 DSH 引起的毛病，无论什么奇葩症状，我都能治好。」
- 新增 [修复清单](docs/fixable.md)：按"你看到的现象"列出能修什么。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.6.3)

## v0.6.2 — 2026-10-24

- 修掉 CI 抓到的打包 bug：发行包核心文件统一为 `.mjs`，避免被当成 CommonJS 加载。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.6.2)

## v0.6.1 — 2026-10-24

- 新增 **Windows 环境包**（自带 node.exe），连 Node 都没装也能用。
- 逃生反馈更明确：等 3 分钟、失败说清原因、地址写到桌面。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.6.1)

## v0.6.0 — 2026-10-23

- 一键生成**给 AI 的求助报告**（带提示词约束），复制或保存都行。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.6.0)

## v0.5.3 — 2026-10-23

- 补上盲区：检查工作区是否可写、DSH 是否能给它授权（`grantWrite` 那类问题）。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.5.3)

## v0.5.2 — 2026-10-23

- 插件图标统一成品牌 Logo；介绍文件大幅精简。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.5.2)

## v0.5.1 — 2026-10-23

- 编译与测试全部上云：三系统冒烟、集成修复测试、30 次压力扫描。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.5.1)

## v0.5.0 — 2026-10-23

- 三平台发行包：Windows EXE、Linux sh、macOS command。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.5.0)

## v0.4.x — 2026-10-23

- v0.4.4 通知改由页面发出（来源显示为 DSH，不再是 PowerShell）。
- v0.4.3 逃生实例复用、带 token 打开、日志落盘。
- v0.4.2 结果提示改为页面内横幅，不遮挡窗口按钮。
- v0.4.1 网页版改为"最后一招"，启动前生成桌面交接报告。
- v0.4.0 核心跨平台（Windows / macOS / Linux）。

## v0.3.0 — 2026-10-23

- 修复录、网页版逃生、常驻守护脚本、MCP 面、修复目录。

## v0.2.0 — 2026-10-23

- 社区检查包协议 v1（写 JSON 就能加检查）；工作区修复改走 DSH 自己的服务。

## v0.1.0 — 2026-10-23

- 首版：检测器 + 一键修复 + 侧边栏面板。

---

## 怎么更新

| 你的安装方式 | 更新方法 |
|---|---|
| 插件（zip 安装） | 下载新 `dsh-doctor-plugin.zip`，解压覆盖，重启 DSH |
| 插件（本仓库 link） | `git pull` 后重启 DSH |
| Windows EXE / 环境包 / Unix 包 | 下载新版本替换即可（无需卸载） |

面板右上角「检查更新」可以直接看有没有新版并打开下载页。
