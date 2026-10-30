# 文件被 DSH 删了，怎么救

> 这一页不是"一键修复"。权限给太宽时，DSH 的删除**不经过回收站**，医生也变不回来。
> 但先做对顺序，能救回来的概率差很多。

## 0. 先停手

1. **暂停 DSH 会话**（别再让它执行任何命令）；
2. 不要往同一块盘写新文件（包括重装、下载、清理软件）——会覆盖待恢复数据；
3. 记下：大概什么时候、在哪个会话、删了什么路径。会话 ID 在侧边栏能看到，也可以看 `~/.dsh/sessions/` 目录名。

## 1. 先判断文件在哪一层

| 情况 | 恢复路径 |
|---|---|
| 文件在 **Git 仓库**里（已提交或已暂存） | 最简单：`git status` → `git restore <路径>` / `git checkout -- <路径>` |
| 文件曾在 Git 里但没提交（untracked） | Git 帮不了，走第 3/4 步 |
| 被 **Explorer/资源管理器**删的（进了回收站） | 回收站还原 |
| DSH 通过命令删的（`Remove-Item` / `fs.unlink` 等） | **不进回收站**，走第 3/4 步 |
| 有 **卷影副本 / 文件历史 / OneDrive 版本历史** | 优先从这里恢复，成功率最高 |

## 2. Git 恢复（最快）

```powershell
cd <项目目录>
git status                 # 看被删的文件在不在 deleted 列表
git restore -- <路径>       # 恢复工作区
# 如果已暂存删除：
git restore --staged --worktree -- <路径>
git checkout HEAD -- <路径>
```

没提交过的 untracked 文件 Git 里没有，直接跳第 3 步。

## 3. 卷影副本 / 文件历史 / 网盘

按成功率排序：

1. **卷影副本（VSS）**：`vssadmin list shadows` 看有没有快照；有的话用 `shadowexplorer` 之类挂载浏览复制。
2. **文件历史**（控制面板 → 文件历史记录）或 **Windows 备份**。
3. **OneDrive / 坚果云 / Dropbox**：网页版「版本历史」或「回收站」。
4. **Windows 回收站**：只对 Shell 删除有效；在回收站里找原路径。

## 4. 数据恢复软件（最后手段）

停止写入后，用恢复工具扫描原分区：

- Recuva（免费，够用）
- PhotoRec / TestDisk（开源，适合深层恢复）
- 商业工具（DiskGenius 等）

**不要**把恢复软件装到待恢复的盘上；扫描结果先恢复到**另一块盘**。

## 5. 从 DSH 侧找线索

DSH 可能留下痕迹，但**不保证含文件全文**：

| 位置 | 可能有的东西 |
|---|---|
| `~/.dsh/sessions/<workspace>/<session>/session*.jsonl.zstd` | 会话事件、工具调用记录（能看到"删了什么路径"） |
| `~/.dsh/storages/session_projcache.json` | 每个会话的权限与工作区快照 |
| `~/.dsh/storages/workspace.json` | 工作区列表（含历史路径） |
| 会话里的 `workspace changes` | 文件变更摘要，部分场景能还原 diff |

用医生的差异报告能把这些环境信息一次性导出（`dsh-doctor.exe diff`），但**它不含被删文件内容**。

## 6. 防复发（比恢复重要）

1. **权限改成 `workspace-write` + `ask`**：会话里 `/permission` 切换；新会话在设置里改默认。
2. **工作区不要选家目录 / 桌面 / 盘根**：单独建 `D:\projects\xxx` 这种目录，医生会报危险工作区。
3. **项目放 Git**：删了能 `git restore`，这是最便宜的快照。
4. **重要目录开文件历史 / 网盘同步**。
5. **让医生定期体检**：`permission-too-broad` 检查会直接列出开了 `danger-full-access` 的会话。
