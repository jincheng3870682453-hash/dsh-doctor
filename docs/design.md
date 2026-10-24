# dsh-doctor 设计文档

> 状态：草案 v0.2（2026-10-23）
> 定位：**DSH 的私人医生** —— 专治"屏幕上看得见"的坏，以及"升级把你环境搞废"的坏。
> 一句话：**它不依赖 DSH 活着，才能救 DSH。**

---

## 1. 目标 / 非目标

### 目标

1. **诊断**：把"桌面图标白了/闪了/DSH 起不来"从玄学变成一条可复核的证据链。
2. **修复**：每条修复可回滚、有备份、有验证（真启动探针，不是"改了就当好了"）。
3. **兜底**：DSH 瘫痪时，用户仍然有一条路（原生通知 + 急救箱 + 网页版逃生）。
4. **版本无关**：DSH 怎么升级、内部怎么改，引擎不跟着碎。
5. **开源**：目录是数据、贡献者只加条目不改引擎。

### 非目标

- 不修显卡/驱动/系统级显示问题（MPO、HDR、刷新率）——只诊断、给线索、明说"这不是 DSH 的锅"。
- 不改 DSH 的 `app.asar` / 安装文件（升级即被覆盖，且越界）。
- 不做"万能系统修复"（DISM/SFC 那套），不复刻老工具。
- 不做云服务；默认全本地、无遥测。

---

## 2. 决策记录（ADR）

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | 底层用 **Rust**，不用 C++ | 编译期所有权/借用检查；静态单文件；毫秒级启动；无运行时依赖 |
| D2 | 编排层用 **TypeScript**，零第三方依赖 | 与 DSH 插件宿主同构；供应链风险为 0 |
| D3 | C++ 仅允许在 **虚拟机/云端**写、编译、运行；本机最多跑冒烟测试 | 不在用户机器上承担 C++ 的未知风险 |
| D4 | **MCP 作为可选组件** | 装了就能让 AI 自己调；不装也不影响主流程 |
| D5 | 通知：图标状态点常开，toast 去重，时间线被动，**瘫痪时走 Windows 原生通知** | 见 §6 |
| D6 | 修复只走 Win32 + 文件系统，**不碰 app.asar 内部** | 升级兼容性、可回滚 |
| D7 | 常驻守护是 **独立进程**，不是 DSH 插件的一部分 | 插件跟着 DSH 一起死，救不了 DSH |
| D8 | 回滚 = **快照还原**，不是降版本 | 桌面端原地自动更新，旧构建通常不存在 |

---

## 3. 核心约束：版本无关性

> 用户原话："就算他们的版本再怎么变，我们都能修复。"

这是全案最重要的设计约束。做法是**只依赖稳定的观测面**，并把"会变的东西"全部下沉为数据。

### 3.1 三层稳定面（按稳定性排序）

| 层 | 观测面 | 稳定性 | 用途 |
| --- | --- | --- | --- |
| S1 | **Win32 系统状态**：ACL/SDDL、完整性标签、注册表、进程、端口、文件时间 | 十年不变 | 判断"系统被改坏了" |
| S2 | **DSH 数据布局**：`~/.dsh/` 下的 profiles / sessions / storages / 日志文件 | 相对稳定（目录约定极少变） | 判断"DSH 自己坏了" |
| S3 | **文本签名**：日志与终端里的报错原文 | 每次升级可能变 | 判断"是哪一种坏" |

**规则**：S1/S2 驱动检测；S3 只用于"归因到具体条目"，永远不作为唯一判据。

### 3.2 依赖降级链

```
官方 API（如 workspaceRegistry.list）
   ↓ 不可用/签名变了
数据文件（workspace.json 等，只读解析）
   ↓ 格式变了
日志文本签名（catalog 里的正则）
   ↓ 都对不上
报告"未知状态"，不猜、不动手
```

这条链保证：DSH 升版把某一层改掉，工具**退一格**继续工作，而不是整工具失效。

### 3.3 修复动作的版本无关性

修复只做这些事（全部是 S1 层的系统动作）：

- 读/写安全描述符（`GetNamedSecurityInfoW` / `SetNamedSecurityInfoW`）
- 改强制完整性标签（Low → Medium）
- 删除指定的拒绝 ACE
- 重命名/移动 profile 里的旧宿主包（文件系统）
- 快照与还原（文件复制 + JSON）
- 启停进程、探测端口、发通知

**没有一个动作依赖 DSH 内部 API**，所以 DSH 升多少个版本都不影响修复能力。

### 3.4 catalog 的版本谓词

```json
{
  "id": "profile-host-version-skew",
  "applies": { "runtime": ">=0.2.0-rc.1 <0.3.0", "os": ">=10.0" },
  "detect": { "predicate": "profile-host-version-mismatch" },
  "fix": { "primitive": "quarantine-dir", "args": { "target": "{profile}/node_modules/@deepseek-ai/*" } },
  "verify": { "probe": "launch-runtime", "expect": "stderr-clean" }
}
```

