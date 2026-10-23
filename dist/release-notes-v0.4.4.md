## 点一下修复。

DSH 桌面端把你桌面图标搞白了、整桌闪了、插件把会话炸了？点一下。

### 下载

| 文件 | 说明 |
|---|---|
| `dsh-doctor.exe` | **急救箱**，约 261 KB，自包含：不需要 DSH、不需要 Node、不需要联网。双击进菜单：体检 / 修桌面图标 / 移除危险工作区 / 隔离宿主包副本 / 恢复 patch 层 / 从备份回滚 / 起网页版逃生 |

插件版：把本仓库 `plugin/` 安装成 DSH bundle 即可（`plugin_manager install_bundle → target: <repo>/plugin`）。

### 本版内容

- **面板美化**：带 Logo 的标题区、状态统计胶囊、按严重度着色的卡片、空状态与修复录
- **README 重写**：居中 Logo + 口号 + 徽章 + 目录 + emoji 分节
- 跨平台（Windows / macOS / Linux）、通知由页面发出（归因显示为 DeepSeek Harness）
- 逃生复用 + 带 token 打开 + 桌面交接报告
- 安全边界：默认只读、每个修复先备份再复检、没有 shell 通道

### 已知边界

- 桌面 ACL / 完整性标签是 Windows 专属；macOS / Linux 只做路径类检查与通知
- 真·"DSH 瘫痪时喊人"还需要外部守护进程（v0.5 计划）

完整清单：[docs/catalog.md](https://github.com/jincheng3870682453-hash/dsh-doctor/blob/main/docs/catalog.md) · 踩雷清单：[docs/traps.md](https://github.com/jincheng3870682453-hash/dsh-doctor/blob/main/docs/traps.md)
