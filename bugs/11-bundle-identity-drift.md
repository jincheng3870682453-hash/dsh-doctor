# 11 · 改了 npm 包名后，侧边栏图标和面板消失

## 症状

- 侧边栏的「私人医生」图标不见了，主面板也点不出来；
- 但插件列表里 bundle 仍是**已启用、无报错**；
- 宿主功能还活着：`GET /dsh-doctor/status` 正常返回，CLI 体检也正常。

"DSH 一更新，插件位置就被挤掉了"——其实和更新本身无关，是包名改过之后标识没同步。

## 根因

DSH 的客户端模块系统用**包的 manifest name** 标识浏览器模块：

> `client-modules`: The manifest package name identifies the browser module.

为了上 npm，包名从 `dsh-doctor` 改成了 `dsh-doctor-plugin`，但：

- `plugin/cordis.patch.yml` 的 `name` 还是 `dsh-doctor`；
- `plugin/lib/client.js` 里 `window.__ModuleLoader__.load({ id: 'dsh-doctor' })` 还是旧名。

宿主半边按 loader 行 id 加载，能跑；浏览器半边按包名查找模块，id 对不上 → **静默不注册**（没有明显报错），于是图标和面板消失。

## 修法

1. `cordis.patch.yml`：`id` 与 `name` 都用当前包名（`dsh-doctor-plugin`）；
2. `lib/client.js`：`window.__ModuleLoader__.load({ id: 'dsh-doctor-plugin' })`；
3. 把旧 bundle 移除，再按目录/包名重新安装；
4. 验证客户端 Slots：`sidebar.panellist` 里有你的 id、`main` 里有你的 key，且 `active: true`。

## 验证

```powershell
# 客户端注册
#   cordis_inspect_query client/Slots listSubTree  root=sidebar.panellist  → 出现 dsh-doctor
#   cordis_inspect_query client/Slots listSubTree  root=main               → key dsh-doctor
# 宿主接口
Invoke-RestMethod http://127.0.0.1:<port>/dsh-doctor/status
```

## 预防

医生 v0.13.3 起有 `bundle-identity-drift` 检查：依赖名 ≠ 包名、或 client 模块 id ≠ 包名时直接报高危。

## 对应

- `docs/traps.md` #15
- 检测：`bundle-identity-drift`
- 版本：v0.13.3
