# 03 · 工作区授不了权限 / 一开终端就报错

## 症状

`SetNamedSecurityInfoW failed (Win32 5): grantWrite(<路径>)`；
一开终端就报错、Node 起不来、会话无法启动。另一个 agent 会话声称"ACL 坏了"，而医生一开始没有任何表示。

## 根因

DSH 授沙箱权限需要对该目录有 **WRITE_DAC**：要么 owner 是当前用户（隐式拥有），要么 ACL 里给当前用户
`更改权限`。两者都没有时，`SetNamedSecurityInfoW` 直接 Access Denied。

注意：**"我能写文件" ≠ "DSH 能授权"** —— 这是医生早期的盲区，只做写测试会漏掉这类。

## 修法

1. `icacls /save` 备份；
2. `icacls "<目录>" /grant "*<当前用户SID>:(OI)(CI)F" /C`；
3. 重新写一个探针文件，**真写成功才算修好**。

## 验证

重扫时不再出现 `workspace-not-writable` / `workspace-not-grantable`；终端能开。

## 对应

- 检测：`workspace-not-writable`、`workspace-not-grantable`
- 修复：`workspace-acl`
- 版本：v0.5.3（盲区发现）、v0.8.1（探针清理）
