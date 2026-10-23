# DSH Doctor

> Windows 桌面端故障诊断与修复工具箱 —— 把"桌面图标变白、插件炸会话、profile 里多一份宿主包"这些坑，变成一条命令。

一个社区维护的开源工具，用来检查并修复 **DeepSeek Harness（DSH）桌面端在 Windows 上踩过的已知坑**。默认只读，任何写操作都会先备份、再执行、最后验证，并打印回滚命令。

> ⚠️ 非官方项目。DSH 是杭州深度求索的产品；本项目只做本机状态检查与修复，不修改 DSH 的安装文件。

---

## 为什么需要它

DSH 桌面端在 Windows 上会动系统状态，而这些操作**都没有回收机制**。已经确认过的典型链路：

```
DSH 注册工作区 = C:\Users\<你>\Desktop
        ↓  （每次给工作区授沙箱写权限时）
icacls：S-1-4-xxx:(OI)(CI)(W,D,DC)      ← 能力 ACE，用来放行写入
        Everyone:(CI)(DENY)(DC)          ← 拒绝删除，从不回收
        Mandatory Label\Low:(OI)(CI)(NW) ← ★ 元凶：桌面被降为低完整性
        ↓
Windows Explorer 在 Low 完整性目录里取不到图标
        ↓
整个桌面所有快捷方式、文件夹变成白纸图标
```

修好之后**一定会复发**，因为下一次供给工作区时三件套会重新盖上。所以真正要修的是**工作区的注册位置**，而不是图标缓存——删缓存、重建图标、`ie4uinit -show`、重启电脑，全都没用。

同类问题还有：

| 症状 | 根因 |
| --- | --- |
| `Cannot read properties of undefined (reading 'prepare')` | 同一进程里混进了第二份 `@deepseek-ai/dsh-tools`（插件把宿主包写进了 `dependencies`） |
| `format v4 message requires a producer-owned source kind` | 插件用旧写法 `source: { kind: "plugin" }` 往会话里注入消息，v4 直接拒收 |
| 老会话打不开、每轮都炸 | v3→v4 迁移表只收录了 5 个插件 id，老会话里有 7 个没收录 |
| `SetNamedSecurityInfoW failed (Win32 5): grantWrite(...)` | 工作区目录的 DACL 不允许 DSH 写入能力 ACE |
| `DesktopHostFatalError: dsh: startup failed` | profile 里的 `@deepseek-ai/*` 副本或 credentials 版本问题拖死 host |
| 子目录写不进去 | 继承了父目录的 `Low` 标签 / 拒绝项 |

完整清单见 [docs/traps.md](docs/traps.md)。整体架构、版本无关性设计与通知方案见 [docs/design.md](docs/design.md)。

---

## 插件版（第一版，已可用）

它也可以作为 DSH 插件装进桌面端：侧边栏多一个「私人医生」，点开就能体检、一键修。

```powershell
# 安装（plugin_manager install_bundle，target 指向本仓库的 plugin 目录）
plugin_manager install_bundle  target: <repo>/plugin
```

装好之后：

- 侧边栏出现「私人医生」图标，平时安静，只在有高危问题时亮红点；
- 点开是体检面板：每条问题都带路径、原因、一个「一键修复」；
- 修复走同源路由 `/dsh-doctor/fix`，只接受固定的修复 id，**没有 shell 通道**；
- 每个修复先备份、改完立刻复检，失败如实报错。

| 检查 | 能一键修 |
| --- | --- |
| 桌面被打 Low 完整性标签（图标变白） | ✅ |
| 工作区注册到桌面 / 用户目录 / 盘根（复发根源） | ✅ |
| profile 里出现宿主包副本（`reading 'prepare'`） | ✅ |
| 会话正把桌面当工作区（整桌闪烁） | 提示，修复走上一项 |
| 桌面端崩溃日志 | 只报告 |

---

## 快速开始

要求：Windows 10 / 11，PowerShell 5.1（系统自带）即可，无第三方依赖。

```powershell
git clone https://github.com/<your-name>/dsh-doctor.git
cd dsh-doctor

.\dsh-doctor.cmd scan            # 只读体检：列出所有发现，附证据
.\dsh-doctor.cmd fix -Id desktop-label     # 修桌面图标变白
.\dsh-doctor.cmd report          # 生成可提交给官方的 bug 报告包
```

