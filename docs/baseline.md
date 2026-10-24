# 基线：什么算"标准 DSH"

医生的**环境差异报告**会把用户机器与 [`baseline/expected.json`](expected.json) 比较，输出：

1. **环境快照**（版本、目录、profile、依赖、进程、崩溃日志数量）；
2. **差异列表**（与基线不符的地方，按严重度）；
3. **后端报错摘录**（崩溃日志首行、致命错误原文）；
4. **提交信息**（生成桌面 MD，用户可直接提 issue/PR）。

## 基线包含什么

| 类别 | 基线判断 |
|---|---|
| 运行时 | Node 主版本、Electron 主版本（只记录，不硬卡） |
| profile | 必须含 `dsh-base` / `dsh-web-app`；`dependencies` 不得含宿主包；`node_modules` 顶层不得出现宿主包副本 |
| 工作区 | 不得注册用户目录 / 桌面 / 文档 / 下载 / 盘根 |
| 桌面完整性 | 必须是 Medium（Low 会让图标变白） |
| patch 层 | `cordis.patch.yml` 不应为空（除非从未配置过） |
| 会话 | 不应出现 v4 拒收的 `kind:"plugin"` |
| 崩溃日志 | 记录数量与最近首行，作为"后端报错"证据 |

## 为什么不硬卡版本号

DSH 是 nightly 通道，版本每天都在动。基线只判断**结构性问题**（副本、越权工作区、权限降级），
版本号只作为快照记录，方便维护者对照。

## 报告怎么用

```
node dsh-doctor.mjs diff        # CLI：生成差异报告并写到桌面
dsh-doctor.exe diff             # Windows EXE：同上（无 Node 环境）
```

面板页脚也有「环境差异报告」按钮。

拿到桌面上的 `dsh-doctor-环境差异-<时间>.md` 后：

- 想求助：把内容贴到 issue / 浏览器里的 AI；
- 想贡献：按 [CONTRIBUTING.md](../CONTRIBUTING.md) 整理成 bug 图鉴条目或检查包；
- **提交前自己看一眼**：里面含本机路径和用户名。