版本不匹配 → 自动停用该条目并在面板标注"已过期"，**绝不拿旧经验硬修**。

---

## 4. 架构分层

```
┌──────────────────────────────────────────────────────────────┐
│  脸（Faces）                                                  │
│  CLI(.cmd)  ·  MCP(stdio)  ·  DSH 插件(侧边栏面板)  ·  守护进程 │
└──────────────────────────────┬───────────────────────────────┘
                               │ 只调用 core 的公开函数
┌──────────────────────────────▼───────────────────────────────┐
│  core（TS，零依赖，可被 CLI/MCP/插件同时内联）                  │
│  检测器 · 修复器 · 快照 · 归因 · 探针 · catalog 解释器          │
└──────────────────────────────┬───────────────────────────────┘
                               │ JSON over stdio（每个请求一个进程）
┌──────────────────────────────▼───────────────────────────────┐
│  doctor-sys.exe（Rust，静态单文件，2~3 MB，无运行时依赖）       │
│  安全描述符 / 完整性标签 / 注册表 / 进程 Job / 端口              │
│  SHChangeNotify / Shell_NotifyIcon（原生通知） / ETW（可选）     │
└──────────────────────────────────────────────────────────────┘
```

### 为什么要有 doctor-sys.exe

- **瘫痪时**：Node/Electron 都不可信，只有一个 2MB 的静态 exe 是可信的。
- **无窗口**：Rust 直接调 Win32，不需要 PowerShell（也就不需要担心执行策略、黑框、启动开销）。
- **单一实现**：ACL 这类危险动作全世界只写一遍，三边共用。

### 性能预算

| 动作 | 目标 |
| --- | --- |
| exe 冷启动 | < 100 ms |
| 全量体检（scan） | < 1 s |
| 单条快照（增量） | < 200 ms |
| 急救（起网页版并打开浏览器） | < 3 s |

---

## 5. 常驻守护与"临终通知"

### 5.1 为什么必须是独立进程

DSH 瘫痪时，插件、host、renderer 一起死，**任何写在 DSH 里的逻辑都弹不出来**。所以要有一个活在 DSH 之外的东西：

```
doctor-watch.exe（托盘常驻，开机自启，可选）
   ├─ 心跳：每次 DSH 会话结束由插件写 ~/.dsh/doctor/beacon.json
   ├─ 探针：每 5 s 探测 DSH 的 HTTP 端口 + 主进程存活
   └─ 判定：连续 3 次失败 或 心跳超时 30 s  →  判"瘫痪"
```

### 5.2 判定与通知

```
瘫痪判定
  ├─ 进程消失 / HTTP 连续 3 次超时
  ├─ 心跳文件超过 30 s 未更新（插件在 host dispose 时写最后一次）
  └─ 主窗口无响应（可选：SendMessageTimeout WM_NULL 超时）

通知（从轻到重）
  1. 托盘图标变红 + 气泡（Shell_NotifyIconW + NIF_INFO）
     "很遗憾，DSH 桌面版已瘫痪。点这里打开急救箱。"
  2. 单击托盘 → 打开本地急救页（doctor-sys.exe 内嵌 HTTP，随机高位端口）
  3. 急救页三个按钮：体检 / 修复 / 回滚 / 起网页版
```

> Win10/11 上 `NIF_INFO` 气泡零依赖、一定能弹（不需要注册 AUMID、不需要打包）。
> 后续可升级为 WinRT toast（更接近系统通知样式），但有打包/AUMID 门槛，排在 P4。

### 5.3 文案（原生弹窗）

```
标题：DSH 桌面版已瘫痪
正文：已为你保存现场。可以打开急救箱修复，或先切换到网页版继续工作。
按钮：打开急救箱 │ 起网页版 │ 稍后再说
```

### 5.4 守护的克制

- 不接管进程、不自动重启 DSH（用户没要求就别乱动）。
- 冷却：同一个问题 10 分钟内只弹一次。
- 一键退出托盘：`退出守护`。

---

## 6. 通知矩阵

| 级 | 场景 | 载体 | 默认 |
| --- | --- | --- | --- |
| A | 状态变差但还可用（桌面被打 Low 标签、工作区注册到桌面） | 侧边栏图标状态点（黄/红）+ tooltip | **开** |
| B | 已经坏了且影响使用（图标全白、整桌闪、下一轮必炸） | 自渲染 toast（`shell.overlay`），同 id 24h 去重，带 [修][知道了] | **开（去重）** |
| C | 想看原因 | 面板时间线 + 快照 diff；或对话里问 agent | 被动 |
| D | DSH 瘫痪（界面完全不可用） | **Windows 原生气泡/托盘**（§5） | **开（守护装了就开）** |
| E | 升级把环境搞坏（升级后验证失败） | 原生通知 + 面板红条 + 一键回滚 | **开** |

