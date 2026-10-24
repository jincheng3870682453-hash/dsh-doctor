# 04 · `reading 'prepare'` 与 "is incompatible with dsh"

## 症状

两种报错，根子是同一个：

- `Cannot read properties of undefined (reading 'prepare')` —— 每轮对话都炸；
- `Plugin @deepseek-ai/dsh-tools@x is incompatible with dsh y` —— 桌面端起不来。

## 根因

插件把宿主包（`@deepseek-ai/dsh-tools`、`dsh-skill`、`schemastery`…）写进了自己的 `dependencies`。
pnpm 于是往 profile 的 `node_modules` 里装一份**真副本**：

- 同版本两份 → 两个 `Symbol("@deepseek-ai/dsh-tools.scheduler")`，拿到 `undefined`；
- **旧版本**一份 → 兼容性守卫禁用 `tools`，依赖它的 required 插件永远等不到 → 启动失败。

## 修法

1. 只挪走**副本本身**（`dsh-tools / dsh-skill / schemastery / dsh-util-values / cordis`），
   移到 `~/.dsh/dsh-doctor-backups/hostpkgs-<ts>/`；
2. **绝不整目录改名** —— 同目录里还有插件的合法依赖（曾经这么干过，差点让桌面端起不来，见 bugs/08）；
3. 重启桌面端。

## 验证

重扫不再有 `profile-host-duplicate`；启动无 `reading 'prepare'`。

## 对应

- `docs/traps.md` #5 / #14
- 检测：`profile-host-duplicate`、`plugin-host-dependency`
- 修复：`profile-host-dup`
