# 12 · 每次启动多存一条登录 cookie，约 70 次后 DSH 永久打不开

> 来源：B站视频《DeepSeek Harness 打不开（Web authentication failed）…》（BV1rNxB6CE4G，牧羊人AILab，2026-10-30）及其评论区的实测确认。

## 症状

- 同一份配置正常用大约一个月后，DSH 突然启动失败：`Web authentication failed` / `应用无法启动或已意外停止`；
- 删 DSH、重装、换 profile 都没用；
- 出问题前往往已经启动过 **约 70 次**。

## 根因

1. DSH 桌面端**每次启动都会换一个 Web 端口**；
2. 每个端口对应一条新的 **host 登录 cookie**，写进 Electron 的 cookie 库：
   `%APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies`；
3. 旧 cookie **从来不删**，随启动次数线性累积；
4. 攒到约 70 条后，请求头（Cookie header）超过上限 → HTTP **431 Request Header Fields Too Large** → 鉴权失败 → 进不去。

视频弹幕/评论原话："每次启动换端口就多存一条，攒满就 431。删掉 `Network` 下的 `Cookies` 和 `Cookies-journal` 就好。"

## 医生怎么认

- **`electron-cookie-bloat`**（v0.14.4，插件 + EXE）：
  - cookie 库 > 64 KB → 高危；
  - > 32 KB → 提醒；
  - 说明里直接给 431 机制和清理步骤。
- 附带 `credential-record-bloat`：`~/.dsh/.credentials.yaml` 的 records 累积/重复 key 同类问题（另一条独立的启动失败路径）。

## 怎么修

1. **完全退出 DSH**（托盘也退出）；
2. 备份并删除：
   ```
   %APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies
   %APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies-journal
   ```
   （下次启动会重建；只需要重新登录一次）
3. 或用 EXE：`dsh-doctor.exe clear-cookies` / 菜单 `10`（会先检查 DSH 是否已退出，并自动备份到 `~/.dsh/dsh-doctor-backups/cookies-<时间>/`）。

## 预防

- 每 1~2 个月清理一次 cookie 库（或等医生报 `electron-cookie-bloat`）；
- 官方修复前，这是唯一能避免"用一个月就永久打不开"的办法。

## 对应

- 检查：`electron-cookie-bloat`、`credential-record-bloat`
- 修复：`clear-cookies`（EXE）、`compact-credentials`
- 版本：v0.14.4