---

## 7. 版本地狱与升级拦截器

### 7.1 六种不兼容形态

| # | 形态 | 典型表现 |
| --- | --- | --- |
| 1 | 运行时升级 + profile 里旧宿主包 | `is incompatible with dsh` → 起不来 |
| 2 | 会话格式版本（v3→v4→…） | 老会话打不开、每轮炸 |
| 3 | credentials 版本 | host 启动失败 |
| 4 | `cordis.patch.yml` 方言/行 id | 插件行失效、patch 层被清空 |
| 5 | 插件 API 签名 | 插件激活失败、工具注册不上 |
| 6 | 存储结构（`workspace.json` / sessions） | 工作区丢失、会话列表错乱 |

### 7.2 升级拦截器（本项目的核心卖点）

```
检测到 runtime 版本变化
  ├─ 升级前：拍 pre-upgrade 快照（版本号 + profile 清单 + patch yml + workspace.json + ACL）
  ├─ 升级后：用 runtime + profile 副本真起一遍，扫 stderr
  │     incompatible / disabling profile plugin row / startup failed
  ├─ 失败 → 原生通知 + 面板红条 + [回滚]（快照整组还原）
  └─ 成功 → 把新状态记为 known-good
```

### 7.3 兼容性预检（升级前就能预警）

- 扫描每个插件 `package.json` 里声明的 `@deepseek-ai/*` 版本；
- 与目标运行时版本比对；
- 输出："这次升级会炸：`dsh-ponytail@0.15.0` 依赖 `dsh-tools@0.2.0-rc.2`，与新运行时 0.2.1-rc.1 不兼容；建议先禁用或升级。"

### 7.4 版本矩阵

catalog 每条带 `applies.runtime` 范围；DSH 一变，过期的自动停用。同时保留"每个运行时的 known-good 记录"，回滚时优先回最近的 known-good。

---

## 8. 修复目录（catalog）格式

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "id": "desktop-low-integrity-label",
      "title": "桌面被打上低完整性标签（图标变白）",
      "severity": "high",
      "applies": { "runtime": "*", "os": ">=10.0" },
      "detect": {
        "kind": "acl",
        "path": "{desktop}",
        "test": "sddl-match",
        "pattern": "S:\\(ML;;[^;]*;;;LW"
      },
      "why": "沙箱授写权限的副产物；工作区=桌面时每次供给都会重新盖上",
      "fix": {
        "primitive": "set-integrity-label",
        "args": { "path": "{desktop}", "label": "Medium", "recursive": true },
        "backup": "acl-save",
        "verify": { "kind": "acl", "test": "no-low-label" }
      },
      "rollback": "acl-restore",
      "refs": ["docs/traps.md#1"]
    }
  ]
}
```

> `primitive` 是有限的动词表（见 §9），**catalog 不能表达任意的 shell**——这是安全边界。

---

## 9. 原语表（doctor-sys.exe 暴露的动词）

> **v0.11.0 起 P0 已落地**：`doctor-sys/` 目录（Rust、零第三方依赖、静态单文件约 300 KB）。
> 协议：JSON over stdio，每个请求一个进程。原语明细与实测坑见 [doctor-sys/README.md](../doctor-sys/README.md)。

| 原语 | 作用 | 状态 |
| --- | --- | --- |
| `acl-read` / `acl-save` / `acl-restore` | 读/备份/还原安全描述符 | v1 已实现 |
| `set-integrity-label` | 改强制完整性标签（Low/Medium/High，可递归） | v1 已实现 |
| `remove-deny-ace` | 删指定 SID 的拒绝项 | v1 已实现 |
| `reg-read` / `reg-write` | 注册表（仅白名单键） | **v1 未实现**（现有引擎用不到，宁缺毋滥） |
| `proc-list` / `proc-kill-tree` | 进程枚举、杀进程树（快照期父子近似；拒绝杀 0/4/自己） | v1 已实现 |
| `port-probe` / `port-pid` | 端口连通探测、端口归属 pid | v1 已实现 |
| `notify` | 原生气泡/托盘通知（沙箱内被 UIPI 拒，正常桌面上下文可用） | v1 已实现 |
| `shell-refresh` | `SHChangeNotify` 刷新外壳（避免重启 explorer） | v1 已实现 |
| `quarantine-dir` | 重命名隔离目录 | v1 已实现 |
| `snapshot-write` / `snapshot-restore` | 快照读写（恢复前先备份现状） | v1 已实现 |

> **没有 `exec`、没有 `shell`**：catalog 数据永远不能变成任意命令执行。

---

## 10. MCP 契约（可选组件）

```
doctor_scan()                        只读，返回 findings[]
doctor_diff(snapshotA, snapshotB)    只读
doctor_report(outDir?)               只读，打包报告
doctor_fix(entryId, dryRun=true)     默认只出计划
doctor_fix(entryId, confirm=token)   真动手（需显式 token）
doctor_rollback(snapshotId)
doctor_rescue_web()                  起网页版（隔离 profile + 隐藏窗口）
```

设计要点：

- 默认只读；写操作必须先 `dryRun` 拿计划，再带 `confirm` 执行；
- 返回结构化 JSON（便于任何 agent 判断，而不是解析自然语言）；
- **无 shell 通道**——这是"允许 AI 自己调用"和"别让它乱搞"的平衡点。

---

## 11. 急救（rescue）

```
触发：面板按钮 / 托盘菜单 / `dsh-doctor rescue` / MCP 工具
流程：
  1. 共享状态体检（workspace.json 里有没有桌面当工作区、~/.dsh 是否可写）
  2. 找可用运行时（桌面端自带 node → 固定版本 CLI → npx）
  3. 用隔离 profile 起 web（隐藏窗口），随机高位端口（47000–48999，占用则 +1）
  4. 只绑 127.0.0.1 + token，自动打开默认浏览器
  5. 在面板留一条"这次是从桌面端逃过来的"记录
