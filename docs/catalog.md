# 修复目录 · Catalog

> 一张表看完：医生能查什么、能修什么、改之前备份到哪、改完怎么验证。
> 每一条都对应面板里的一个问题卡，或命令行里的一个 `-Id`。

## 一、检查项（只读）

| # | 检查 id | 检测原语 | 现象 | v |
| --- | --- | --- | --- | --- |
| 1 | `desktop-low-label` | `desktop-low-label` | 桌面所有快捷方式变白纸 | 0.1 |
| 2 | `desktop-everyone-deny` | `desktop-low-label`（同一 SDDL 判据） | 桌面残留「Everyone 拒绝删除」，挡住正常清理 | 0.1 |
| 3 | `workspace-risky-path` | `workspace-risky-path` | 工作区注册在桌面/用户目录/盘根 → 白图标反复复发 | 0.1 |
| 4 | `desktop-workspace-session` | `desktop-session-activity` | 有会话把桌面当工作区 → 整桌图标一起闪 | 0.1 |
| 5 | `profile-host-duplicate` | `profile-host-duplicate` | profile 里出现宿主包副本 → `reading 'prepare'` / `is incompatible with dsh` | 0.1 |
| 6 | `desktop-crash-logs` | `crash-logs` | 桌面端崩溃历史（renderer 崩溃常不带栈） | 0.1 |
| 7 | `session-legacy-kind` | `session-legacy-kind` | 老会话含 v4 拒收的 `kind:"plugin"` → 打开即报错 | 0.2 |
| 8 | `credentials-version` / `credentials-no-version` | `credentials-version` | credentials 版本缺失或不是 1 → host 起不来 | 0.2 |
| 9 | `patch-layer-missing` | `patch-layer-missing` | `cordis.patch.yml` 被崩溃自修复清空（有备份才算） | 0.2 |
| 10 | `path-dead-dsh` | `path-dead-dsh` | PATH 里的 `dsh` 指向不存在的文件 | 0.2 |
| 11 | `workspace-not-writable` | `workspace-not-writable` | 工作区真的写不进去（起不来 / grantWrite Win32 5） | 0.5.3 |
| 12 | `workspace-not-grantable` | `workspace-not-grantable` | Windows：owner 不是你且没有 WRITE_DAC，DSH 授不了沙箱权限 | 0.5.3 |

## 二、修复项（可回滚）

| # | 修复 id | 改什么 | 备份位置 | 验证方式 | 生效 |
| --- | --- | --- | --- | --- | --- |
| 1 | `desktop-label` | 桌面完整性标签 `Low → Medium`；摘掉 `Everyone` 删除拒绝项 | `~/.dsh/dsh-doctor-backups/desktop-acl-<ts>.txt`（`icacls /restore` 可还原） | 重读 SDDL，确认不再含 `S:(ML;;…;;;LW)` | 立即（图标自动恢复） |
| 2 | `workspace-entry` | 从工作区注册表移除桌面类危险路径 | 优先走 DSH `workspaceRegistry.delete()`；文件兜底时备份 `workspace.json.bak-<ts>` | 重新列出工作区，确认危险路径已消失 | 重启桌面端 |
| 3 | `profile-host-dup` | 把 profile 里的 `@deepseek-ai` 宿主包副本改名隔离 | 原名保留，加 `.stale-<ts>` 后缀即可改回 | 重新扫描，确认不再命中 | 重启桌面端 |
| 4 | `restore-patch-layer` | 从最近的 `cordis.patch.yml.bak-*` 恢复 patch 层 | 当前空文件另存 `.empty-<ts>` | 重读文件大小 > 0 | 重启桌面端 |
| 5 | `workspace-acl` | 给当前账号补工作区完全控制 | `~/.dsh/dsh-doctor-backups/workspace-acl-<ts>.txt`（`icacls /restore`） | 重新写测试文件成功 | 立即 |

## 三、只报告、不自动修（以及为什么）

| 问题 | 原因 |
| --- | --- |
| 老会话里的 `kind:"plugin"` | 改写会话文件出错会丢历史；v1 只给证据（文件路径），改写留人工或协议 v2 |
| credentials 版本 | 版本语义与构建绑定，猜错会把可用的配置改坏 |
| PATH 死路径 | 属于用户环境，自动删 PATH 有风险，只指出是哪一条 |
| 崩溃日志 | 只诊断，不上报、不删 |

## 四、每次修复会发生什么

```
点「一键修复」
  → 备份（失败则中止，不动原始状态）
  → 最小改动
  → 立刻复检（失败则还原并如实报错）
  → 追加一条「修复录」：时间 / 动作 / 结果 / 备份路径
  → 面板刷新，重新体检
```

修复录落在 `~/.dsh/dsh-doctor/history.jsonl`，面板底部可直接看最近 8 条，接口是 `GET /dsh-doctor/history`。

## 五、社区扩展

上面第 1、2 组里的检测原语和修复 id 都可以被社区检查包引用，写法见 [protocol.md](protocol.md)。
新增检查不需要改引擎；新增**修复动作**需要走代码评审（安全边界）。
