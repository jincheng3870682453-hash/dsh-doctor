# DSH Doctor · DSH 私人医生

<div align="center">

<img src="assets/logo.svg" width="96" alt="DSH 私人医生" />

### 点一下修复。

**DSH 桌面端把图标搞白了、整桌闪了、插件把会话炸了？点一下。**

[![Version](https://img.shields.io/badge/Version-0.5.2-4D6BFE)](https://github.com/jincheng3870682453-hash/dsh-doctor/releases)
[![Release](https://img.shields.io/github/v/release/jincheng3870682453-hash/dsh-doctor?label=Download&color=4D6BFE)](https://github.com/jincheng3870682453-hash/dsh-doctor/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/jincheng3870682453-hash/dsh-doctor/ci.yml?label=CI&logo=github&color=4D6BFE)](https://github.com/jincheng3870682453-hash/dsh-doctor/actions)
[![License](https://img.shields.io/badge/License-MIT-4D6BFE)](LICENSE)

</div>

---

## 它做什么

DSH 会在供给工作区时给目录盖上「低完整性标签 + 拒绝项」且从不回收——桌面被当成工作区，图标就全变白，而且修完还会复发。医生做的事：

- **查**：体检 10 项状态，每条带路径与原始证据，默认只读；
- **修**：4 个动作一键执行，**先备份 → 改最小 → 立刻复检**，失败就还原；
- **报**：一键生成**给 AI 的求助报告**（带提示词约束），复制发给任何 AI，或保存到桌面留档；
- **逃**：实在修不好，生成桌面交接报告 + 起隔离端口的网页版，让网页版 DSH 接手。

## 安装

**插件（推荐）**：把本仓库 `plugin/` 装成 DSH bundle，侧边栏出现「私人医生」，平时无感，有问题才亮红点。

```text
plugin_manager  install_bundle  target: <本仓库路径>/plugin
```

**发行包**：[Releases](https://github.com/jincheng3870682453-hash/dsh-doctor/releases) 里按平台取——Windows `dsh-doctor.exe`（自包含，双击即用）；Linux / macOS `dsh-doctor-unix.tar.gz`（需要 Node ≥18）。

**没有 Node 环境？** 用 `dsh-doctor-env-win-x64.zip`：**自带 node.exe**，不需要另外装 Node、也不需要 DSH 能启动——解压后双击「启动.cmd」即可。

```bash
node dsh-doctor.mjs scan        # 只读体检
node dsh-doctor.mjs fix workspace-entry
```

## 能修什么

| 检查 | 现象 | 一键修 |
|---|---|---|
| 桌面 Low 完整性标签 | 图标变白纸 | ✅ |
| 工作区注册在桌面 | 白图标反复复发 | ✅ |
| profile 宿主包副本 | `reading 'prepare'` | ✅ |
| `cordis.patch.yml` 被清空 | 主题/模型/provider 全没了 | ✅ |
| 会话把桌面当工作区 | 整桌闪 | 提示 |
| 老会话 `kind:"plugin"` | 会话打不开 | 只报告 |
| credentials / PATH / 崩溃日志 / 逃生实例失效 | 起不来、命令不工作 | 只报告 |

## 文档

| | |
|---|---|
| [docs/catalog.md](docs/catalog.md) | 修复目录：每条检查 / 备份位置 / 验证方式 |
| [docs/traps.md](docs/traps.md) | 踩雷清单 14 类，含根因与手工修复 |
| [docs/protocol.md](docs/protocol.md) | 社区检查包协议（写 JSON 就能加检查） |
| [docs/design.md](docs/design.md) | 架构、版本无关性、通知与逃生设计 |
| [CHANGELOG.md](CHANGELOG.md) | 版本记录 |

## 安全

- 默认只读；每个修复先备份、改完复检，失败自动还原；
- 没有 shell 通道：检查包只能声明「检测原语 + 内置修复 id」；
- 不碰 DSH 安装目录、不注册服务/驱动；改动均可回滚。

## License

MIT · 非官方项目，与深度求索无关
