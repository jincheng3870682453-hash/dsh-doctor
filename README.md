# DSH Doctor · DSH 私人医生

> **DSH 桌面端把你桌面图标搞白了、整桌闪了、插件把会话炸了？点一下。**

[![ci](https://github.com/jincheng3870682453-hash/dsh-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/jincheng3870682453-hash/dsh-doctor/actions/workflows/ci.yml)
![platform](https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-2b6cb0)
![license](https://img.shields.io/badge/license-MIT-green)
![status](https://img.shields.io/badge/status-v0.4%20preview-orange)

一个**证据驱动**的 DSH 桌面端健康检查与修复工具：侧边栏一个「私人医生」图标，点开就体检；每条问题都带路径、证据、一个「一键修复」。默认只读，改动前备份，改完立刻复检。

> ⚠️ 非官方项目。DSH 是杭州深度求索的产品；本项目只检查与修复**本机状态**，不修改 DSH 安装目录，也不代表官方立场。

---

## 为什么需要它

DSH 桌面端在 Windows 上会改系统状态，而且**不回收**：

```
DSH 注册工作区 = C:\Users\<你>\Desktop
        ↓  每次给工作区授沙箱写权限
icacls 盖上三件套：
  S-1-4-xxx:(OI)(CI)(W,D,DC)            ← 能力 ACE，放行写入
  Everyone:(CI)(DENY)(DC)               ← 拒绝删除，永不回收
  Mandatory Label\Low:(OI)(CI)(NW)      ← ★ 元凶：桌面被降成低完整性
        ↓
Explorer 在低完整性目录里取不到图标
        ↓
整个桌面的快捷方式、文件夹变成白纸
```

修好之后**必然复发**——只要这个工作区还在，下次供给就又盖一遍。所以删图标缓存、`ie4uinit -show`、重启电脑都没用；真正有效的是改标签 + 把工作区从注册表里移出去。

同样不讲道理的还有：插件把宿主包写进 `dependencies` 导致同一进程两份 `dsh-tools`；插件用 `kind: "plugin"` 往会话里注入消息被 v4 拒收；崩溃自修复把 `cordis.patch.yml` 清空……完整清单见 **[docs/traps.md](docs/traps.md)**（已收录 14 类）。

---

## 30 秒开始

### 插件版（推荐）

在 DSH 里把本仓库的 `plugin/` 目录装成一个 bundle：

```text
plugin_manager  install_bundle  target: <本仓库路径>/plugin
```

装好后侧边栏出现「私人医生」图标：

- **平时完全无感**：没有弹窗、没有托盘、没有常驻进程；
- 只在有高危问题时亮红点；
- 点开就是体检面板，一条一条点「一键修复」。

### 命令行版

```powershell
.\dsh-doctor.cmd scan                     # 只读体检
.\dsh-doctor.cmd fix -Id desktop-label    # 修桌面图标变白
.\dsh-doctor.cmd report                   # 生成可提交给官方的报告包
```

要求：Windows 10/11 + PowerShell 5.1（系统自带），无第三方依赖。

### 急救 EXE（双端都死了也能用）

仓库里带了预编译好的 **[dist/dsh-doctor.exe](dist/dsh-doctor.exe)**（约 260 KB，自包含）：

- **不需要 DSH、不需要 Node、不需要联网**——它把整套 PowerShell 逻辑内嵌在 .NET 启动器里；
- 双击打开急救菜单：体检 / 修桌面图标 / 移除危险工作区 / 隔离宿主包副本 / 恢复 patch 层 / **从备份回滚** / **起网页版逃生**；
- 也支持无交互：`dsh-doctor.exe scan`。

自己构建（只需 Windows 自带的 .NET 编译器）：

```powershell
powershell -File tools\build-exe.ps1     # 输出 dist\dsh-doctor.exe
```

场景：桌面端起不来、网页版也起不来、agent 都用不了——双击它，选「从备份回滚」或「起网页版」。

---

## 平台支持

核心逻辑与平台无关——**DSH 插件能装在哪，医生就能跑在哪**。只有少数系统原语按平台实现：

| 能力 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| 桌面 ACL / 完整性标签（图标变白的根因） | ✅ | —（改成 POSIX 权限位检查） | —（同左） |
| 一键修桌面图标 | ✅ | 不适用 | 不适用 |
| 危险工作区 / 宿主包副本 / 会话 / patch 层 / credentials | ✅ | ✅ | ✅ |
| 桌面端崩溃日志 | `%APPDATA%` | `~/Library/Logs` | `~/.config` |
| 系统通知（修复/逃生完成时） | 原生气泡 | 通知中心（`osascript`） | `notify-send` |
| 面板内「完成后弹结果」 | ✅ | ✅ | ✅ |
| 网页版逃生 | ✅ | ✅ | ✅ |

> macOS / Linux 上不存在 Windows 沙箱那套"低完整性标签"机制，所以那里不做 ACL 修复，其余检查、通知、逃生都在。
> 急救 EXE 是 Windows 版；macOS / Linux 用 `plugin/` 面板或 `node tools/mcp.mjs` 即可。

---

## 能修什么

| 检查 | 现象 | 一键修 |
| --- | --- | --- |
| 桌面 Low 完整性标签 | 图标全变白纸 | ✅ |
| 工作区注册在桌面 / 用户目录 / 盘根 | 白图标反复复发 | ✅（走 DSH 自己的注册表服务，不被覆盖） |
| profile 里出现宿主包副本 | `reading 'prepare'` 崩溃 | ✅（改名隔离，可还原） |
| `cordis.patch.yml` 被崩溃自修复清空 | 主题/模型/provider/MCP 全没了 | ✅（从最近备份恢复） |
| 会话把桌面当工作区 | 整桌图标一起闪 | 提示（根因修上面第二项） |
| 老会话含 v4 拒收的 `kind:"plugin"` | 会话打不开、每轮报错 | 只报告（改写会话风险高） |
| credentials 版本缺失 / 不符 | host 起不来 | 只报告 |
| PATH 里 `dsh` 指向死路径 | "命令莫名其妙不工作" | 只报告 |
| 桌面端崩溃日志 | 定位历史事故 | 只报告 |

完整清单（含备份位置与验证方式）：**[docs/catalog.md · 修复目录](docs/catalog.md)**。

---

## 修复录 · 网页版逃生 · 常驻守护 · MCP

### 修复录

每次点「一键修复」都会记一笔，落在 `~/.dsh/dsh-doctor/history.jsonl`：时间、动作、结果、备份路径。面板底部直接看最近 8 条，接口 `GET /dsh-doctor/history`。修坏了知道从哪回滚。

另外：**体检完成会弹一条结果摘要、修复/逃生完成会弹一条结果**（面板右上角，6 秒自动消失；同时发一条系统通知，Windows/macOS/Linux 各有实现）。

### 最后一招：交接报告 + 网页版

**网页版不是"平替"，是最后手段。** 面板里还有能一键修好的问题时，第一次点「起网页版」只会提醒你先修；再点一次才真的启动。

真正启动时，它会：

1. 在**桌面**生成一份 `dsh-doctor-交接-<时间>.md` —— 里面有本次全部体检结果、已经试过的修复、以及一段可以直接发给网页版 DSH 的话；
2. 探测本机 `dsh` / `npx`，在 47000–48999 里挑空闲端口起隔离实例（stdout/stderr 落到 `~/.dsh/dsh-doctor/rescue-<port>.log`）；
3. **用带 token 的地址**打开浏览器（裸地址会加载页面但 API 报 `Failed to fetch`）；
4. 提示你把那份 MD **拖给网页版 DSH**，让它按清单接着修。

再次点击会**复用**已在运行的那个实例（端口记在 `~/.dsh/dsh-doctor/rescue.json`），不会越开越多。浏览器里那些指向已死端口的旧标签页会一直报 `Failed to fetch`——关掉就行，医生也会把它列成一条提醒。

> 网页版和桌面端共享同一个 `~/.dsh`，所以修的是同一份数据；交接报告是给接手的那个 agent 看的"病历"。

### 常驻守护（独立进程）

```powershell
node tools/watch.mjs --url http://127.0.0.1:19387
```

每 5 秒探测一次 DSH 的本地服务；连续 3 次无响应就弹 **Windows 原生气泡**（10 分钟冷却），提示你打开医生或先用网页版。

为什么必须是独立进程：DSH 瘫痪时，写在它里面的任何东西——包括这个插件——都一起死，弹不出任何提示。

### MCP 面（可选）

```powershell
node tools/mcp.mjs        # stdio JSON-RPC
```

暴露四个受控工具，任何支持 MCP 的 agent 都能调用：

| 工具 | 说明 |
| --- | --- |
| `doctor_scan` | 只读体检 |
| `doctor_history` | 只读修复录 |
| `doctor_fix` | 修复；不传 `confirm: true` 只返回计划 |
| `doctor_rescue` | 起网页版逃生 |

没有 shell 通道，工具只接受固定的修复 id。

---

## 社区检查包协议 v1

**你踩到的新坑，不用改引擎——写一个 JSON 就行。**

检查包放在 `%USERPROFILE%\.dsh\dsh-doctor\checks\*.json`，下一次体检自动加载：

```json
{
  "protocolVersion": 1,
  "id": "my-pack",
  "title": "我自己踩过的坑",
  "checks": [
    {
      "id": "my-pack:workspace-on-desktop",
      "title": "工作区注册到了桌面",
      "severity": "high",
      "detail": "每次授沙箱权限都会把桌面降成低完整性。",
      "detect": { "type": "workspace-risky-path" },
      "fix": { "type": "workspace-entry" }
    }
  ]
}
```

- 协议与提交流程：[docs/protocol.md](docs/protocol.md)
- JSON Schema（编辑器可直接校验）：[protocol/check-pack.schema.json](protocol/check-pack.schema.json)
- 可复制示例：[examples/checks/example-pack.json](examples/checks/example-pack.json)

可用检测原语：`workspace-risky-path`、`desktop-low-label`、`profile-host-duplicate`、`desktop-session-activity`、`crash-logs`、`session-legacy-kind`、`credentials-version`、`patch-layer-missing`、`path-dead-dsh`、`acl`、`file-regex`、`dir-contains`。
可用修复动作：`desktop-label`、`workspace-entry`、`profile-host-dup`、`restore-patch-layer`。

---

## 安全设计

1. **默认只读**：体检与报告不写任何东西。
2. **每个修复三步**：备份 → 最小改动 → 立刻复检；复检失败就报错并还原，不返回"成功"。
3. **没有 shell 通道**：检查包只能声明「检测原语 + 内置修复 id」，不能执行任意命令、不能发明新动作。
4. **不碰安装目录**：不改 `app.asar`、不写 DSH 安装路径、不注册服务/驱动。
5. **改动可回滚**：ACL 有 `icacls /save` 备份，注册表有 `.bak-<时间戳>`，隔离的目录改回名字即可。

---

## 常见问题

**会不会把我桌面搞得更坏？**
不会。改桌面前的每一步都有备份，验证失败会还原。已经在你机器上跑过的真实案例：桌面标签改回 Medium、桌面工作区移出注册表、崩溃日志归档。

**为什么不用 C++？**
底层用 Rust（规划中）+ 编排用 TS。Rust 的所有权检查能在编译期挡住 C++ 那类内存问题；C++ 若要写，只在虚拟机/云端编译运行，本机最多跑冒烟。

**能修显卡 / 驱动 / HDR 那种花屏吗？**
不能，也不假装能。那类问题会明确标成"不是 DSH 的问题"，只给线索。

**数据会上传吗？**
不会。全部本地运行，没有遥测；`report` 生成的文件要不要提交由你决定。

**怎么卸载？**
设置 → 插件里停用，或 `plugin_manager remove_bundle target: dsh-doctor`。命令行版删掉目录即可。

---

## 路线图

- [x] v0.1 检测器 + 一键修复 + 侧边栏面板
- [x] v0.2 工作区修复走 DSH 服务、社区检查包协议 v1、崩溃自修复恢复
- [x] v0.3 修复录、网页版逃生、常驻守护、MCP 面、修复目录
- [ ] v0.4 把守护做成安装向导（开机自启 / 托盘菜单 / 一键卸载）
- [ ] v0.5 修复动作插件化：社区可以在评审后新增原语（当前只能新增检查）

设计细节见 **[docs/design.md](docs/design.md)**。

---

## 贡献

- 新坑：按 [协议](docs/protocol.md) 写一个 JSON 检查包，提 PR 到 `examples/checks/`，并在 `docs/traps.md` 补一条现象与根因；
- 代码：保持"只读优先、可回滚、失败不抛"的三条纪律；
- 报告：`dsh-doctor report` 会生成脱不了敏的报告包，提交前自己看一眼。

## License

MIT
