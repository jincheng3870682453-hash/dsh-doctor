# 08 · 发行包与启动器（自伤 bug 合集）

## 症状 / 根因 / 修法

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| 1 | 发行包里 CLI 一跑就 `SyntaxError: Named export ... not found` | 只拷了 `plugin/lib/index.js`，脱离 `plugin/package.json` 的 `"type":"module"` 后被当 CommonJS | 发行包一律用 `index.mjs`（v0.6.2） |
| 2 | 环境包双击 `启动.cmd` 闪退/乱码 | `.cmd` 带 UTF-8 BOM，`cmd.exe` 把 BOM 当命令的一部分；中文文件名也可能出问题 | 改无 BOM 的 `start.cmd`（v0.8.1） |
| 3 | 更新检查永远提示"有新版本" | 发行包没带 `plugin/package.json`，版本读成 `0.0.0` | 三个包都带 `package.json`（v0.8.1） |
| 4 | 插件是 `link:` 安装，仓库一挪就坏 | 安装指向本地目录（`D:\新建文件夹\...\plugin`） | 新增 `dsh-doctor-plugin.zip`，解压后 `install_bundle` 指向解压目录（v0.9.0） |
| 5 | 插件加载器报 `Unexpected token '\uFEFF'` | 我方脚本用 `Set-Content -Encoding UTF8` 改 `package.json`，写进了 BOM | 统一用 .NET `WriteAllText(..., UTF8NoBOM)`（v0.4.3） |

## 教训

- 含中文/非 ASCII 的源码，**永远用 `[IO.File]::ReadAllText/WriteAllText` + `UTF8Encoding($false)`**，不要用 `Get-Content/Set-Content`；
- 打包产物必须**在 CI 里真跑一次**，否则这些坑全是用户先踩。
