# dsh-doctor 检查包协议 v1

> 贡献者只需要写 **JSON 数据**，不用写代码。医生负责读、跑、展示。
> 目的：任何人在 DSH 上踩到一个坑，都可以写一个检查包交给社区，不需要改引擎。

---

## 1. 检查包放在哪

```
%USERPROFILE%\.dsh\dsh-doctor\checks\*.json
```

放进去之后，下一次「重新体检」就会自动加载（不需要重启 DSH）。

---

## 2. 一个检查包长什么样

```json
{
  "protocolVersion": 1,
  "id": "example-pack",
  "title": "示例：我自己踩过的坑",
  "checks": [
    {
      "id": "workspace-on-desktop",
      "title": "工作区注册到了桌面",
      "severity": "high",
      "detail": "每次授沙箱权限都会把桌面降成低完整性，图标会变白。",
      "detect": { "type": "workspace-risky-path" },
      "fix": { "type": "workspace-entry" }
    }
  ]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `protocolVersion` | ✅ | 固定 `1` |
| `id` | ✅ | 包标识（小写、连字符） |
| `title` | ✅ | 人话标题，面板里会显示 |
| `checks[]` | ✅ | 检查项数组 |
| `checks[].id` | ✅ | 检查项标识（全局唯一，建议带包前缀） |
| `checks[].title` | ✅ | 这一条问题的人话标题 |
| `checks[].severity` | ✅ | `high` / `medium` / `low` |
| `checks[].detail` | 建议 | 为什么出问题、怎么理解 |
| `checks[].detect` | ✅ | 检测方式，见 §3 |
| `checks[].fix` | 可选 | 修复方式，见 §4 |

---

## 3. 检测原语（`detect.type`）

所有路径都支持变量：`{{dshHome}}`、`{{desktop}}`、`{{profiles}}`、`{{sessions}}`、`{{appData}}`。

| `type` | 额外参数 | 作用 |
| --- | --- | --- |
| `workspace-risky-path` | — | 注册表里有没有桌面/用户目录/盘根这类危险工作区 |
| `desktop-low-label` | — | 桌面是否被打了 Low 完整性标签 |
| `profile-host-duplicate` | — | profile 里有没有宿主包副本 |
| `desktop-session-activity` | — | 有没有会话把桌面当工作区（闪烁的根源） |
| `crash-logs` | — | 崩溃日志数量与最近时间 |
| `session-legacy-kind` | — | 会话文件里有没有 v4 拒收的 `kind:"plugin"` 旧写法（只读） |
| `credentials-version` | — | credentials 文件版本是否缺失/不符 |
| `patch-layer-missing` | — | `cordis.patch.yml` 是否被崩溃自修复清空（有备份才算） |
| `path-dead-dsh` | — | PATH 里有没有指向不存在文件的 `dsh` 命令 |
| `workspace-not-writable` | — | 工作区真的写不进去（会真写一个临时文件再删） |
| `workspace-not-grantable` | — | Windows：owner 不是你、也没有 WRITE_DAC，DSH 授不了沙箱权限 |

> 平台说明：`desktop-low-label` 只在 Windows 有；macOS/Linux 上桌面检查换成 `desktop-world-writable`（POSIX 权限位）。其余原语三平台通用。
| `acl` | `path`、`test`（`low-label` / `everyone-deny`） | 任意目录的 ACL 判定 |
| `file-regex` | `path`、`pattern`、`maxFiles`（≤2000，默认 400） | 在目录里递归找匹配的文件 |
| `dir-contains` | `path`、`names[]` | 目录里是否包含指定子目录名 |

**约束**：检测**只读**，不写盘、不执行命令。正则必须是打不开的（禁止灾难性回溯的写法），文件数有上限。

---

## 4. 修复原语（`fix.type`）

只有下面这几个**内置**动作，检查包不能发明新的：

| `fix.type` | 作用 |
| --- | --- |
| `desktop-label` | 桌面完整性标签改回 Medium + 摘掉 Everyone 拒绝项（有备份） |
| `workspace-entry` | 把危险工作区从注册表移除（优先走 DSH 服务，会话文件保留） |
| `profile-host-dup` | 把 profile 里的宿主包副本改名隔离（可还原） |
| `restore-patch-layer` | 从最近备份恢复被清空的 `cordis.patch.yml`（先备份当前状态） |
| `workspace-acl` | 给当前账号补工作区完全控制（先备份 ACL，改完复测可写） |
| （省略 `fix`） | 只报告，不提供修复按钮 |

**没有 shell、没有任意命令、没有注册表任意写**——这是安全边界，不接受例外的 PR。

---

## 5. 提交检查包的流程

1. 在 `$DSH_HOME\dsh-doctor\checks\` 放一个 `.json`；
2. 点面板「重新体检」，确认这条能被识别、且只在你预期的机器状态下触发；
3. 向仓库提 PR：把你的包放进 `examples/checks/`，并在 `docs/traps.md` 里加一条现象与根因；
4. PR 里附上：触发时的证据（命令 + 原始输出）、`protocolVersion`、以及"误报风险"说明。

---

## 6. 版本与兼容

- 协议版本不兼容时，老检查包会被跳过并在面板里标 `pack-error`，不会让整个面板挂掉；
- 引擎新增检测原语时会升 `protocolVersion`，旧包继续可用；
- 检查包不允许引用未声明的字段——未知字段会被忽略，不会报错。

---

## 7. 为什么这样设计

- **数据而不是代码**：贡献者不需要懂 Node/PS，也不需要被信任执行任意代码；
- **可审计**：一个 JSON 文件能一眼看完，社区审核成本低；
- **可回滚**：每个修复都走内置实现，天然带备份与复检；
- **版本无关**：检查包描述的是"状态"，不是"DSH 内部实现"。
