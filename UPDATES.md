# 更新记录

> 每个版本一句话说清"给你带来了什么"。详细技术变更见 [CHANGELOG.md](CHANGELOG.md)，安装包见 [Releases](https://github.com/jincheng3870682453-hash/dsh-doctor/releases)。

---

## v0.10.2 — 2026-10-24

- **新增「桌面端报废时怎么办」说明**：DSH 完全起不来时，插件用不了，但 `dsh-doctor.exe` 照常可用——不依赖 DSH、不依赖 Node、不联网，双击就能体检 / 修图标 / 生成环境差异报告。
- **去掉写死的安装路径**：不再假设 DSH 装在某个盘；改为查常见安装目录 + 从正在运行的桌面端进程反查，装在哪个盘都能识别。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.10.2)

## v0.10.1 — 2026-10-24

- **报告自动脱敏**：所有对外报告（求助报告、环境差异报告、逃生交接）里的用户名、主机名、邮箱、用户主目录自动替换成 `user` / `<machine>` / `user@example.com`，目录结构保留。可以直接提 issue、贴给 AI，不用手动改。
- 连"写文件失败"的提示文字也脱敏，避免顺手把路径漏出去。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.10.1)

## v0.10.0 — 2026-10-24

- 新增**环境差异报告**：把本机 DSH 和标准基线逐项对比（工作区、profile 依赖、宿主包副本、桌面完整性、崩溃日志），差异 + 后端报错写成一个 MD 到桌面，可直接提 issue/PR。
- 三个入口都有：插件页脚「环境差异报告」、`node dsh-doctor.mjs diff`、`dsh-doctor.exe diff`（不需要 Node）。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.10.0)

## v0.9.0 — 2026-10-24

- 体检移到后台线程，不再卡 DSH 界面（有缓存，面板秒开）。
- 自动巡检与手动修复加互斥锁，不会互相覆盖。
- 新增**插件包** `dsh-doctor-plugin.zip`：解压安装，仓库挪动也不会坏。
- 网页版逃生交接报告升级：问题清单已排好序，直接丢给 AI 就能接着修。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.9.0)

## v0.8.1 — 2026-10-24

- 自查修掉 5 个隐患：发行包版本文件缺失、环境包 `.cmd` 带 BOM、自动巡检与 DSH 反复拉扯、僵尸进程可能误杀、写探针残留垃圾。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.8.1)

## v0.8.0 — 2026-10-24

- 面板新增**检查更新**按钮，可一键打开下载页。
- 去掉全部 emoji 图标，文档与输出更干净。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.8.0)

## v0.7.0 — 2026-10-24

- **后台自动巡检**：桌面标签被 DSH 偷偷降级，30 秒内自动拉回并刷新图标。
- **僵尸进程回收**：清理"端口已死、进程还挂"的残余实例。
- 文案升级为「底层运行时急救箱」。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.7.0)

## v0.6.3 — 2026-10-24

- 新标语：「只要是 DSH 引起的毛病，无论什么奇葩症状，我都能治好。」
- 新增 [修复清单](docs/fixable.md)：按"你看到的现象"列出能修什么。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.6.3)

## v0.6.2 — 2026-10-24

- 修掉 CI 抓到的打包 bug：发行包核心文件统一为 `.mjs`，避免被当成 CommonJS 加载。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.6.2)

## v0.6.1 — 2026-10-24

- 新增 **Windows 环境包**（自带 node.exe），连 Node 都没装也能用。
- 逃生反馈更明确：等 3 分钟、失败说清原因、地址写到桌面。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.6.1)

## v0.6.0 — 2026-10-23

- 一键生成**给 AI 的求助报告**（带提示词约束），复制或保存都行。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.6.0)

## v0.5.3 — 2026-10-23

- 补上盲区：检查工作区是否可写、DSH 是否能给它授权（`grantWrite` 那类问题）。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.5.3)

## v0.5.2 — 2026-10-23

- 插件图标统一成品牌 Logo；介绍文件大幅精简。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.5.2)

## v0.5.1 — 2026-10-23

- 编译与测试全部上云：三系统冒烟、集成修复测试、30 次压力扫描。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.5.1)

## v0.5.0 — 2026-10-23

- 三平台发行包：Windows EXE、Linux sh、macOS command。

[下载](https://github.com/jincheng3870682453-hash/dsh-doctor/releases/tag/v0.5.0)

## v0.4.x — 2026-10-23

- v0.4.4 通知改由页面发出（来源显示为 DSH，不再是 PowerShell）。
- v0.4.3 逃生实例复用、带 token 打开、日志落盘。
- v0.4.2 结果提示改为页面内横幅，不遮挡窗口按钮。
- v0.4.1 网页版改为"最后一招"，启动前生成桌面交接报告。
- v0.4.0 核心跨平台（Windows / macOS / Linux）。

## v0.3.0 — 2026-10-23

- 修复录、网页版逃生、常驻守护脚本、MCP 面、修复目录。

## v0.2.0 — 2026-10-23

- 社区检查包协议 v1（写 JSON 就能加检查）；工作区修复改走 DSH 自己的服务。

## v0.1.0 — 2026-10-23

- 首版：检测器 + 一键修复 + 侧边栏面板。

---

## 怎么更新

| 你的安装方式 | 更新方法 |
|---|---|
| 插件（zip 安装） | 下载新 `dsh-doctor-plugin.zip`，解压覆盖，重启 DSH |
| 插件（本仓库 link） | `git pull` 后重启 DSH |
| Windows EXE / 环境包 / Unix 包 | 下载新版本替换即可（无需卸载） |

面板右上角「检查更新」可以直接看有没有新版并打开下载页。
