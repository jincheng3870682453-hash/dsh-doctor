# 06 · 主题 / 模型 / MCP 配置全丢

## 症状

DSH 崩溃并自动修复后，浅色主题、模型 provider、MCP（local-rag 等）、effort-slider 配置全没了。

## 根因

崩溃自修复会清空 `cordis.patch.yml`（有些版本只留下一个空文件），而它正是这些配置的所在地。
原文件通常被留成 `cordis.patch.yml.bak-<毫秒>`。

## 修法

1. 找到最近一份 `cordis.patch.yml.bak-*`；
2. 先把当前的（空）文件另存为 `.empty-<ts>`；
3. 备份复制回 `cordis.patch.yml`；
4. 重启桌面端。

注意：恢复出来的旧配置里可能还引用着**已经被移除的插件**（例如 ponytail），恢复后要检查一次启动日志。

## 验证

重读文件大小 > 0；启动后主题/provider 回来。

## 对应

- `docs/traps.md` #10
- 检测：`patch-layer-missing`（有备份才算真丢）
- 修复：`restore-patch-layer`
