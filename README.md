# DSH Doctor · DSH 私人医生

<div align="center">

<img src="assets/logo.svg" width="96" alt="DSH 私人医生" />

### 只要是 DSH 引起的毛病，无论什么奇葩症状，我都能治好。

**点一下修复。**

[更新记录](UPDATES.md) · [Bug 图鉴](bugs/README.md) · [**贡献者清单**](CONTRIBUTORS.md) · [参与贡献](CONTRIBUTING.md)

[![Version](https://img.shields.io/badge/Version-0.13.10-4D6BFE)](https://github.com/jincheng3870682453-hash/dsh-doctor/releases)
[![npm](https://img.shields.io/npm/v/dsh-doctor-plugin?label=npm&color=4D6BFE)](https://www.npmjs.com/package/dsh-doctor-plugin)
[![Release](https://img.shields.io/github/v/release/jincheng3870682453-hash/dsh-doctor?label=Download&color=4D6BFE)](https://github.com/jincheng3870682453-hash/dsh-doctor/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/jincheng3870682453-hash/dsh-doctor/ci.yml?label=CI&logo=github&color=4D6BFE)](https://github.com/jincheng3870682453-hash/dsh-doctor/actions)
[![License](https://img.shields.io/badge/License-MIT-4D6BFE)](LICENSE)

</div>

---

## 你的 DSH 已经坏了？先拿急救包

**不用看报错、不用装环境、不用联网。** 直接下载对应安装包，双击当急救箱用：

| 你的系统 | 下载 | 怎么用 |
|---|---|---|
| Windows | **`dsh-doctor.exe`** | 双击 → 选 `1` 体检 / `2` 修桌面图标 / `8` 生成报告 |
| Windows，连 Node 都没装 | **`dsh-doctor-env-win-x64.zip`** | 解压 → 双击 `start.cmd` |
| Linux / macOS | **`dsh-doctor-unix.tar.gz`** | 解压 → `./dsh-doctor.sh`（需要 Node ≥18） |
| 想要纯二进制（不依赖 PowerShell） | **`dsh-doctor-native.exe`** | `scan` / `fix desktop-label`（Rust 原生，P1：8 项检查 + 3 个修复） |

它不依赖 DSH 能不能启动。生成的报告**已自动脱敏**，可以直接提 issue 或丢给任何 AI。

**[下载最新版](https://github.com/jincheng3870682453-hash/dsh-doctor/releases)** · [更新记录](UPDATES.md) · [提 issue](https://github.com/jincheng3870682453-hash/dsh-doctor/issues/new/choose)

> 写文件、改权限请**在桌面双击运行**；在 DSH 的沙箱终端里跑，写操作可能被限制（EXE 会打印报告并提示手动复制）。

## DSH 还能用？装成插件，平时自动巡检

- **应用内**：侧边栏 → 插件 → 添加，填 **`dsh-doctor-plugin`** → 安装
- **命令行**：`dsh plugin --profile <name> add dsh-doctor-plugin`
- **离线 / 本地目录**：下载 `dsh-doctor-plugin.zip` 解压，在「添加插件」里粘解压目录

> 别装 `dsh-doctor`——那是第三方的同名包。详细安装见 **[docs/install.md](docs/install.md)**。

## 它到底能干什么

- **查**：体检本机 DSH 状态，每条带路径和原始证据，默认只读；
- **修**：一键修复，**先备份 → 改最小 → 立刻复检**，失败自动还原；
- **守**：后台每 30 秒巡检桌面完整性标签，被 DSH 改坏就拉回来，不闪屏；
- **报**：一键生成给 AI / 给 issue 的脱敏报告（求助报告 + 环境差异报告）；
- **逃**：真修不好时，生成交接报告 + 起隔离端口的网页版 DSH 接手。

**它能治哪些症状？** 看 **[docs/fixable.md](docs/fixable.md)**——按"你看到的现象"排，每条给根因和对应修法。

## 文档

| | |
|---|---|
| [docs/install.md](docs/install.md) | 安装方式（npm / 本地 zip / 命令行 / AI）与桌面端限制 |
| [docs/recovery.md](docs/recovery.md) | **文件被 DSH 删了怎么救**：Git / 卷影 / 回收站 / 恢复软件 / 防复发 |
| [docs/fixable.md](docs/fixable.md) | 修复清单：按症状列出能修 / 只查，含根因 |
| [docs/traps.md](docs/traps.md) | 踩雷清单（16 类），含根因与手工修法 |
| [bugs/](bugs/README.md) | Bug 图鉴：已复现的问题 + [疑似未验证清单](bugs/unverified.md) |
| [UPDATES.md](UPDATES.md) | 更新记录：每个版本改了什么、怎么升级 |
| [HANDOFF.md](HANDOFF.md) | 交接文档：专项清单 + 架构 + 发布手册 + 已知风险 |
| [docs/baseline.md](docs/baseline.md) | 环境差异报告：和标准 DSH 比差在哪、怎么提交 |
| [docs/catalog.md](docs/catalog.md) | 修复目录：每条检查 / 备份位置 / 验证方式 |
| [docs/protocol.md](docs/protocol.md) | 社区检查包协议（写 JSON 就能加检查） |
| [doctor-sys/README.md](doctor-sys/README.md) | Rust 原语引擎：协议、15 个原语、Windows 硬规则 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 参与贡献：提 bug、写检查包、提 PR |
| [CHANGELOG.md](CHANGELOG.md) | 技术变更明细 |

## 贡献者清单

**[→ 贡献者清单（CONTRIBUTORS.md）](CONTRIBUTORS.md)**

谁报了什么坑、作者的处理节奏、怎么上榜，全部在这个独立文件里。

> 作者是学生：工作日要上课，issue / PR 一般集中在周末处理。

## 遇到问题 / 想贡献

- **遇到 bug**：[提 issue](https://github.com/jincheng3870682453-hash/dsh-doctor/issues/new/choose)。模板会要 DSH 版本、操作系统、**插件冲突**、**完整报错**、以及 `dsh-doctor.exe diff` 生成的**已脱敏诊断报告**。
- **想贡献**：踩到新坑就按 [CONTRIBUTING.md](CONTRIBUTING.md) 写进 [bugs/](bugs/README.md)；会写 JSON 就能加检查（[协议](docs/protocol.md)）。

## 安全

- 默认只读；每个修复先备份、改完复检，失败自动还原；
- 没有 shell 通道：检查包只能声明「检测原语 + 内置修复 id」；
- 不碰 DSH 安装目录、不注册服务/驱动；改动均可回滚；
- **报告自动脱敏**：用户名 / 主机名 / 邮箱 / 用户主目录替换为 `user`、`<machine>`、`user@example.com`。

## License

[MIT](LICENSE) · 非官方项目，与深度求索无关
