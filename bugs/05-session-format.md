# 05 · 会话打不开 / v4 格式拒收

## 症状

`format v4 message requires a producer-owned source kind`；
或只有打开某个老会话才炸，新会话正常。

## 根因

两条：

1. **插件实时注入旧写法**：`source: { kind: "plugin", plugin: "xxx" }` —— v4 明确拒收；
2. **老会话数据里带旧写法**，且 v3→v4 迁移表只收录了 5 个插件 id，实际出现过 12 个 → 迁移抛错。

区分法：**新会话也炸 = 插件在实时注入；只有老会话炸 = 老数据**。

## 修法

- 插件侧：改成 producer-owned kind（如 `effort-policy`、`skill-catalog`），重启；
- 数据侧：逐行改写 `{"kind":"plugin","plugin":"<id>"}`，备份 + 逐行 JSON 校验（医生只检测不改写，因为改会话出错会丢历史）。

## 验证

打开那个会话不再报错；`session-legacy-kind` 检查不再命中。

## 对应

- `docs/traps.md` #8 / #9
- 检测：`session-legacy-kind`（只读，zstd 解帧扫描）
