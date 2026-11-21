# 13 · 插件安装 EPERM：profile 目录被 Codex 沙箱锁死

## 症状

插件市场里安装任何插件都失败：

```
EPERM: operation not permitted, open
'C:\Users\<你>\.dsh\profiles\desktop\node_modules\<插件名>\package.json'
```

- 删 Cookies、重装 DSH、重装该插件都没用；
- 出问题的目录在资源管理器里能看到，但打不开；
- **普通用户、管理员、甚至 SYSTEM 全部 Access denied**；
- `takeown` / `icacls /reset` / `rd /s /q` 也都被拒绝。

## 根因

Codex（ChatGPT 桌面版的 `OpenAI.Codex` MSIX 包）会带一个
`codex-windows-sandbox-service.exe` / `CodexSandboxService.OpenAI.Codex` 沙箱服务。
它用 Windows 的 **AppContainer + bindflt（绑定过滤驱动）** 把 `~/.dsh/profiles/...` 之类的宿主路径映射进沙箱。

沙箱进程退出后，**bind 映射没有随进程清理**，目录就变成：

- 外面看还在；
- 内核层面只认沙箱那边的 bind 目标，连 SYSTEM 都打不开；
- pnpm 去读 `package.json` → EPERM → 插件安装失败。

这不是 pnpm、也不是 DSH 权限预设的错，是 **沙箱残留的内核级锁**。只有重启（释放 bindflt 映射）或卸载沙箱后才能清掉。

## 医生怎么认

`profile-entry-locked`（v0.14.6，插件 + EXE）：

- 扫 `~/.dsh/profiles/*/node_modules` 顶层；
- 某个目录 `readdir` 报 `EACCES/EPERM` → **高危**；
- 提示里直接写：Codex/AppContainer bindflt 残留、pnpm 会 EPERM、需要重启后管理员清理。

## 怎么修

1. 卸载 Codex / ChatGPT 桌面版（PowerShell）：
   ```powershell
   Get-AppxPackage OpenAI.Codex | Remove-AppxPackage
   ```
2. 停用沙箱服务（管理员）：
   ```powershell
   sc.exe stop CodexSandboxService.OpenAI.Codex
   sc.exe config CodexSandboxService.OpenAI.Codex start= disabled
   ```
3. **重启电脑**（bindflt 映射只有重启能释放）；
4. 重启后管理员执行：
   ```powershell
   $p = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\<插件名>"
   takeown /f $p /r /d y
   icacls $p /reset /t /c /q
   rmdir /s /q $p
   ```
5. 打开 DSH，重新安装插件。

如果不想手动删，可以让医生在开机时自动清（v0.14.6 说明里给了任务脚本）。

## 对应

- 检查：`profile-entry-locked`
- 版本：v0.14.6
- 相关：`profile-host-duplicate`（宿主包副本）、`plugin-boot-failure`
