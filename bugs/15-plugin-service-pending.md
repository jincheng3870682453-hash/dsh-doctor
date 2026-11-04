# 15 · `web boot: entry did not activate` / 插件 pending 等一个不存在的服务

## 症状

启动失败对话框：

```
应用无法启动或已意外停止。
web boot: 1 entry did not activate
dsh-drawio: pending (waiting for service: betterSidebar)
```

- 删 Cookies、重装 DSH 都没用；
- 点「禁用第三方插件、备份 profile patch 并重启」才能进；
- 常见于：装了一个插件，但它依赖的「提供服务的插件」没装、被禁用，或 plugin 文件夹被误删。

## 根因

Cordis 插件之间通过 service 注入协作。`dsh-drawio` 声明需要 `betterSidebar` 服务，
但提供这个服务的插件（比如 `dsh-better-sidebar`）不在当前 profile 里/没启用，
于是 `dsh-drawio` 永远处于 `pending`，`web boot` 就报 `entry did not activate`，宿主起不来。

误删 profile 下的插件文件夹、卸载提供者插件、或 patch 里漏了 provider 都会触发。

## 医生怎么认

**`plugin-service-pending`**（v0.14.9，插件 + EXE）：

- 扫桌面端 `crash-*-web-boot.log`；
- 匹配 `<插件>: pending (waiting for service: <服务>)`；
- 直接报**高危**，并说明：装回/启用提供者插件，或先禁用依赖方。

## 怎么修

1. 装回/启用提供 `<服务名>` 的插件（本例是 `betterSidebar` 的提供者）；
2. 或者不要这个功能：在启动失败对话框点「禁用第三方插件、备份 profile patch 并重启」，再禁用/移除 `<插件名>`；
3. 如果只是插件文件夹被误删：从插件市场重装它（数据在独立位置，不会丢会话）。

## 对应

- 检查：`plugin-service-pending`
- 版本：v0.14.9
