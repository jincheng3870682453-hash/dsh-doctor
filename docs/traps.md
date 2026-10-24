# DSH 桌面端踩雷清单

本文件收录已经在本机确认过的故障模式。每条都给出：症状 → 根因 → 一击修复。
新增条目请附证据（命令 + 原始输出）。

---

## 一、沙箱权限类

### 1. 桌面图标全部变成白纸

**症状**：桌面上的快捷方式、文件夹图标全变白，但"此电脑 / 回收站 / Edge"这些系统项正常。删图标缓存、`ie4uinit -show`、重启电脑都无效。

**根因**：DSH 把桌面本身注册成了工作区。每次供给沙箱写权限时，在 `C:\Users\<你>\Desktop` 上盖三件套：

```
S-1-4-xxx:(OI)(CI)(W,D,DC)            ← 能力 ACE（放行写入）
Everyone:(CI)(DENY)(DC)               ← 拒绝删除
Mandatory Label\Low:(OI)(CI)(NW)      ←  元凶
```

Explorer 在 Low 完整性目录里取不到图标 → 全白。

**一击修复**：

```powershell
icacls "$env:USERPROFILE\Desktop" /setintegritylevel '(OI)(CI)Medium'
icacls "$env:USERPROFILE\Desktop" /remove:d '*S-1-1-0'
```

**注意**：改标签**不影响**沙箱写入（写入靠能力 ACE），所以安全。

**但一定会复发**：下一次供给工作区时三件套会重新盖上。断根办法见第 2 条。

### 2. 白图标反复复发

**根因**：`~/.dsh/storages/workspace.json` 里有 `"C:\\Users\\<你>\\Desktop"` 这一条。

**一击修复**：把工作区改成桌面的**子目录**（如 `Desktop\项目名`）或别的盘；或者直接删掉那条注册（先备份 `workspace.json`）。

### 3. `SetNamedSecurityInfoW failed (Win32 5): grantWrite(...)`

**症状**：DSH 一开终端就报这行，任何命令都跑不了。

**根因**：工作区目录的 DACL 不允许写入能力 ACE（目录权限被改坏，或继承了不合适的权限）。

**一击修复**：给当前用户在该目录补 `完全控制`（含 `WRITE_DAC` / `WRITE_OWNER`），然后重试原操作。

### 4. 子目录写不进去

**根因**：子目录继承了父目录打上的 `Low` 标签或 `Everyone` 拒绝项。

**一击修复**：对具体子目录单独 `icacls /setintegritylevel ... Medium`，并检查是否还有继承的拒绝项。

---

## 二、插件与 profile 类

### 5. `Cannot read properties of undefined (reading 'prepare')`

**症状**：每轮对话都炸，报这行。

**根因**：同一进程里混进了第二份 `@deepseek-ai/dsh-tools`。两份包的 `Symbol("@deepseek-ai/dsh-tools.scheduler")` 不是同一个符号，拿到的是 `undefined`。

**常见触发**：某个插件把宿主包（`@deepseek-ai/dsh-tools`、`dsh-skill`、`schemastery`）写进了自己的 `dependencies`，pnpm 就会在 profile 里装一份**真副本**。

**一击修复**：

```powershell
Get-ChildItem "$env:USERPROFILE\.dsh\profiles" -Recurse -Directory -Filter '@deepseek-ai' -Depth 4 |
  Where-Object { $_.FullName -notmatch 'stale' }
```

有输出就把那个 `@deepseek-ai` 目录改名隔离（加 `.stale-<时间戳>` 后缀），重启桌面端。

### 6. profile 里的 `@deepseek-ai` 是指向另一套运行时的链接

**根因**：profile 的 junction 链指向了另一个版本的 DSH。

**一击修复**：删掉链接，让运行时自己提供宿主包。

### 7. 插件清单把宿主包写进 `dependencies`

