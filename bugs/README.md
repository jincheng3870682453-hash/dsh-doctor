# Bug 图鉴

记录我们遇到过、且已经定位/修复的问题。每个条目写清：**症状、根因、修法、验证方式、对应提交**。

| 编号 | 问题 | 类型 |
|---|---|---|
| [01](01-desktop-icons-white.md) | 桌面图标全变白纸 | DSH 引起 |
| [02](02-desktop-flicker.md) | 整桌图标一起闪 | DSH 引起 |
| [03](03-workspace-grant.md) | 工作区授不了权限 / 终端起不来 | DSH 引起 |
| [04](04-host-package-dup.md) | `reading 'prepare'` 与版本错配 | DSH 引起 |
| [05](05-session-format.md) | 会话打不开 / v4 格式拒收 | DSH 引起 |
| [06](06-patch-layer-wiped.md) | 主题 / 模型 / MCP 配置全丢 | DSH 引起 |
| [07](07-rescue-pitfalls.md) | 网页版逃生踩的坑 | 设计缺陷 |
| [08](08-packaging-and-launcher.md) | 发行包 / 启动器 | 自伤 bug |
| [09](09-auto-guard-and-processes.md) | 自动巡检 / 进程回收 | 自伤 bug |
| [10](10-notifications-and-update.md) | 通知归因 / 更新检查 | 自伤 bug |
| [11](11-bundle-identity-drift.md) | 改包名后图标/面板消失 | 自伤 bug |

> 判断标准：**"DSH 引起"** = 不装医生就会中招；**"自伤 bug"** = 医生自己写出来的坑，修复后通常还会写进 CI 防止复发。