`scan` 默认**不改任何东西**，只输出 `[High] / [Medium] / [Info]` 三级发现，每条都带：路径、证据（SDDL / 文件路径 / 行号）、对应修复命令。

### 修复项

| `-Id` | 作用 | 风险 |
| --- | --- | --- |
| `desktop-label` | 把桌面完整性标签改回 `Medium`，摘掉 `Everyone` 拒绝项（**保留** 能力 ACE，不破坏写入） | 低，自动备份 ACL |
| `workspace-entry` | 从 `~/.dsh/storages/workspace.json` 移除"桌面 / 用户目录 / 盘根"这类危险工作区（断根，防复发） | 中，改前备份，JSON 校验通过才落盘 |
| `profile-host-dup` | 把 profile 里多出来的第二份 `@deepseek-ai/*` 重命名隔离（`.stale-<时间戳>`） | 中，可改名还原 |

```powershell
.\dsh-doctor.cmd fix -Id desktop-label -RestartExplorer   # 修完顺带重启资源管理器
.\dsh-doctor.cmd fix -Id workspace-entry                  # 交互确认后删危险工作区
.\dsh-doctor.cmd fix -Id profile-host-dup -Yes            # 不问，直接隔离
```

---

## 检查项（v0.1）

| 检查 | 看什么 |
| --- | --- |
| 桌面完整性 | 桌面 SDDL 里是否有 `S:(ML;;NW;;;LW)`（Low 标签）、`Everyone` 拒绝项、能力 ACE |
| 工作区注册 | `~/.dsh/storages/workspace.json` 里是否注册了 Desktop / 用户目录 / Documents / Downloads / 盘根 |
| profile 宿主包 | `~/.dsh/profiles/*/node_modules/@deepseek-ai` 是否是真目录（而非链接）—— 一份就是 `reading 'prepare'` |
| 插件清单 | 已安装插件的 `package.json` 是否把 `@deepseek-ai/*`、`schemastery` 写进 `dependencies` |
| 插件源码 | `node_modules` 里是否还有 `kind: "plugin"` 这种 v4 已废弃的注入写法 |
| 崩溃日志 | `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*.log` 最近 10 条 |

`scan -Json` 输出机器可读结果，方便接进 CI 或别的工具。

---

## 安全性设计

1. **默认只读**：`scan` / `report` 不写任何东西。
2. **每个修复都三步**：备份 → 最小改动 → 立刻验证。验证失败就报错，不返回"成功"。
3. **打印回滚命令**：ACL 修改会先 `icacls /save`，回滚命令直接复制就能用。
4. **不做常驻服务**、不注册计划任务、不碰注册表、不改 DSH 安装目录。
5. **不确定就降级**：读不到权限、路径不存在、命令失败 → 记为 `Info` 或 `Medium` 并说明，不猜测。

---

## 已知边界 / Roadmap

当前版本是 **PowerShell 单文件原型**，用来验证检测逻辑是否站得住；它不是最终形态。

正式形态（见 [docs/design.md](docs/design.md)）：

- **doctor-sys.exe**（Rust，静态单文件、无运行时依赖）：只做系统原语——安全描述符、完整性标签、注册表、进程、端口、原生通知；
- **core**（TS，零依赖）：检测器 / 修复器 / 快照 / 归因 / 探针；
- **四张脸**：CLI（`.cmd`）、MCP（可选，给 AI 自己调）、DSH 侧边栏面板、常驻守护进程；
- **常驻守护**：DSH 瘫痪时由 DSH 之外的进程弹 Windows 原生提示——写在 DSH 里的东西跟着一起死，救不了 DSH；
- **升级拦截器**：升级前快照、升级后真启动验证、失败一键回滚（回滚是快照还原，不是降版本）。

v0.1 不做会话文件（逐帧 zstd）的自动修复——只报告"插件源码里有旧写法"。

- 跨机器验证尚未做：v0.1 只在本机（Windows 11 / PowerShell 5.1 / DSH 0.2.0-rc.2）验证过。

---

## 贡献

欢迎提 Issue 带上 `dsh-doctor report` 生成的报告包（会脱敏路径吗？**不会**，提交前自己看一眼）。新增检查请遵循：只读、可解释、带证据、失败不抛异常。

## License

MIT
