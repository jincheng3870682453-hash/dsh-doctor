## 点一下修复。

DSH 桌面端把你桌面图标搞白了、整桌闪了、插件把会话炸了？点一下。

### 下载

| 平台 | 文件 | 用法 |
|---|---|---|
| **Windows** | `dsh-doctor.exe` | 双击运行（自包含：不需要 DSH / Node / 联网） |
| **Linux** | `dsh-doctor-unix.tar.gz` | `tar xzf dsh-doctor-unix.tar.gz && sh dsh-doctor.sh` |
| **macOS** | `dsh-doctor-unix.tar.gz` | 解压后双击 `dsh-doctor.command`（首次需要 `chmod +x dsh-doctor.command`） |

> Linux / macOS 版需要 Node.js ≥18（DSH 自带一个）。最推荐的其实是**插件面板**：能力最全。

### 菜单

体检 / 修桌面图标 / 移除危险工作区 / 隔离宿主包副本 / 恢复 patch 层 / 从备份回滚 / 起网页版逃生。

命令行也可以：

```bash
node dsh-doctor.mjs scan
node dsh-doctor.mjs fix workspace-entry
node dsh-doctor.mjs history
node dsh-doctor.mjs rescue
```

### 本版内容

- **三平台发行包**：Windows EXE、Linux sh、macOS command，共用同一份核心逻辑
- 面板美化：Logo + 口号「点一下修复。」、状态胶囊、按严重度着色的卡片
- 跨平台核心：Windows 走 PowerShell，macOS/Linux 走 `/bin/sh`；通知由页面发出（归因 DSH）

### 已知边界

- 桌面 ACL / 完整性标签是 Windows 专属问题；macOS / Linux 只做路径类检查与通知
- "DSH 瘫痪时喊人"还需要外部守护进程（v0.6 计划）
- macOS / Linux 产物未在真机验证过，遇到问题请贴报错

完整清单：[docs/catalog.md](https://github.com/jincheng3870682453-hash/dsh-doctor/blob/main/docs/catalog.md) · 踩雷清单：[docs/traps.md](https://github.com/jincheng3870682453-hash/dsh-doctor/blob/main/docs/traps.md)