**根因**：和 5 同源。**根治要找插件作者**，把三个包改成 `peerDependencies`。

**自查**：逐个看插件 `package.json` 的 `dependencies` 里有没有 `@deepseek-ai/*`。

---

### 17. 权限给太大，DSH 把文件删了

**症状**：让 DSH 干活，结果它删掉了项目/家目录里的一部分文件；回收站里没有。

**根因**：会话权限是 `danger-full-access` + 审批 `never`——模型可对整台机器执行任何命令，删除走 `Remove-Item`/`unlink`，**不进回收站**。

**怎么查**：医生 `permission-too-broad`（v0.13.5）；或看 `~/.dsh/storages/session_projcache.json` 里每个会话的 `permissions`。

**怎么救**：Git 仓库先 `git restore`；然后卷影副本 / 文件历史 / 网盘版本历史；最后才是数据恢复软件。完整顺序见 [recovery.md](recovery.md)。

**防复发**：`/permission` 切成 `workspace-write` + `ask`；工作区单独建目录，不要选家目录/桌面/盘根。

### 18. 第三方插件启动就崩：`ReferenceError: server is not defined`

**症状**：DSH 弹「应用无法启动或已意外停止」，错误里有 `file:///.../<插件>/xxx.js` 和 `ReferenceError`；点退出后重开还是一样。

**根因**：某个第三方/本地插件在模块加载阶段（top-level）抛未捕获异常。典型是引用未声明的变量，例如 `server.listen(...)` 但漏了 `const server = ...`；ESM 是严格模式，直接 `ReferenceError`，DSH 宿主跟着起不来。

**医生怎么认**：v0.13.8 起 `plugin-boot-failure` 检查会从 crash 日志里提取插件路径和错误原文，直接指到文件。

**怎么救**：
1. 在启动失败对话框点 **「禁用第三方插件、备份 profile patch 并重启」**（DSH 自带的安全模式）；
2. 按日志里的路径找到那个插件（例如 `...\default-workspace\qq-bridge\index.js`），补上变量声明 / 更新插件 / 移除它；
3. 再重启桌面端。

**注意**：这不是 DSH 本体的问题，重装 DSH 没用。

## 三、会话格式类

### 16. 插件还在列表里，但功能不工作（插件版本与运行时不一致）

**症状**：升级 DSH 桌面端后，某个官方插件仍显示"已启用"，但它提供的功能消失；插件列表里可能带 `incompatible-version`。

**根因**：profile 把 `@deepseek-ai/*` 插件固定在旧版本（如 `0.2.1-rc.1`），而运行时升到了 `0.2.1-rc.3`；兼容性守卫拒绝加载版本不符的插件。

**一击修复**：把该插件升级到与运行时一致的版本（`plugin_manager` 安装新版本），或者先禁用/移除它。

**自检**：`bundle-version-skew` 检查（v0.13.4 起）会直接列出不一致的插件。
### 15. 改了 npm 包名后，侧边栏图标和面板消失

**症状**：宿主功能还在（`/dsh-doctor/status` 正常、体检能跑），但侧边栏图标和面板"被挤掉了"；插件列表里 bundle 仍显示已启用、无报错。

**根因**：DSh 用**包名**标识浏览器模块（`client-modules`：manifest package name identifies the browser module）。如果只改了 `package.json` 的 `name`（比如为了上 npm 从 `dsh-doctor` 改成 `dsh-doctor-plugin`），而 `cordis.patch.yml` 的 `name` 和 `client.js` 里 `window.__ModuleLoader__.load({ id })` 还是旧名，客户端半边会**静默不注册**——宿主半边不受影响，所以看起来"插件还在，只是图标没了"。

**一击修复**：

1. `cordis.patch.yml`：`id` 与 `name` 改成当前包名；
2. `lib/client.js`：`window.__ModuleLoader__.load({ id: '<当前包名>' })`；
3. 重装 bundle（旧的先移除，再装新目录/包名）；
4. 验证：客户端 Slots 里 `sidebar.panellist` 和 `main` 都应出现你的 id。

