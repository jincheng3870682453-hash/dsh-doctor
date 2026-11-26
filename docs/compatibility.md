# 三套实现的能力矩阵

> 插件与 Node CLI 共用 JS 扫描器；Windows 急救 EXE 使用 PowerShell；`doctor-sys.exe` 同时提供 15 个系统原语和覆盖较少的原生扫描/修复。三者共享 finding / fix id 的命名，但不是一份代码，也不是逐项等价的替代物。
> `支持` 表示有实现；是否已在当前机器验证见 CI 与发布验收，不能由表格推断所有环境都已实测。

## 1. 入口与运行时

| 入口 | 实现 | 适用 | 不包含 |
| --- | --- | --- | --- |
| 插件面板 | `plugin/lib/client.js` + `index.js` + worker | DSH 正常时的日常检查、修复、报告、自动巡检 | DSH 完全无法启动时不能依赖它 |
| Node CLI / MCP | 同一 JS 扫描器 | 自动化、跨平台文件与配置检查 | Windows ACL 需要引擎/PowerShell；无 Node 时不可用 |
| `dsh-doctor.exe` | C# 启动器 + PowerShell + 内嵌 Rust | Windows 急救、桌面/工作区 ACL、原生独立报告 | JS 面板、社区检查包、JS 独有的修复类型 |
| `dsh-doctor-native.exe` | 同一 Rust 二进制的另一个文件名 | 有限的原生检查和底层原语 | 不是完整 JS/PS 扫描器的替代品，不作为公开 Release 资产 |
| Unix 包 / Windows 环境包 | Node CLI + 同一 JS 核心 + worker | 文件、工作区、凭据等 JS 检查 | Windows 环境包另有引擎；Unix 不包含 Windows 引擎 |

## 2. 检查覆盖

| 功能族 | 主要 finding id | JS | PowerShell / EXE | Rust 原生 CLI |
| --- | --- | --- | --- | --- |
| 桌面 ACL | `desktop-low-label`、`desktop-everyone-deny`、不可读 | 支持 | 支持 | 支持 Low / deny；不可读时跳过 |
| 工作区 ACL 与可授权性 | `workspace-low-label`、`workspace-everyone-deny`、`workspace-not-grantable` | 支持 | 支持标签 / deny；无独立 grantable 检查 | 不支持 |
| 工作区注册 | `workspace-risky-path`、`workspace-missing`、`workspace-not-writable` | 支持 | 支持风险 / 缺失；写探针在修复时 | 仅风险路径；使用 JSON 字符串启发式扫描 |
| 桌面会话活动 | `desktop-workspace-session` | 支持 | 支持 | 不支持 |
| 宿主包与链接 | `profile-host-duplicate`、`profile-host-link` | 支持副本 | 支持副本与 reparse point | 仅常见 profile 布局的副本 |
| Profile / 插件清单 | `profile-entry-locked`、`bundle-identity-drift` | 支持 | 支持锁定目录；清单源码模式检查不同 | 不支持 |
| 启动与 MCP | `plugin-boot-failure`、`plugin-service-pending`、`mcp-entry-broken` | 支持 | 支持 | 不支持 |
| 会话格式 | `session-legacy-kind` | zstd 可用时只读检查 | 不支持，保留给 JS | 不支持 |
| Patch 层 | `patch-layer-missing` | 支持 | 支持 | 仅空文件且有备份 |
| 凭据 | `credentials-version`、`credentials-no-version`、`credential-record-bloat` | 支持 | 支持 | 不支持 |
| Electron cookie | `electron-cookie-bloat` | 检查体积；清理走 EXE | 检查与 `clear-cookies` | 不支持 |
| PATH | `path-dead-dsh` | 支持 | 支持 | 支持 |
| 状态文件 | `stale-home-backup`、`storage-corrupt` | 支持 | 支持 | 不支持 |
| 会话权限 | `permission-too-broad` | 支持 | 支持 | 支持递归 JSON 投影扫描 |
| 插件版本与运行时 | `bundle-version-skew`、`runtime-metadata-stale` | 支持 | 支持 | 不支持 |
| 僵尸进程 / 逃生登记 | `zombie-dsh-process`、`rescue-instance-dead` | 支持 | 由菜单与逃生流程处理 | 提供进程/端口原语，无对应 finding |
| 崩溃日志 | `desktop-crash-logs` | 支持 | 支持 | 支持 |

## 3. 修复覆盖与恢复语义

| 修复 id | JS | PowerShell / EXE | Rust 原生 CLI |
| --- | --- | --- | --- |
| `desktop-label` | 完整 SDDL 优先，失败尝试恢复并逐字复检 | `icacls` 备份、失败回滚、Low/deny 复检 | 直接修改，不具备 JS 的完整事务语义 |
| `workspace-label` | 与桌面共用 ACL 链 | 与桌面共用 ACL 链 | 不支持 |
| `workspace-entry` | 优先 DSH 服务；文件兜底备份、原子写、重读验证 | 备份、结构删除、写后校验 | 明确未实现 |
| `create-workspace-dir` | 创建缺失目录 | 同 ID；旧 `workspace-create` 保留兼容别名 | 不支持 |
| `profile-host-dup` | 按来源保存，多 profile 不冲突，复检与回滚 | 按 profile 保存，复检 | 按 profile 隔离，无同等事务保证 |
| `restore-patch-layer` | 备份原内容、逐字复检、失败恢复 | 恢复所选备份并复检 | 有限恢复，无同等保证 |
| `workspace-acl` | 备份、授权、写探针、失败恢复 | 通过工作区标签/授权流程处理，无独立同 ID | 不支持 |
| `compact-credentials` | 备份、去重、回读、失败恢复 | 不支持 | 不支持 |
| `permission-too-broad` | 备份日志和缓存、追加事件、回读、失败恢复；需 Node zstd | 只报告 | 只报告 |
| `clear-cookies` | 只报告体积并指引 EXE | 先确认指定 DSH 进程已退出，备份后删除 | 不支持 |
| `reap-zombies` | 复核进程命令行与端口后停止，**不可回滚** | 不支持独立 ID | 提供 `proc-kill-tree` 原语，**不可回滚** |
| `refresh-shell` | 发送 Explorer 刷新通知，**不可回滚** | ACL 修复后可结束 Explorer，**不可回滚** | 提供 `shell-refresh` 原语 |

## 4. 共同边界

- **不能自动修的就不猜**：旧会话格式、credentials 版本、PATH、崩溃日志等以证据为主。
- **备份失败不能继续改**：ACL 和文件类修复应 fail-closed；批量项目如实报告部分成功，不宣称全批事务。
- **进程/外壳操作不属于可回滚文件事务**。
- **报告脱敏不是万能隐私清理**：只替换用户名、主机名、用户目录和邮箱；其他路径、token、Cookie 等必须人工检查。
- **社区检查包只运行在 JS 插件/CLI**：不注入 PowerShell 或 Rust 原生扫描器。
- **原生 15 原语与原生检查表是两件事**：不能用原生 CLI 的检查覆盖少来否认底层原语能力，也不能反过来声称完整覆盖。

新增功能必须更新本表、`docs/catalog.md`（JS 修复）、CLI/MCP 清单及相应测试；如只在某一侧实现，明确标注，不再默认“两边都已同步”。
