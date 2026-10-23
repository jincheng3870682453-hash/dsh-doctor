#Requires -Version 5.1
# 急救箱交互菜单。由 build-exe.ps1 和其它 lib 文件拼接后内嵌进 dsh-doctor.exe。
# 不依赖 DSH / Node / 网络；只用 Windows 自带的 PowerShell 与系统命令。

function Show-RescueBanner {
    Write-Host ''
    Write-Host '   DSH 私人医生 · 急救箱' -ForegroundColor Cyan
    Write-Host '   （独立运行：不需要 DSH，不需要 Node，不需要联网）' -ForegroundColor DarkGray
    Write-Host ''
}

function Get-RescueBackups {
    $items = New-Object System.Collections.ArrayList
    $home = Get-DshHome
    $aclDir = Join-Path $home 'dsh-doctor-backups'
    if (Test-Path -LiteralPath $aclDir) {
        foreach ($file in @(Get-ChildItem -LiteralPath $aclDir -Filter 'desktop-acl-*.txt' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
            [void]$items.Add([pscustomobject]@{ Kind = 'acl'; Path = $file.FullName; Label = ('桌面 ACL 备份 · ' + $file.LastWriteTime.ToString('MM-dd HH:mm')) })
        }
    }
    $storages = Join-Path $home 'storages'
    if (Test-Path -LiteralPath $storages) {
        foreach ($file in @(Get-ChildItem -LiteralPath $storages -Filter 'workspace.json.bak-*' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
            [void]$items.Add([pscustomobject]@{ Kind = 'workspace'; Path = $file.FullName; Label = ('工作区注册表备份 · ' + $file.LastWriteTime.ToString('MM-dd HH:mm')) })
        }
    }
    $profilesRoot = Join-Path $home 'profiles'
    if (Test-Path -LiteralPath $profilesRoot) {
        foreach ($profile in @(Get-ChildItem -LiteralPath $profilesRoot -Directory -ErrorAction SilentlyContinue)) {
            foreach ($file in @(Get-ChildItem -LiteralPath $profile.FullName -Filter 'cordis.patch.yml.bak-*' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
                [void]$items.Add([pscustomobject]@{ Kind = 'patch'; Path = $file.FullName; Label = ('patch 层备份 [' + $profile.Name + '] · ' + $file.LastWriteTime.ToString('MM-dd HH:mm')) })
            }
            foreach ($dir in @(Get-ChildItem -LiteralPath $profile.FullName -Directory -Filter '*.stale-*' -Recurse -Depth 3 -ErrorAction SilentlyContinue)) {
                [void]$items.Add([pscustomobject]@{ Kind = 'quarantine'; Path = $dir.FullName; Label = ('已隔离的副本 [' + $profile.Name + '] · ' + $dir.Name) })
            }
        }
    }
    return $items.ToArray()
}

function Restore-RescueBackup {
    param([Parameter(Mandatory)]$Item)
    switch ($Item.Kind) {
        'acl' {
            $desktop = [Environment]::GetFolderPath('Desktop')
            $parent = Split-Path -Parent $desktop
            $result = Invoke-DoctorProcess -FilePath 'icacls.exe' -Arguments @($parent, '/restore', $Item.Path)
            if ($result.ExitCode -ne 0) { Write-DoctorError ('还原失败：' + $result.Output); return }
            Write-DoctorInfo '桌面 ACL 已还原。建议重启资源管理器。'
        }
        'workspace' {
            $target = Join-Path (Get-DshHome) 'storages\workspace.json'
            Copy-Item -LiteralPath $Item.Path -Destination $target -Force
            Write-DoctorInfo '工作区注册表已还原，重启桌面端后生效。'
        }
        'patch' {
            $profileDir = Split-Path -Parent $Item.Path
            Copy-Item -LiteralPath $Item.Path -Destination (Join-Path $profileDir 'cordis.patch.yml') -Force
            Write-DoctorInfo ('patch 层已还原：' + $profileDir + '，重启桌面端后生效。')
        }
        'quarantine' {
            $parent = Split-Path -Parent $Item.Path
            $name = Split-Path -Leaf $Item.Path
            $restored = $name -replace '\.stale-\d+$', ''
            Rename-Item -LiteralPath $Item.Path -NewName $restored -ErrorAction SilentlyContinue
            Write-DoctorInfo ('已还原为：' + $restored + '（重启桌面端生效）')
        }
        default { Write-DoctorWarn '未知的备份类型。' }
    }
}

function Start-RescueWeb {
    $command = Get-Command dsh -ErrorAction SilentlyContinue
    if (-not $command) {
        Write-DoctorError 'PATH 里没有 dsh 命令，无法启动网页版。'
        Write-DoctorInfo '可以改用：npx @deepseek-ai/dsh@latest web'
        return
    }
    $port = Get-Random -Minimum 47000 -Maximum 48999
    $url = 'http://127.0.0.1:' + $port + '/'
    $source = [string]$command.Source
    Write-DoctorStep ('启动网页版：' + $source + ' web --port ' + $port)
    if ($source -match '\.(cmd|bat)$') {
        Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', ('"' + $source + '"'), 'web', '--port', [string]$port) -WindowStyle Hidden
    } else {
        Start-Process -FilePath $source -ArgumentList @('web', '--port', [string]$port) -WindowStyle Hidden
    }
    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
        Start-Sleep -Milliseconds 500
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -lt 500) {
                Write-DoctorInfo ('网页版已启动：' + $url)
                Start-Process $url
                return
            }
        } catch { }
    }
    Write-DoctorWarn '30 秒内没起来。首次运行可能需要下载依赖，稍等再试，或手动执行上面的命令。'
}