**自检**：`npm pkg get name` 与 patch 行、client id 三者必须一致。
### 8. `format v4 message requires a producer-owned source kind`

**症状**：每轮对话都炸，新会话也炸。

**根因**：某个插件往会话里注入消息时用了旧写法：

```js
source: { kind: "plugin", plugin: "xxx", form: "instructions" }
```

v4 明确拒收 `kind: "plugin"`，要求用 producer-owned 的 kind（如 `skill-catalog`、`compact-checkpoint`）。插件每个 step 都塞一条 → 每轮必炸。

**区分法**：

- **新会话也炸** = 插件在**实时注入**旧写法（改插件代码）；
- **只有打开老会话才炸** = 老**数据**里带旧写法（改会话文件）。

**一击修复**：把插件里的 `kind: "plugin"` 改成该插件自己的 producer-owned kind，重启桌面端。

### 9. 老会话永久打不开

**根因**：v3→v4 迁移表只收录了 5 个插件 id（`compact`、`tools-ptc`、`dsh-compaction-basic`、`@deepseek-ai/dsh-system-prompt` 等），而老会话里实际出现过 12 个，未收录的包括：`tool-jobs`、`dsh-session-title-llm`、`user-approval`、`tool-goal`、`repeat-tool-reminder`、`cordis-host-runner`、`model-selection`。迁移直接抛错。

**一击修复**：把老会话文件里 `{"kind":"plugin","plugin":"<id>"}` 改写为合法的 producer-owned kind，逐行 JSON 校验，改前备份。

---

## 四、部署环境类

### 10. `DesktopHostFatalError: dsh: startup failed: 1 required plugin did not activate`

**根因**：profile 里某个插件激活失败，或 `credentials.yaml` 版本不匹配把 host 拖死。

**一击修复**：看 `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-host.log` 的第一条错误；先隔离最近安装的插件再重启。

### 11. renderer 崩溃、日志里没有栈

**症状**：`crash-*-renderer.log` 只有一句 crashed。

**现状**：这是上游的日志缺口，只能靠**时间关联**（崩溃时刻前后装了什么 / 改了什么）来定位。DSH Doctor 的 `scan` 会把崩溃日志列出来。

### 12. 多套 DSH 安装共存 / `dsh` 命令指向死路径 / 桌面端 profile 被 Electron 独占

**症状**：`--dump-config` 报 `profile "desktop" is managed exclusively by the Electron application`；或者 CLI 和桌面端版本不一致。

**一击修复**：确认自己在用哪一套运行时，别把两套混着用；版本对齐后再排查。

---

## 五、桌面图标闪烁 / 抽动

和"图标变白"是同一个根：**桌面被当成工作区**。区别只在症状——变白是权限（Low 标签），闪烁是重画。

**机制**：桌面文件夹里只要有一次创建 / 删除 / 改名，explorer 就把**整个桌面图标列表重画一遍**。所以看起来是"全部图标一起闪"，不是某一个图标的问题。

**两条排查线**（先分清是哪条，别乱修）：

| 判据 | 结论 | 处置 |
| --- | --- | --- |
| 监视桌面有文件事件（尤其是每几秒一次） | 有程序在反复写桌面 | 找那个程序；若是 DSH 会话，关掉它或换工作区 |
| 监视 2 分钟零文件事件 | 不是写文件 | 转 explorer 重画 / 显示层（见下） |

**有文件事件时**：常见是某个 DSH 会话工作区 = `C:\Users\<你>\Desktop`，它每写一个临时脚本、日志、`__pycache__`，桌面就闪一次。产物还会留在桌面上（`_recover_*.mjs`、`_session_dump.jsonl` 之类）。

**零文件事件时**，按便宜到贵：

