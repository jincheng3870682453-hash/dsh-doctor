# DSH Doctor · DSH 私人医生

<div align="center">

<img src="assets/logo.svg" width="96" alt="DSH 私人医生" />

### 只要是 DSH 引起的毛病，无论什么奇葩症状，我都能治好。

**点一下修复。** DSH Doctor：不仅是修复工具，更是 DSH 桌面端的**底层运行时急救箱**——专治标签损坏 / 进程失控导致的图标变白、屏闪、白屏与启动崩溃。

[**更新记录**](UPDATES.md) · [参与贡献](CONTRIBUTING.md) · [Bug 图鉴](bugs/README.md) · [修复清单](docs/fixable.md)

[![Version](https://img.shields.io/badge/Version-0.9.0-4D6BFE)](https://github.com/jincheng3870682453-hash/dsh-doctor/releases)
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

**插件（推荐）**：下载 Release 里的 `dsh-doctor-plugin.zip`，解压到固定目录后装成 DSH bundle（这样仓库挪动/删除都不会把插件弄坏）：

```text
plugin_manager  install_bundle  target: <解压目录>
```

也可以直接用仓库里的 `plugin/`（开发用，`link:` 安装，**移动仓库会导致插件失效**）。

**发行包**：[Releases](https://github.com/jincheng3870682453-hash/dsh-doctor/releases) 里按平台取——Windows `dsh-doctor.exe`（自包含，双击即用）；Linux / macOS `dsh-doctor-unix.tar.gz`（需要 Node ≥18）。

**没有 Node 环境？** 用 `dsh-doctor-env-win-x64.zip`：**自带 node.exe**，不需要另外装 Node、也不需要 DSH 能启动——解压后双击 `start.cmd` 即可。

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
| [docs/fixable.md](docs/fixable.md) | **修复清单**：按症状列出能修 / 只查，以及根因 |
| [docs/baseline.md](docs/baseline.md) | **环境差异报告**：和标准 DSH 比，差在哪、怎么提交 |
| [docs/catalog.md](docs/catalog.md) | 修复目录：每条检查 / 备份位置 / 验证方式 |
| [docs/traps.md](docs/traps.md) | 踩雷清单 14 类，含根因与手工修复 |
| [docs/protocol.md](docs/protocol.md) | 社区检查包协议（写 JSON 就能加检查） |
| [docs/design.md](docs/design.md) | 架构、版本无关性、通知与逃生设计 |
| [bugs/](bugs/README.md) | **Bug 图鉴**：遇到过的问题 + 根因 + 修法 + 验证 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 参与贡献：怎么提 bug、写检查包、提 PR |
| [CHANGELOG.md](CHANGELOG.md) | 技术变更明细 |

## 安全

- 默认只读；每个修复先备份、改完复检，失败自动还原；
- 没有 shell 通道：检查包只能声明「检测原语 + 内置修复 id」；
- 不碰 DSH 安装目录、不注册服务/驱动；改动均可回滚。

## 参与贡献

踩到新坑就是最好的贡献：按 [CONTRIBUTING.md](CONTRIBUTING.md) 把症状、复现步骤、现场证据写进 [bugs/](bugs/)，或者写一个 JSON 检查包丢进 `examples/checks/`。

## License

MIT · 非官方项目，与深度求索无关