function Show-RescueRollbackMenu {
    $items = @(Get-RescueBackups)
    if ($items.Count -eq 0) { Write-DoctorInfo '没有找到任何备份。'; return }
    Write-Host ''
    for ($index = 0; $index -lt $items.Count; $index += 1) {
        Write-Host ('   ' + ($index + 1) + ') ' + $items[$index].Label)
    }
    Write-Host '   0) 返回'
    $choice = Read-Host '   选择要还原的备份'
    if ($choice -eq '0' -or [string]::IsNullOrWhiteSpace($choice)) { return }
    $position = 0
    if (-not [int]::TryParse($choice, [ref]$position)) { return }
    if ($position -lt 1 -or $position -gt $items.Count) { return }
    Restore-RescueBackup -Item $items[$position - 1]
}

function Invoke-RescueScan {
    $findings = @(Invoke-DoctorScan)
    Show-DoctorFindings -Findings $findings
}

function Invoke-RescueMenu {
    while ($true) {
        Show-RescueBanner
        Write-Host '   1) 体检（只读，不改任何东西）'
        Write-Host '   2) 修桌面图标变白（改回 Medium + 摘掉拒绝项）'
        Write-Host '   3) 移除危险工作区（桌面 / 用户目录 / 盘根）'
        Write-Host '   4) 隔离 profile 里的宿主包副本'
        Write-Host '   5) 恢复被清空的 cordis.patch.yml'
        Write-Host '   6) 从备份回滚'
        Write-Host '   7) 起网页版（逃生）'
        Write-Host '   0) 退出'
        Write-Host ''
        $choice = Read-Host '   选择'
        try {
            switch ($choice) {
                '1' { Invoke-RescueScan }
                '2' { Repair-DoctorDesktopLabel -RestartExplorer }
                '3' {
                    $targets = @(Invoke-DoctorScan | Where-Object { $_.Id -eq 'workspace-risky-path' } | ForEach-Object { $_.Path } | Select-Object -Unique)
                    if ($targets.Count -eq 0) { Write-DoctorInfo '没有发现危险的工作区注册。' }
                    else { Remove-DoctorWorkspaceEntries -Paths $targets -Yes }
                }
                '4' { Repair-DoctorProfileHostDup -Yes }
                '5' { Repair-DoctorPatchLayer }
                '6' { Show-RescueRollbackMenu }
                '7' { Start-RescueWeb }
                '0' { return }
                default { Write-DoctorWarn '无效的选择。' }
            }
        } catch {
            Write-DoctorError ('操作失败：' + $_.Exception.Message)
        }
        Write-Host ''
        Read-Host '   按回车继续'
    }
}

if ($env:DSH_DOCTOR_EXE_ARGS -eq 'scan') {
    Invoke-RescueScan
} elseif ($env:DSH_DOCTOR_EXE_ARGS -eq 'fix-desktop') {
    Repair-DoctorDesktopLabel
} else {
    Invoke-RescueMenu
}