1. 干净启动二分（禁用全部自启 → 重启）：OneDrive 角标、Adobe CC、网盘、输入法、反作弊托盘都是老牌元凶；
2. 重置图标布局与缓存：`reg delete "HKCU\Software\Microsoft\Windows\Shell\Bags" /f`、`BagMRU`、`taskkill explorer`、删 `iconcache*` / `thumbcache*`；
3. 显示层：MPO 抽帧（`HKLM\SOFTWARE\Microsoft\Windows\Dwm\OverlayTestMode = 5`）、HDR、刷新率、G-SYNC。

**断根**：别把桌面 / 下载 / 文档设成 AI 会话的工作区——这些目录被 explorer 实时渲染，任何写入都会闪。

## 六、启动崩溃类

### 14. 桌面端起不来：`Plugin @deepseek-ai/dsh-tools@x is incompatible with dsh y`

**症状**：双击图标没反应/秒退；日志 `DesktopHostFatalError: dsh: startup failed: 1 required plugin did not activate`；用桌面端自带 CLI 复现能看到更清楚的一句：

```
dsh: disabling profile plugin row "tools":
Plugin @deepseek-ai/dsh-tools@0.2.0-rc.2 is incompatible with dsh 0.2.1-rc.1
→ agent-loop(required) 等 8 个插件永远等不到 tools 服务 → 启动致命失败
```

**根因**：profile 的 `node_modules` 里被 pnpm（`nodeLinker: hoisted`）平铺进了**旧版本**的宿主包（`dsh-tools` / `dsh-skill` / `dsh-util-values`）。来源是某个老插件把 `@deepseek-ai/dsh-tools@<旧版本>` 写进了 `dependencies`。运行时版本比它新，兼容性守卫把 `tools` 这行禁用 → 依赖它的 required 插件永远等不到 → 整个 host 起不来。

**和第 5 条的区别**（同一个机制的两个面孔，别搞混）：

| 报错 | 副本情况 |
| --- | --- |
| `reading 'prepare'` | **同版本两份**副本，`Symbol()` 各造一个 |
| `is incompatible with dsh` | **一旧一新**，旧的那份被兼容性守卫禁用 |

**一击修复**：

1. 把过期包**移动**（不是删）到 `profiles\<名>\.stale-backup-<时间戳>\`；
2. 从 profile 的 `package.json` 摘掉那个旧插件（不摘的话，下次一装插件 pnpm 又会把旧包抬回来）；
3. 用**桌面端自带的运行时** + profile 副本验证：stderr 零告警即成功。

**副作用提醒**：桌面端崩溃自修复可能把 `cordis.patch.yml` 的 patch 层清空（主题、provider、MCP 全没了），原文件一般留了 `.bak-<ms>`，恢复时记得剔掉那个旧插件那行。新装的插件如果只在 `dependencies` 里、`dsh.profile.bundles` 没它们，等于"装了没启用"。

## 七、方法论

### 签名式报错 → 根因速查

| 报错原文 | 直接跳到 |
| --- | --- |
| `reading 'prepare'` | 第 5 条（第二份宿主包） |
| `is incompatible with dsh` | 第 14 条（profile 里宿主包版本比运行时旧） |
| `producer-owned source kind` | 第 8 条（插件旧写法） |
| `SetNamedSecurityInfoW failed ... grantWrite` | 第 3 条（目录权限） |
| `DesktopHostFatalError` | 第 10 条（插件没激活 / credentials） |

### 固定动作

1. **先取证，再动手**：任何"本机状态"结论都要有命令 + 原始输出。
2. **备份 → 最小改动 → 立刻验证 → 可回滚**。
3. **破坏性动作默认拒绝**：改权限、删会话、重启服务，没有现场证据不动。
4. **一次只改一个变量**，改完立刻验证。
5. **判断是不是同一进程里混进了第二份/旧写法**——这条能盖掉大部分坑。
