# 14 · 工作区目录被删/改名后，会话报 working-directory 不存在

## 症状

会话打开后本轮运行失败，红字：

```
working-directory: directory does not exist: "D:\APP\dsh\project"
```

- 不是模型/插件报错，换模型也没用；
- 重新打开会话、重启 DSH 都还在；
- 常见于：把项目文件夹改名/移动/删掉，或者从别的机器同步了 `workspace.json`。

## 根因

DSH 的 `~/.dsh/storages/workspace.json` 里还登记着这个工作区：

```json
tables.workspaces.<id>.path = "D:\\APP\\dsh\\project"
```

但磁盘上这个目录已经不存在。会话启动时要切到该工作目录，于是直接失败。

## 医生怎么认

**`workspace-missing`**（v0.14.8，插件 + EXE）：

- 读 `workspace.json` 的 `tables.workspaces.*.path`；
- 路径不存在 → **高危**；
- 说明里直接给报错原文和恢复方式。

## 怎么修

1. 面板里点「一键修复」（`create-workspace-dir`）：按注册表原路径把空目录建回来；
2. 如果项目是被移动/改名了：把内容移回原路径，或在工作区设置里重新指向新目录；
3. 如果这个工作区已经彻底废弃：删掉 `workspace.json` 里对应记录（或用医生的 `workspace-entry` 修复处理危险路径）。

> 注意：第一步建的是空目录，项目内容需要你自己放回去；医生不会替你恢复文件。

## 对应

- 检查：`workspace-missing`
- 修复：`create-workspace-dir`
- 版本：v0.14.8
