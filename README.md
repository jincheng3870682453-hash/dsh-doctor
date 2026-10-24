# DSH Doctor · DSH 私人医生

<div align="center">

<img src="assets/logo.svg" width="96" alt="DSH 私人医生" />

### 只要是 DSH 引起的毛病，无论什么奇葩症状，我都能治好。

**点一下修复。** DSH Doctor：不仅是修复工具，更是 DSH 桌面端的**底层运行时急救箱**——专治标签损坏 / 进程失控导致的图标变白、屏闪、白屏与启动崩溃。

[**更新记录**](UPDATES.md) · [参与贡献](CONTRIBUTING.md) · [Bug 图鉴](bugs/README.md) · [修复清单](docs/fixable.md)

[![Version](https://img.shields.io/badge/Version-0.11.0-4D6BFE)](https://github.com/jincheng3870682453-hash/dsh-doctor/releases)
[![Release](https://img.shields.io/github/v/release/jincheng3870682453-hash/dsh-doctor?label=Download&color=4D6BFE)](https://github.com/jincheng3870682453-hash/dsh-doctor/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/jincheng3870682453-hash/dsh-doctor/ci.yml?label=CI&logo=github&color=4D6BFE)](https://github.com/jincheng3870682453-hash/dsh-doctor/actions)
[![License](https://img.shields.io/badge/License-MIT-4D6BFE)](LICENSE)

</div>

---

## 它做什么

DSH Doctor **不满足于表面的症状清理**。当 DSH 桌面端因底层状态标签被改坏、后台进程失控而出现图标白纸、整屏狂闪时，医生直接介入运行时：

-  **自动巡检与修复**：后台每 30 秒巡逻一次桌面完整性标签。一旦被 DSH 重新降级、或又被塞进拒绝项，**立刻重置并通知外壳重取图标**——不重启资源管理器、不闪屏。开关：`DSH_DOCTOR_AUTOFIX=0`。
-  **僵尸进程回收**：定位"端口已经死了、进程却还挂着"的残余 DSH 实例，一键回收，终结无限重载；不影响正在用的实例。
-  **根源兜底**：只要是 DSH 引起的毛病，无论症状多奇葩，都从底层状态拉回正轨——不是清缓存、不是重启试试。

再加四个常规能力：

- **查**：体检 13 项状态，每条带路径与原始证据，默认只读；
- **修**：一键修复，**先备份 → 改最小 → 立刻复检**，失败就还原；
- **报**：一键生成**给 AI 的求助报告**（带提示词约束），复制发给任何 AI，或保存到桌面留档；
- **比**：**环境差异报告**——把本机 DSH 和标准基线逐项对比，差异 + 后端报错写成桌面 MD，可直接提 issue/PR；
- **逃**：实在修不好，生成桌面交接报告 + 起隔离端口的网页版，让网页版 DSH 接手。

> **零环境也能用**：Windows 用自包含 `dsh-doctor.exe`（不装 Node、不装命令行）；连 Node 都没有，用 `dsh-doctor-env-win-x64.zip`（自带 `node.exe`）。

## 安装

插件是 **profile 级**的：装一次，该 profile 下所有会话都能用，重启后仍然在。

### 方式一：应用内「添加插件」对话框（推荐，桌面端用这个）

DSH 侧边栏 → **插件** → **添加**，会弹出标题为 **「添加插件」** 的对话框，说明文字是：

> 输入插件的包名、GitHub 仓库地址或本地目录路径。

三种输入都支持，我们这种没上架 npm 的插件用**第三种**：

1. 下载 Release 里的 `dsh-doctor-plugin.zip`，**解压到一个固定目录**，例如 `D:\dsh-doctor-plugin`（别放桌面，免得和图标修复互相干扰）；
2. 在那个输入框里粘**解压后的绝对目录**：`D:\dsh-doctor-plugin`；
3. 「安装源」（中国大陆镜像源）对本地目录没有影响，保持默认即可；
4. 点 **安装**。装完默认启用，侧边栏出现「私人医生」；没立即生效就重启一次 DSH。

对话框里的黄色提示「插件在本机以你的权限运行」是所有插件的通用警告——医生的代码全在仓库里、默认只读、改动先备份，可以自己审。

> **别直接填本仓库的 GitHub 地址**：我们的 bundle 在 `plugin/` 子目录，仓库根不是 package，会被判为 `not-a-bundle`。
> 想用 GitHub 地址装，先 `git clone`，然后在对话框里填 `...\dsh-doctor\plugin`。

> 桌面端（`desktop` profile）的插件安装由 Electron 应用自己管理，命令行装不了——会提示
> `profile "desktop" is managed exclusively by the Electron application`。

### 方式二：命令行（web / tui 等非桌面 profile）

```bash
dsh plugin --profile web add "D:\path\to\dsh-doctor\plugin"
```

它内部就是 pnpm，接受**包名、本地目录、git 地址、tarball**；装完会自动加进 `dsh.profile.bundles` 并启用。

### 方式三：在会话里让 AI 装

对 AI 说「把这个目录装成插件：`D:\dsh-doctor-plugin`」，它会用 `plugin_manager` 的 `install_bundle` 装。

> 插件包根目录的 `package.json` 必须声明 `dsh.bundle.patch`（本仓库有），否则会被判为 `not-a-bundle`。
> 开发时也可以直接把仓库的 `plugin/` 目录当成本地目录装（`link:` 语义，改完代码重启生效）。

**其他平台**：[Releases](https://github.com/jincheng3870682453-hash/dsh-doctor/releases) 里按平台取——Windows `dsh-doctor.exe`（自包含，双击即用）；Linux / macOS `dsh-doctor-unix.tar.gz`（需要 Node ≥18）。另有 `doctor-sys.exe`：Rust 写的底层原语引擎（安全描述符/完整性标签/进程/端口/通知，JSON over stdio），给想直接动底层的用户和后续的守护进程用。

**没有 Node 环境？** 用 `dsh-doctor-env-win-x64.zip`：**自带 node.exe**，不需要另外装 Node、也不需要 DSH 能启动——解压后双击 `start.cmd` 即可。

### 桌面端已经彻底报废？

DSH 起不来、面板打不开、连网页版都进不去的时候，**插件里的功能一个也用不上**。这时用 `dsh-doctor.exe`——它不依赖 DSH、不依赖 Node、不联网，双击就能：

| 做什么 | 操作 |
|---|---|
| 体检 | `dsh-doctor.exe scan`，或菜单选 `1` |
| 修桌面图标 | 菜单选 `2` |
| 生成环境差异报告（可提交 issue） | `dsh-doctor.exe diff`，或菜单选 `8` |

面板里的「环境差异报告」按钮和 `dsh-doctor.exe diff` 是同一套逻辑、同一份基线，平时用面板就行，报废时用 EXE。

> 写文件、改权限请**在桌面或资源管理器里双击**运行；在 DSH 的沙箱终端里跑，写操作可能被限制（EXE 会打印报告并提示手动复制）。

```bash
node dsh-doctor.mjs scan        # 只读体检
node dsh-doctor.mjs fix workspace-entry
```

## 能修什么

**点开表格里的症状，看那条的根因、医生怎么治、以及它对应哪个坑。**

| 你看到的 | 一键修 | 详情 |
|---|---|---|
| 桌面图标全变白纸 | 可 | [看这条](docs/fixable.md#icon-white) |
| 整桌图标一起闪 | 查到是谁在写桌面 | [看这条](docs/fixable.md#flicker) |
| 白图标修完又复发 | 可 断根 | [看这条](docs/fixable.md#workspace) |
| 一开终端就报 `grantWrite` / Node 起不来 | 可 补权限并复测 | [看这条](docs/fixable.md#grant) |
| `reading 'prepare'` 每轮都炸 | 可 隔离副本 | [看这条](docs/fixable.md#hostdup) |
| 双击没反应、`is incompatible with dsh` | 可 隔离旧副本 | [看这条](docs/fixable.md#version-skew) |
| 主题 / 模型 / MCP 配置全丢了 | 可 恢复 patch 层 | [看这条](docs/fixable.md#patch) |
| 某个会话打不开 / 每轮报错 | 只报告 | [看这条](docs/fixable.md#session) |
| credentials / PATH / 崩溃日志 / 逃生地址失效 | 只报告 | [看这条](docs/fixable.md#credentials) |

> 完整清单（含"不负责的花屏/蓝屏"边界）：**[docs/fixable.md](docs/fixable.md)**

## 文档

| | |
|---|---|
| [UPDATES.md](UPDATES.md) | **更新记录**：每个版本带来了什么，以及怎么更新 |
| [HANDOFF.md](HANDOFF.md) | **交接文档**：给接手的人/Agent，专项清单 + 架构 + 发布手册 + 已知风险 |
| [docs/fixable.md](docs/fixable.md) | **修复清单**：按症状列出能修 / 只查，以及根因 |
| [docs/baseline.md](docs/baseline.md) | **环境差异报告**：和标准 DSH 比，差在哪、怎么提交 |
| [docs/catalog.md](docs/catalog.md) | 修复目录：每条检查 / 备份位置 / 验证方式 |
| [docs/traps.md](docs/traps.md) | 踩雷清单 14 类，含根因与手工修复 |
| [docs/protocol.md](docs/protocol.md) | 社区检查包协议（写 JSON 就能加检查） |
| [doctor-sys/README.md](doctor-sys/README.md) | **Rust 原语引擎**：协议、15 个原语、实测出来的 Windows 硬规则 |
| [docs/design.md](docs/design.md) | 架构、版本无关性、通知与逃生设计 |
| [bugs/](bugs/README.md) | **Bug 图鉴**：遇到过的问题 + 根因 + 修法 + 验证 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 参与贡献：怎么提 bug、写检查包、提 PR |
| [CHANGELOG.md](CHANGELOG.md) | 技术变更明细 |

## 安全

- 默认只读；每个修复先备份、改完复检，失败自动还原；
- 没有 shell 通道：检查包只能声明「检测原语 + 内置修复 id」；
- 不碰 DSH 安装目录、不注册服务/驱动；改动均可回滚；
- **报告自动脱敏**：用户名 / 主机名 / 邮箱 / 用户主目录替换为 `user`、`<machine>`、`user@example.com`，可以直接提交 issue 或发给 AI。

## 参与贡献

踩到新坑就是最好的贡献：按 [CONTRIBUTING.md](CONTRIBUTING.md) 把症状、复现步骤、现场证据写进 [bugs/](bugs/)，或者写一个 JSON 检查包丢进 `examples/checks/`。

桌面端报废时也能贡献——`dsh-doctor.exe diff` 生成的报告已脱敏，直接贴进 issue 即可。

## License

[MIT](LICENSE) · 贡献按 MIT 授权 · 非官方项目，与深度求索无关
