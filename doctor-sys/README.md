# doctor-sys · 底层原语引擎

> 设计文档 [docs/design.md §9](../docs/design.md) 的落地：**Rust、零第三方依赖、静态单文件**。
> 没有第三方 crate —— 全部 Win32 调用手写 FFI 声明，离线可构建（供应链风险为 0，D2 决策）。

## 它是什么

一个封闭动词表的系统原语引擎：安全描述符 / 完整性标签 / 进程 / 端口 / 外壳刷新 / 原生气泡通知 / 快照。
**没有 exec、没有 shell**——catalog 数据永远不能变成任意命令执行，这是安全边界（D6 决策）。

CLI / MCP / 插件 / 守护进程后续都内联调用它；今天它作为独立发行物先落地（P0 里程碑）。

## 协议：JSON over stdio，每个请求一个进程

```bash
# stdio 模式
echo '{"op":"acl-read","args":{"path":"C:\\Users\\user\\Desktop"}}' | doctor-sys.exe

# 命令行模式（等价，人用方便）
doctor-sys.exe acl-read --path "C:\Users\user\Desktop"
```

响应永远是单行 JSON：

```json
{"ok":true,"op":"acl-read","data":{"sddl":"O:...","owner":"S-1-5-21-...","integrity":"medium"}}
{"ok":false,"op":"acl-read","error":"路径不存在：..."}
```

## 原语表（15 个）

| 原语 | 参数 | 作用 |
|---|---|---|
| `acl-read` | `path` | 读 SDDL / owner / group / 完整性标签（只读） |
| `acl-save` | `path`, `file` | 把当前 SDDL 备份成 JSON |
| `acl-restore` | `file` | 从备份还原（owner/group 写不动时自动降级，见下） |
| `set-integrity-label` | `path`, `label`(low/medium/high), `recursive?` | 改强制完整性标签；recursive = (OI)(CI) 继承 |
| `remove-deny-ace` | `path`, `sid`（或 `everyone:true`） | 删指定 SID 的拒绝 ACE，其余保序 |
| `proc-list` | — | 全进程快照（pid / ppid / exe） |
| `proc-kill-tree` | `pid`, `dryRun?` | 按父子关系杀整棵树；拒绝杀 0/4/自己；dryRun 只列不杀 |
| `port-probe` | `port`, `host?`, `timeoutMs?` | TCP 连通探测 |
| `port-pid` | `port` | 谁在监听这个端口（GetExtendedTcpTable） |
| `shell-refresh` | `path?` | SHChangeNotify：给 path 刷那个目录，不给则全局关联刷新 |
| `quarantine-dir` | `path` | 目录改名隔离（`*.doctor-quarantine-<时间戳>`，重名自动 -2） |
| `snapshot-write` | `paths`（数组或分号分隔）, `destDir` | 拷贝快照 + manifest.json |
| `snapshot-restore` | `snapshotDir` | 按 manifest 还原；恢复前先把现状备份到 `restore-backup-*` |
| `notify` | `title`, `body`, `timeoutMs?` | 原生气泡（Shell_NotifyIconW NIF_INFO） |
| `selftest` | — | 自检：JSON 往返 / acl-read / port-probe / proc-list |

另有 `version` / `help`。

## 开发

```powershell
cargo build --release --manifest-path doctor-sys/Cargo.toml   # 产物约 250-350 KB，静态 CRT
cargo test  --release --manifest-path doctor-sys/Cargo.toml   # JSON 解析器单元测试
doctor-sys/target/release/doctor-sys.exe selftest
```

零依赖 = `cargo build` 不碰网络，也不需要 crates.io 镜像。

## 实测踩出来的三条 Windows 硬规则（写在这儿，别再踩）

1. **SACL 传 NULL 时 `SetNamedSecurityInfoW` 报 1299（ERROR_INVALID_LABEL）**。
   所以 acl-restore / remove-deny-ace 永远随行一个标签：备份有就用备份的，
   没有就沿用当前的，连当前都没有就带 medium（等于"无显式标签"的系统默认）。
2. **带 NULL 指针声明 DACL 位 = 把 DACL 清成"全员完全访问"**。
   权限位只在 SDDL 里真有该段且指针非空时才声明。
3. **重建 ACL 不走 InitializeAcl+AddAce**（对继承型 ACE 组合会报 122），
   直接在旧 ACL 字节流上紧凑拷贝、改头部 AclSize/AceCount（偏移 2-3 / 4-5）。

## 已知边界（如实说，不吹牛）

- **notify 在 DSH 沙箱内会被 UIPI 拒绝**（Win32 错误 5）：沙箱进程是 Low 完整性，
  给 Medium 的托盘发消息被隔离挡掉。在 Explorer 里双击运行（正常 Medium 上下文）即可用。
  stderr 会打出失败阶段，JSON 的 `shown:false` 如实反映。
- **reg-read / reg-write v1 未实现**：现有引擎用不到注册表，宁缺毋滥（设计文档 §9 已标注）。
- proc-kill-tree 用快照期父子关系近似"树"（原设计写的是 Job 对象，那只适用于自己 spawn 的进程）。
- 只有 Windows 实现；Unix 上原语表里 ACL / 标签 / 通知一类不适用。

## 接下来（P1+，见 docs/design.md 里程碑）

- 插件 host 在 `DSH_DOCTOR_SYS` 指定 doctor-sys.exe 时优先走它做 ACL 动作，PowerShell 兜底；
- MCP 工具直接代理原语表；
- `tools/watch.mjs` 的气泡通知换成本引擎的 notify。
