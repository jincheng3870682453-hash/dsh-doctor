# DSH Doctor · DSH 私人医生（插件包）

**只要是 DSH 引起的毛病，无论什么奇葩症状，我都能治好。点一下修复。**

DSH 桌面端的底层运行时急救箱：专治标签损坏 / 进程失控导致的图标变白、屏闪、白屏与启动崩溃。

## 先装插件（DSH 还能启动时）

侧边栏 → **插件** → **添加**，在「添加插件」对话框里直接填包名：

```
dsh-doctor-plugin
```

装完默认启用，侧边栏出现「私人医生」；没立即生效就重启一次 DSH。

> 桌面端（`desktop` profile）的插件安装由 Electron 应用自己管理，命令行装不了——用上面的对话框装。
> 非桌面 profile：`dsh plugin --profile web add dsh-doctor-plugin`。

## DSH 已经起不来？下载急救包（只认这 3 个文件）

到 [Releases](https://github.com/jincheng3870682453-hash/dsh-doctor/releases) 下载，**不需要 Node，也不需要 DSH 能启动**：

| 你的系统 | 下载哪个 | 怎么用 |
|---|---|---|
| Windows | **`dsh-doctor.exe`** | 双击 → 选 `1` 体检 / `2` 修桌面图标 / `7` 起网页版 / `8` 生成报告 |
| Windows（连 Node 都没有） | **`dsh-doctor-env-win-x64.zip`** | 解压 → 双击 `start.cmd`（自带 Node） |
| Linux / macOS | **`dsh-doctor-unix.tar.gz`** | 解压 → `./dsh-doctor.sh`（需要 Node ≥18） |

就这三样。不要再去翻别的文件：`doctor-sys.exe` / `dsh-doctor-native.exe` 是内部组件，不再作为下载项发布。

> 写文件、改权限请**在桌面双击运行**；在 DSH 沙箱终端里跑可能被限制（EXE 会提示手动复制）。

## 它做什么

- **查**：体检状态，每条带路径与原始证据，默认只读；
- **修**：一键修复，先备份 → 改最小 → 立刻复检，失败就还原；
- **守**：后台每 30 秒巡逻桌面完整性标签，并自动隔离 profile 里重复的宿主包；
- **报**：生成给 AI 的求助报告 / 环境差异报告（自动脱敏，可直接提 issue 或发给任何 AI）；
- **逃**：修不好时起隔离端口的网页版 DSH 接手。

## 安全

- 默认只读；每个修复先备份、改完复检，失败自动还原；
- 没有 shell 通道：社区检查包只能声明「检测原语 + 内置修复 id」；
- 不碰 DSH 安装目录、不注册服务/驱动；改动均可回滚。

## 更多

完整文档、Bug 图鉴、贡献者名单：[仓库首页](https://github.com/jincheng3870682453-hash/dsh-doctor)。

MIT · 非官方项目，与深度求索无关
