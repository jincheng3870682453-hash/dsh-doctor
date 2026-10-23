# 能修什么 · 修复清单

> **只要是 DSH 引起的毛病，无论什么奇葩症状，我都能治好。**
>
> 这张表按"你看到的现象"排。[可修] = 医生能一键修；[只查] = 只能查出来并告诉你下一步（自动改风险太高）。

---

<a id="auto-guard"></a>
## 白图标修完又被 DSH 偷偷改回去

- **你会看到**：手动修好了，过一会儿 / 换个会话又白。
- **根因**：DSH 每次供给桌面工作区都会重新盖上低完整性标签和拒绝项。
- **医生**：[可修] **后台自动巡检**：每 30 秒看一眼标签，一旦被降级立刻重置，并通知外壳重取图标（不重启资源管理器、不闪屏）；每次动作都记进修复录（`auto-desktop-label`）。想关掉：`DSH_DOCTOR_AUTOFIX=0`。

<a id="zombie"></a>
## 屏闪停不下来、后台有僵尸 DSH 进程

- **你会看到**：屏幕反复闪，任务管理器里有一堆 dsh/node 进程，端口已经没人监听。
- **根因**：逃生实例被杀、或启动被沙箱打断后，进程挂着但端口已死；有些客户端会反复重连，表现成"无限重载"。
- **医生**：[可修] **回收僵尸进程**：只清理"命令行带 dsh + web + --port，且该端口已无人监听"的进程，正在用的实例一律不动。

<a id="shell-refresh"></a>
## 标签修好了，图标还是白纸

- **根因**：Explorer 手里还攥着旧的图标句柄。
- **医生**：[可修] 修标签后自动 `SHChangeNotify` 通知外壳重新取图标；也可单独执行 `refresh-shell`。

---

<a id="icon-white"></a>
## 桌面图标全变白纸

