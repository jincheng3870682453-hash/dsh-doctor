# 12 · 登录 cookie 记录累积，约 72 次启动后 DSH 永久打不开

## 症状

- 同一份配置，正常用了 30 天、启动约 72 次之后，DSH 突然**永久打不开**；
- 重装 DSH 无效（坏的是用户目录里的状态）；
- 用户自己的排查结论：**每次启动都会多存一条登录 cookie**。

## 根因（待现场日志最终确认）

登录凭据存在 `~/.dsh/.credentials.yaml` 的 `records` 映射里。如果每次启动/续期都**追加**一条登录 grant，会出现两种后果：

1. `records` 越来越大（几十上百条）→ host 启动时加载凭据变慢/失败；
2. 更容易踩的是**同一 key 被重复写入**（例如 `client-connection/browser-session`）→ 严格 YAML 解析器遇到重复 key 直接报错 → `dsh-credentials-local` 加载失败 → host 起不来。

Electron 的 cookie 库（`%APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies`）也可能随启动累积，极端情况下同样拖慢/破坏登录。

## 医生怎么认

- **`credential-record-bloat`**（v0.14.3，JS + PS 双端）：
  - records 里出现**重复 key** → 高危；
  - records 条目 ≥ 40 或文件 > 200 KB → 高危；
  - 条目 ≥ 15 / 文件 > 80 KB / cookie 库 > 512 KB → 提醒；
  - cookie 库 > 1 MB 时额外一条 `electron-cookie-bloat`（关闭 DSH 后清理）。

## 修法

1. 面板/EXE 里点「一键修复」（`compact-credentials`）：
   - 先备份 `credentials-<时间>.yaml`；
   - 只保留每个 key 的**最新一条** records；
   - DSH 会自动重载凭据。
2. 如果仍然打不开：备份并删除 `~/.dsh/.credentials.yaml`，重新登录（历史 API Key 会丢，可从备份拷回 `refs`）。
3. cookie 库过大：**完全关闭 DSH**，备份后删除 `Network\Cookies`，重新启动并登录。

## 验证

```powershell
node tools/cli.mjs scan            # 应能看到 credential-record-bloat
dsh-doctor.exe scan
# 修复后
node tools/cli.mjs scan            # 该条应消失
```

## 对应

- 检查：`credential-record-bloat`
- 修复：`compact-credentials`
- 版本：v0.14.3
