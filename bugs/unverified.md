# 疑似问题清单（未验证）

> 这一章放**"看起来会出问题、但还没复现/没拿到现场证据"**的条目。
> 和 [已确认图鉴](README.md) 分开：这里的内容**不当结论用**，只当排雷线索。
> 每条都写了「怎么验证」；验证后请按结果移进正式条目或删掉。

## 状态说明

| 标记 | 含义 |
|---|---|
| 疑似 | 有代码/文档依据，但没实测 |
| 半验证 | 在一种环境复现过，通用性未知 |
| 待现场 | 需要用户机器/特定版本才能验证 |

---

## U1. 第三方客户端插件「包名 ≠ 模块 id」会静默消失

- **状态**：半验证（我们自己复现过）
- **怀疑**：DSH 客户端模块按 manifest 包名标识浏览器模块；改了 npm 包名却没同步 `__ModuleLoader__.load({ id })` 时，宿主正常、UI 静默不注册。
- **影响**：图标/面板消失，而且插件列表显示"已启用、无报错"，极难排查。
- **验证**：装一个改了包名的测试插件，看 `sidebar.panellist` 是否有它；或直接跑 `bundle-identity-drift` 检查。
- **已有防护**：v0.13.3 起 `bundle-identity-drift`。

## U2. 复用 shipped 插槽 id 会被"覆盖"而不是追加

- **状态**：疑似
- **怀疑**：`sidebar.panellist` 等列表插槽按 id 寻址；第三方插件若用了和官方相同的 id，会替换该 cell 而不是新增。
- **影响**：官方入口被插件顶掉（用户以为"功能没了"）。
- **验证**：用官方已占用的 id（如 `plugins`）注册一个测试插件，观察是否替换。
- **提示**：插件文档明确建议用自有 id，但没强制。

## U3. 新版本插件把宿主包副本带回来（schemastery 等）

- **状态**：半验证（本次升级 subagent 插件时真实出现）
- **怀疑**：从 npm 装/升级官方插件时，pnpm 可能在 profile 里生成 `@deepseek-ai/schemastery` 真副本；两份包导致 `reading 'prepare'` / 兼容性守卫禁用。
- **影响**：装完插件 DSH 起不来或每轮报错。
- **验证**：`profile-host-duplicate` 检查（已实测能抓到 `schemastery`）；修法 `profile-host-dup`。
- **提示**：升级插件后建议立刻体检一次。

## U4. runtime.json 过期误导版本判断

- **状态**：已验证（本机 rc.3 仍写 rc.2）
- **怀疑**：桌面端更新后 `~/.dsh/dsh-runtimes/dsh-primary-runtime/runtime.json` 不刷新。
- **影响**：读它判断版本的工具/插件会误判（例如把 rc.3 当 rc.2）。
- **验证**：`runtime-metadata-stale` 检查；或对比 `runtime.json` 与 `resources/app.asar` 的 `package.json`。
- **说明**：暂只报告，不自动改（属 DSH 托管文件）。

## U5. 从 npm 安装后桌面端不会自动启用

- **状态**：待现场
- **怀疑**：桌面端插件安装由 Electron 应用管理；`npm install` 只写依赖，不会改 `dsh.profile.bundles`。
- **影响**：用户 `npm install dsh-doctor-plugin` 后以为装好了，实际界面没出现。
- **验证**：干净 profile 里 `npm install` 后看插件列表是否出现、侧边栏是否有图标。
- **建议**：文档只把 npm install 作为"依赖方式"，主推应用内安装（已如此写）。

## U6. macOS / Linux 发行包未实机验证

- **状态**：待现场
- **怀疑**：Unix 包/启动脚本只在 CI 容器里跑过 `scan`，没在真机桌面环境验证窗口/权限行为。
- **影响**：macOS Gatekeeper、`chmod +x`、XDG 目录等可能出问题。
- **验证**：找真机跑 `dsh-doctor-unix.tar.gz`，反馈报错。

## U7. 逃生锁 2 分钟过期 vs npx 首次下载 3 分钟

- **状态**：疑似
- **怀疑**：`rescue.lock` 过期时间 3 分钟，与 npx 等待上限对齐；若 npx 卡满 3 分钟，锁可能先过期，另一个窗口可再起一个实例。
- **影响**：极端情况下出现两个逃生实例（第二个会抢端口失败）。
- **验证**：断网/慢网环境连点两次「起网页版」，观察是否两实例。
- **已有防护**：端口随机 + 复用登记；影响有限。

## U8. entry customization「创建你的插件」缺 Creator 预设会失败

- **状态**：疑似（官方 README 已注明限制）
- **怀疑**：新功能依赖 Creator 预设创建会话；没有该预设时会话创建失败并弹 workspace 通知。
- **影响**：用户点「创建你的插件」没反应/报错。
- **验证**：删掉/停用 Creator 预设后点一次。
- **说明**：不是我们的 bug，但可作为 FAQ。

## U9. View 的 pin 只在内存，重载后丢失

- **状态**：疑似（官方 README 已注明）
- **怀疑**：rc.3 新增会话 View 折叠，pin 状态不落盘，插件重载/重启恢复默认。
- **影响**：用户以为设置没保存。
- **验证**：pin 一个 View 后重启桌面端观察。
- **说明**：官方行为，不是 bug，可写进 FAQ。

## U10. More 菜单在桌面端会上报埋点

- **状态**：疑似（官方 README 写了 desktop analytics 事件）
- **怀疑**：`more_menu_item_click`、`send_button_click`（带 preset 类别）等事件在 Desktop 上报。
- **影响**：隐私敏感用户可能在意。
- **验证**：断网抓包 / 查 analytics 设置是否可关。

## U11. `bundle-identity-drift` 只扫 client 文件前 4KB

- **状态**：已知局限
- **怀疑**：模块 id 如果在 client 文件更靠后（压缩/包装差异），检查会漏。
- **影响**：漏报，不会误报。
- **验证**：构造 id 在 4KB 之后的假插件。

## U12. `runtime-metadata-stale` 依赖 asar 路径

- **状态**：已知局限
- **怀疑**：只有 Electron 宿主能读 `resources/app.asar`；asar 路径/文件名变化时检查静默跳过。
- **影响**：漏报。
- **验证**：非 Electron 环境跑 scan，应不误报。

---

## 怎么把条目转正

1. 复现并抓到现场（命令输出 / 截图 / 日志）；
2. 写清根因和修法；
3. 移到 [正式图鉴](README.md) 对应编号，并把这里删掉；
4. 如果医生能自动检测/修复，补一条检查（见 [CONTRIBUTING](../CONTRIBUTING.md)）。