```

> 隔离是**相对的**：网页版与桌面端共享 `~/.dsh`（sessions / storages / credentials），
> 所以"换一条命"成立，"保险箱"不成立——启动前必须先做共享状态体检。

---

## 12. 外部 agent：最后一级

用户原话：DSH 自己就能派 Claude Code / Codex 的代理，所以外部 agent 只是"连这个都废了"时的兜底。

```
L0 面板 / CLI        ← 首选
L1 网页版逃生         ← 桌面端瘫痪时的主路径
L2 DSH 自己的子代理   ← DSH 半死、agent 还能跑时
L3 外部 agent + 我们的 MCP 工具  ← "云端都被自己报废了"时
```

L3 的实现：

- 外部 agent 只能调我们的 MCP 工具（§10），没有 shell、没有自由写盘；
- 同时提供 `rescue.md`（一页自然语言指令：现状 + 该做什么 + 验证 + 回滚），任何 agent 都能读；
- 我们的验证器负责验收它的结果。

---

## 13. 安全与回滚纪律

1. **默认只读**：`scan` / `report` / `diff` 不写盘。
2. **每个修复三步**：备份 → 最小改动 → 立刻验证；验证失败即报错，不返回"成功"。
3. **打印回滚命令**，并写入磁盘（不只是显示）。
4. **危险动作白名单**：catalog 只能表达 §9 的原语。
5. **不碰 app.asar、不改安装目录、不注册驱动/服务**。
6. **首次运行必须让用户确认"允许修复"开关**（否则只读）。

---

## 14. 里程碑

| 阶段 | 内容 | 验收 | 状态 |
| --- | --- | --- | --- |
| P0 | doctor-sys.exe：ACL 读写 + 标签 + 通知 + 端口探测 | 单元测试 + 手工在 VM 验证 | **v0.11.0 已落地**（`doctor-sys/`，零依赖 Rust，15 原语含 selftest，随 Release 分发） |
| P1 | core：检测器 + 修复器 + 快照（TS） | 现有 PowerShell 原型的检测逻辑迁移 | 进行中（插件 `plugin/lib/index.js` 承担；下一步：ACL 动作优先走 doctor-sys，PS 兜底） |
| P2 | 守护进程 + 原生通知（§5） | 杀 DSH 进程 → 10 s 内收到气泡 | `tools/watch.mjs` 原型；气泡改走 doctor-sys notify 待接 |
| P3 | DSH 插件面板（sidebar.panellist + main） | 面板能扫描、能修、能回滚 | **已落地**（`plugin/lib/client.js`） |
| P4 | MCP + rescue + 升级拦截器 | 外部 agent 能调通 4 个只读工具 | MCP/rescue 已落地；升级拦截器未做 |

> v0.1 现状注记（已过时）：PowerShell 单文件原型，验证"检测逻辑可行"。

---

## 15. 未决问题

1. 快照存 `~/.dsh/doctor/` 还是插件目录？（当前倾向 `~/.dsh/doctor/`，跨安装共存）
2. catalog 是否支持远程更新（签名 + 校验），还是只随版本发布？
3. 守护进程默认开机自启，还是装的时候问一次？
4. 托盘图标的"红点"与右下角系统托盘的冲突（Win11 会把新图标收进溢出区）。
5. 是否要在 P2 就上 WinRT toast（更原生）还是先 `NIF_INFO`（更稳）。
