# Bug 图鉴

记录我们遇到过、且已经定位/修复的问题。每个条目写清：**症状、根因、修法、验证方式、对应提交**。

## 已确认（有现场证据）

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

## 疑似待验证（排雷线索，不当结论用）

| 编号 | 问题 | 状态 |
|---|---|---|
| [U1](unverified.md#u1-第三方客户端插件包名--模块-id会静默消失) | 第三方插件包名 ≠ 模块 id → UI 静默消失 | 半验证 |
| [U2](unverified.md#u2-复用-shipped-插槽-id-会被覆盖而不是追加) | 复用官方插槽 id 会被覆盖而非追加 | 疑似 |
| [U3](unverified.md#u3-新版本插件把宿主包副本带回来schemastery-等) | 升级插件把宿主包副本带回来 | 半验证 |
| [U4](unverified.md#u4-runtimejson-过期误导版本判断) | runtime.json 过期误导版本判断 | 已验证（只报告） |
| [U5](unverified.md#u5-从-npm-安装后桌面端不会自动启用) | npm install 后不会自动启用 | 待现场 |
| [U6](unverified.md#u6-macos--linux-发行包未实机验证) | macOS / Linux 包未实机验证 | 待现场 |
| [U7](unverified.md#u7-逃生锁-2-分钟过期-vs-npx-首次下载-3-分钟) | 逃生锁过期时间与 npx 下载竞态 | 疑似 |
| [U8](unverified.md#u8-entry-customization创建你的插件缺-creator-预设会失败) | 缺 Creator 预设时"创建你的插件"失败 | 疑似 |
| [U9](unverified.md#u9-view-的-pin-只在内存重载后丢失) | View 的 pin 只在内存 | 疑似（官方行为） |
| [U10](unverified.md#u10-more-菜单在桌面端会上报埋点) | More 菜单上报埋点 | 疑似（隐私） |
| [U11](unverified.md#u11-bundle-identity-drift-只扫-client-文件前-4kb) | `bundle-identity-drift` 只扫前 4KB | 已知局限 |
| [U12](unverified.md#u12-runtime-metadata-stale-依赖-asar-路径) | `runtime-metadata-stale` 依赖 asar 路径 | 已知局限 |
| [U13](unverified.md#u13-权限过宽danger-full-access--approval-never导致误删文件) | 权限过宽导致误删文件 | 半验证 |

> 判断标准：**"DSH 引起"** = 不装医生就会中招；**"自伤 bug"** = 医生自己写出来的坑，修复后通常还会写进 CI 防止复发。
> 疑似条目验证通过后请移进上面的正式表；没复现就别当结论用。