- **你会看到**：桌面上所有快捷方式、文件夹都变成白色空白图标，但"此电脑/回收站"正常。
- **根因**：DSH 把桌面注册成工作区，每次授沙箱权限都会给桌面盖上「低完整性标签 + 拒绝项」，Explorer 读不到图标。
- **医生**：[可修] 一键把标签改回 Medium、摘掉拒绝项（保留写入能力）；并提示你把工作区从注册表移走，否则会复发。
- **详情**：[traps #1](traps.md) · [catalog](../docs/catalog.md)

<a id="flicker"></a>
## 桌面上所有图标一起闪

- **你会看到**：不是某一个图标闪，是整桌一起"刷"一下，隔几秒一次。
- **根因**：有程序在反复往桌面目录写文件（最常见：某个 DSH 会话把桌面当工作区），Explorer 每次都要重画整个桌面。
- **医生**：[只查] 查出"哪个会话把桌面当工作区"，并把它从工作区注册表里移除。
- **详情**：[traps #13](traps.md)

<a id="workspace"></a>
## 白图标修完又复发

- **你会看到**：修好没几小时/重启后又白。
- **根因**：工作区还注册在桌面上，下一次供给就重新盖标签。
- **医生**：[可修] 把危险工作区从注册表移除（走 DSH 自己的服务，不被内存覆盖），断根。
- **详情**：[traps #2](traps.md)

<a id="grant"></a>
## 一开终端就报错 / DSH 起不来

- **你会看到**：`SetNamedSecurityInfoW failed (Win32 5): grantWrite(...)`、`grantWrite` 被拒、终端开不出来、Node 起不来。
- **根因**：工作区目录的 ACL 不允许 DSH 授写权限（owner 不是你，或你没有 WRITE_DAC）。
- **医生**：[可修] 先 `icacls /save` 备份 ACL，再给当前账号补完全控制，改完**真写一个文件复测**。
- **详情**：[traps #3](traps.md)

<a id="hostdup"></a>
## `Cannot read properties of undefined (reading 'prepare')`

- **你会看到**：每轮对话都炸，报这行。
- **根因**：同一进程里混进了第二份 `@deepseek-ai/dsh-tools`（插件把宿主包写进了 `dependencies`，pnpm 装了一份真副本）。
- **医生**：[可修] 只把 `dsh-tools / dsh-skill / schemastery / dsh-util-values / cordis` 这几份副本挪进备份目录，**同目录下的合法插件不动**。
- **详情**：[traps #5](traps.md)

<a id="version-skew"></a>
## 双击图标没反应 / `Plugin ... is incompatible with dsh`

- **你会看到**：启动秒退，`DesktopHostFatalError: 1 required plugin did not activate`。
- **根因**：profile 里被平铺进了**旧版本**宿主包，兼容性守卫禁用了 `tools`，依赖它的 required 插件永远等不到。
- **医生**：[可修] 隔离旧副本（同 #hostdup 的机制），并提示摘掉那个老插件。
- **详情**：[traps #14](traps.md)

<a id="patch"></a>
## 主题 / 模型 / MCP 配置全没了

- **你会看到**：崩溃重启后，浅色主题、模型 provider、MCP 配置全丢失。
- **根因**：崩溃自修复把 `cordis.patch.yml` 清空了。
- **医生**：[可修] 从最近的 `cordis.patch.yml.bak-*` 恢复（先把当前空文件另存）。
- **详情**：[traps #10](traps.md)

<a id="session"></a>
## 某个会话打不开 / 每轮都报错

- **你会看到**：`format v4 message requires a producer-owned source kind`；或只有打开老会话才炸。
- **根因**：会话里带旧写法 `{"kind":"plugin"}`（v4 拒收），或 v3→v4 迁移表缺插件 id。
- **医生**：[只查] 只读扫描会话文件（逐帧 zstd 解压）并指出是哪个文件；**不改写**——改写会话出错会丢历史。
- **详情**：[traps #8 / #9](traps.md)

<a id="credentials"></a>
## host 起不来、credentials 报版本矛盾

- **你会看到**：`...declares version "1"; this build reads version 1` 这类自相矛盾的报错。
- **医生**：[只查] 检查 `.credentials.yaml` 的 `version` 字段是否缺失/不符；不自动改（版本语义和构建绑定，猜错更糟）。
- **详情**：[traps #10](traps.md)

<a id="path"></a>
## `dsh` 命令莫名其妙不工作

- **你会看到**：`dsh` 说没装、或版本不对、或多套安装打架。
- **医生**：[只查] 检查 PATH 里是否有指向不存在文件的 `dsh`；只指出是哪一条。
- **详情**：[traps #12](traps.md)

<a id="rescue"></a>
## 网页版页面报 `Failed to fetch`

- **你会看到**：浏览器里打开逃生地址，设置页、插件列表全报错。
- **根因**：那个标签页指向的 host 已经退出（端口死了），或者打开的是**不带 token** 的地址。
- **医生**：[只查] 识别"上次逃生实例已失效"并提醒；「起网页版」现在会复用活实例、用带 token 的地址打开、并把地址写到桌面。
- **详情**：[traps #14](traps.md) · [design](design.md)

<a id="crash"></a>
## 想知道之前崩过几次

- **医生**：[只查] 列出 `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*.log` 的数量与最近时间（renderer 崩溃常不带栈，只能靠时间关联）。

<a id="not-covered"></a>
## 不负责的（别误会）

| 现象 | 为什么不管 |
|---|---|
| 花屏、MPO 抽帧、HDR 偏色、刷新率问题 | 显卡/显示层，不是 DSH 改的；只给线索，不假装能修 |
| 系统崩溃、蓝屏 | 超出范围 |
| DSH 内部逻辑错误（不落在本机状态上） | 医生的对象是"系统状态"，不是 DSH 源码 |

---

## 怎么用

| 入口 | 用法 |
|---|---|
| 插件面板 | 侧边栏「私人医生」→ 体检 → 每条问题点「一键修复」 |
| Windows EXE | `dsh-doctor.exe`（自包含） |
| 没装 Node | `dsh-doctor-env-win-x64.zip`（自带 node.exe） |
| 命令行 | `node dsh-doctor.mjs scan / fix <id> / report` |
| 给 AI 看 | 面板「生成报告」→ 复制给任意 AI（带提示词约束） |
