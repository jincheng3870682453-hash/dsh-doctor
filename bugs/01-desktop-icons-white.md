# 01 · 桌面图标全变白纸

## 症状

桌面上的快捷方式、文件夹全部变成白色空白图标；"此电脑 / 回收站 / Edge" 这些系统项正常。
删图标缓存、`ie4uinit -show`、重建 thumbcache、重启电脑都无效。

## 根因

DSH 把桌面注册成了工作区。每次给工作区授沙箱写权限时，会在桌面上盖三件套：

```
S-1-4-xxx:(OI)(CI)(W,D,DC)            ← 能力 ACE，放行写入
Everyone:(CI)(DENY)(DC)               ← 拒绝删除，永不回收
Mandatory Label\Low:(OI)(CI)(NW)      ← 元凶：桌面被降成低完整性
```

Explorer 在低完整性目录里取不到图标 → 全部变白。

## 修法

1. `icacls "<桌面>" /save <备份>` 先备份；
2. `icacls "<桌面>" /setintegritylevel '(OI)(CI)Medium'`；
3. `icacls "<桌面>" /remove:d '*S-1-1-0'`；
4. `SHChangeNotify(SHCNE_ASSOCCHANGED)` 让外壳重新取图标；
5. **断根**：把桌面从 `workspace.json` 里的工作区注册移除（优先走 `workspaceRegistry.delete`）。

## 验证

重读桌面 SDDL，确认不再含 `S:(ML;;…;;;LW)`；图标应立即恢复。

## 对应

- `docs/traps.md` #1、#2
- 修复动作：`desktop-label`、`workspace-entry`
- 提交：v0.1.0 起
