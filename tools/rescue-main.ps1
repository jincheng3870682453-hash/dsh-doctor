#Requires -Version 5.1
# 急救箱交互菜单。由 build-exe.ps1 和其它 lib 文件拼接后内嵌进 dsh-doctor.exe。
# 不依赖 DSH / Node / 网络；只用 Windows 自带的 PowerShell 与系统命令。

function Show-RescueBanner {
    Write-Host ''
    Write-Host '   DSH 私人医生 · 急救箱' -ForegroundColor Cyan
    Write-Host '   （独立运行：不需要 DSH，不需要 Node，不需要联网）' -ForegroundColor DarkGray
    Write-Host '   写文件/改权限请在桌面或资源管理器里双击运行；在 DSH 沙箱终端里跑可能被限制。' -ForegroundColor DarkGray
    Write-Host ''
}

function Get-RescueBackups {
    $items = New-Object System.Collections.ArrayList
    $doctorHome = Get-DshHome
    $aclDir = Join-Path $doctorHome 'dsh-doctor-backups'
    if (Test-Path -LiteralPath $aclDir) {
        foreach ($file in @(Get-ChildItem -LiteralPath $aclDir -Filter 'desktop-acl-*.txt' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
            [void]$items.Add([pscustomobject]@{ Kind = 'acl'; Path = $file.FullName; Label = ('桌面 ACL 备份 · ' + $file.LastWriteTime.ToString('MM-dd HH:mm')) })
        }
    }
    $storages = Join-Path $doctorHome 'storages'
    if (Test-Path -LiteralPath $storages) {
        foreach ($file in @(Get-ChildItem -LiteralPath $storages -Filter 'workspace.json.bak-*' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
            [void]$items.Add([pscustomobject]@{ Kind = 'workspace'; Path = $file.FullName; Label = ('工作区注册表备份 · ' + $file.LastWriteTime.ToString('MM-dd HH:mm')) })
        }
    }
    $profilesRoot = Join-Path $doctorHome 'profiles'
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
    # 逃生网页必须用与桌面端同一代 harness，否则旧版读不了新会话。
    $port = Get-Random -Minimum 47000 -Maximum 48999
    for ($attempt = 0; $attempt -lt 10; $attempt += 1) {
        $busy = $false
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $client.Connect('127.0.0.1', $port)
            $client.Close()
            $busy = $true
        } catch { $busy = $false }
        if (-not $busy) { break }
        $port = Get-Random -Minimum 47000 -Maximum 48999
    }
    $url = 'http://127.0.0.1:' + $port + '/'

    $command = Get-Command dsh -ErrorAction SilentlyContinue
    $useNpx = $false
    $version = ''
    if ($command) {
        $source = [string]$command.Source
        try { $version = [string](& $source --version 2>$null | Select-Object -First 1) } catch { $version = '' }
        if ($version -notmatch '^0\.2\.1') {
            Write-DoctorWarn ('PATH 里的 dsh 是旧版 ' + $version + '，与桌面端 rc.3 不一致；改用 npx @deepseek-ai/dsh@next 启动。')
            $useNpx = $true
        }
    } else {
        Write-DoctorInfo 'PATH 里没有 dsh，改用 npx @deepseek-ai/dsh@next（首次可能需要下载，1-2 分钟）。'
        $useNpx = $true
    }

    $started = $null
    $stdoutFile = Join-Path $env:TEMP ('dsh-doctor-web-' + [guid]::NewGuid().ToString('N') + '.log')
    $stderrFile = Join-Path $env:TEMP ('dsh-doctor-web-' + [guid]::NewGuid().ToString('N') + '.err')
    if ($useNpx) {
        Write-DoctorStep ('启动网页版：npx --yes @deepseek-ai/dsh@next web --port ' + $port + ' --no-open')
        $started = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', 'npx', '--yes', '@deepseek-ai/dsh@next', 'web', '--port', [string]$port, '--no-open') -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    } elseif ($source -match '\.(cmd|bat)$') {
        Write-DoctorStep ('启动网页版：' + $source + ' web --port ' + $port + ' --no-open')
        $started = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', ('"' + $source + '"'), 'web', '--port', [string]$port, '--no-open') -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    } elseif ($source -match '\.ps1$') {
        # Get-Command 可能解析到 npm 的 dsh.ps1 shim；.ps1 不能当 Win32 程序直接运行。
        Write-DoctorStep ('启动网页版：powershell -File ' + $source + ' web --port ' + $port + ' --no-open')
        $started = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $source + '"'), 'web', '--port', [string]$port, '--no-open') -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    } else {
        Write-DoctorStep ('启动网页版：' + $source + ' web --port ' + $port + ' --no-open')
        $started = Start-Process -FilePath $source -ArgumentList @('web', '--port', [string]$port, '--no-open') -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    }

    Write-DoctorInfo '正在等网页版就绪（最多 2 分钟，期间菜单会显示进度，不会假装卡死）…'
    $tokenUrl = $null
    for ($attempt = 1; $attempt -le 120; $attempt += 1) {
        Start-Sleep -Seconds 1
        if ($null -eq $tokenUrl -and (Test-Path -LiteralPath $stdoutFile)) {
            try {
                $text = [string](Get-Content -LiteralPath $stdoutFile -Raw -Encoding UTF8)
                $match = [regex]::Match($text, '(http://127\.0\.0\.1:\d+/\?token=[^\s'']+)')
                if ($match.Success) { $tokenUrl = $match.Groups[1].Value }
            } catch { }
        }
        if ($null -ne $tokenUrl) {
            Write-DoctorInfo ('网页版已启动：' + $tokenUrl)
            try { Start-Process $tokenUrl } catch { Write-DoctorInfo '浏览器没打开，请手动访问上面的地址。' }
            return
        }
        if ($attempt % 10 -eq 0) { Write-DoctorInfo ('还在启动… ' + $attempt + ' 秒') }
        if ($attempt -ge 8 -and $null -ne $started -and $started.HasExited) {
            $tail = ''
            try { if (Test-Path -LiteralPath $stderrFile) { $tail = ([string](Get-Content -LiteralPath $stderrFile -Raw -Encoding UTF8)).Trim() } } catch { }
            Write-DoctorWarn ('逃生进程提前退出（出口代码 ' + $started.ExitCode + '）。' + $(if ($tail) { ' 报错：' + $tail } else { '' }))
            return
        }
    }
    if ($null -ne $started -and -not $started.HasExited) {
        try { Stop-Process -Id $started.Id -Force -ErrorAction SilentlyContinue } catch { }
    }
    $tail2 = ''
    try { if (Test-Path -LiteralPath $stderrFile) { $tail2 = ([string](Get-Content -LiteralPath $stderrFile -Raw -Encoding UTF8)).Trim() } } catch { }
    Write-DoctorWarn ('2 分钟内没拿到带 token 的地址。' + $(if ($tail2) { ' 报错：' + $tail2 } else { ' 首次运行可能需要下载依赖。' }))
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

function Get-RescueCrashSummary {
    $dir = Join-Path $env:APPDATA '@deepseek-ai\dsh-desktop\logs'
    if (-not (Test-Path -LiteralPath $dir)) {
        return [pscustomobject]@{ Count = 0; Newest = ''; FirstLine = '' }
    }
    $files = @(Get-ChildItem -LiteralPath $dir -Filter 'crash-*.log' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    $first = ''
    if ($files.Count -gt 0) {
        $line = Get-Content -LiteralPath $files[0].FullName -TotalCount 3 -ErrorAction SilentlyContinue |
            Where-Object { $_.Trim().Length -gt 0 } | Select-Object -First 1
        if ($null -ne $line) { $first = $line.Trim() }
    }
    $newest = ''
    if ($files.Count -gt 0) { $newest = $files[0].LastWriteTime.ToString('yyyy-MM-dd HH:mm') }
    return [pscustomobject]@{ Count = $files.Count; Newest = $newest; FirstLine = $first }
}

function Get-RescueProfileSnapshot {
    $profilesRoot = Join-Path (Get-DshHome) 'profiles'
    $result = New-Object System.Collections.ArrayList
    if (-not (Test-Path -LiteralPath $profilesRoot)) { return $result.ToArray() }
    foreach ($profile in @(Get-ChildItem -LiteralPath $profilesRoot -Directory -ErrorAction SilentlyContinue)) {
        if ($profile.Name -like '*.stale*') { continue }
        $bundles = @()
        $dependencies = @()
        $pkgFile = Join-Path $profile.FullName 'package.json'
        if (Test-Path -LiteralPath $pkgFile) {
            try {
                $pkg = Get-Content -LiteralPath $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($null -ne $pkg.dsh -and $null -ne $pkg.dsh.profile -and $null -ne $pkg.dsh.profile.bundles) {
                    $bundles = @($pkg.dsh.profile.bundles)
                }
                if ($null -ne $pkg.dependencies) { $dependencies = @($pkg.dependencies.PSObject.Properties | ForEach-Object { $_.Name }) }
            } catch { }
        }
        $nodeModules = Join-Path $profile.FullName 'node_modules'
        $topLevel = @()
        if (Test-Path -LiteralPath $nodeModules) {
            $topLevel = @(Get-ChildItem -LiteralPath $nodeModules -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
        }
        [void]$result.Add([pscustomobject]@{ Name = $profile.Name; Bundles = $bundles; Dependencies = $dependencies; TopLevel = $topLevel })
    }
    return $result.ToArray()
}

function Get-RescueWorkspacePaths {
    $file = Join-Path (Get-DshHome) 'storages\workspace.json'
    $paths = New-Object System.Collections.ArrayList
    if (-not (Test-Path -LiteralPath $file)) { return $paths.ToArray() }
    try {
        $data = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -ne $data.tables -and $null -ne $data.tables.workspaces) {
            foreach ($property in @($data.tables.workspaces.PSObject.Properties)) {
                $path = [string]$property.Value.path
                if (-not [string]::IsNullOrWhiteSpace($path)) { [void]$paths.Add($path) }
            }
        }
    } catch { }
    return $paths.ToArray()
}

function Get-RescueRiskyWorkspaceReason {
    param([string]$Path)
    $target = $Path.TrimEnd('\', '/').ToLowerInvariant()
    $doctorHome = [Environment]::GetFolderPath('UserProfile').TrimEnd('\', '/').ToLowerInvariant()
    $desktop = [Environment]::GetFolderPath('Desktop').TrimEnd('\', '/').ToLowerInvariant()
    if ($target -eq $doctorHome) { return '用户目录本身' }
    if ($target -eq $desktop) { return '桌面本身' }
    if ($target -match '^[a-z]:$') { return '整个盘根' }
    return ''
}

function Get-RescueDiffReport {
    $doctorHome = Get-DshHome
    $desktop = [Environment]::GetFolderPath('Desktop')
    $profiles = @(Get-RescueProfileSnapshot)
    $workspaces = @(Get-RescueWorkspacePaths)
    $crash = Get-RescueCrashSummary
    $desktopAcl = Get-PathAclInfo -Path $desktop
    $forbiddenTop = @('dsh-tools', 'dsh-skill', 'schemastery', 'dsh-util-values')
    $forbiddenDeps = @('@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-skill', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-util-values', 'schemastery')
    $guiProfiles = @('desktop', 'web')

    $lines = New-Object System.Collections.ArrayList
    [void]$lines.Add('# DSH 环境差异报告')
    [void]$lines.Add('')
    [void]$lines.Add('> 生成时间：' + (Get-DoctorTimestamp) + '　平台：win32（EXE）')
    [void]$lines.Add('> 对照基线：内置默认基线（baseline/expected.json）')
    [void]$lines.Add('')
    [void]$lines.Add('## 环境快照')
    [void]$lines.Add('')
    [void]$lines.Add('- DSH 目录：`' + $doctorHome + '`')
    [void]$lines.Add('- 桌面：`' + $desktop + '`')
    [void]$lines.Add('- PowerShell：' + $PSVersionTable.PSVersion.ToString())
    [void]$lines.Add('- profile：' + (($profiles | ForEach-Object { $_.Name + '(' + $_.Bundles.Count + ' bundles / ' + $_.TopLevel.Count + ' pkgs)' }) -join '、'))
    [void]$lines.Add('- 工作区：' + $(if ($workspaces.Count -gt 0) { $workspaces -join '；' } else { '无' }))
    [void]$lines.Add('- 桌面完整性：' + $(if ($desktopAcl.LowLabel) { 'Low（异常）' } else { 'OK' }) + $(if ($desktopAcl.EveryoneDeny) { ' · 有拒绝项' } else { '' }))
    [void]$lines.Add('- 崩溃日志：' + $crash.Count + ' 个' + $(if ($crash.Newest) { '（最近 ' + $crash.Newest + '）' } else { '' }))
    [void]$lines.Add('')

    $diffCount = 0
    [void]$lines.Add('## 与标准基线的差异')
    [void]$lines.Add('')
    foreach ($workspace in $workspaces) {
        $reason = Get-RescueRiskyWorkspaceReason -Path $workspace
        if ($reason -ne '') {
            $diffCount += 1
            [void]$lines.Add('### [high] 工作区注册到了危险位置')
            [void]$lines.Add('')
            [void]$lines.Add('「' + $reason + '」被注册为工作区：`' + $workspace + '`')
            [void]$lines.Add('')
        }
    }
    if ($desktopAcl.LowLabel) {
        $diffCount += 1
        [void]$lines.Add('### [high] 桌面被降为低完整性')
        [void]$lines.Add('')
        [void]$lines.Add('桌面完整性标签是 Low，Explorer 取不到图标（图标会变白）。')
        [void]$lines.Add('')
    }
    if ($desktopAcl.EveryoneDeny) {
        $diffCount += 1
        [void]$lines.Add('### [medium] 桌面残留拒绝删除项')
        [void]$lines.Add('')
        [void]$lines.Add('桌面上存在 Everyone 拒绝删除的 ACE。')
        [void]$lines.Add('')
    }
    foreach ($profile in $profiles) {
        if (($profile.Bundles -notcontains '@deepseek-ai/dsh-base')) {
            $diffCount += 1
            [void]$lines.Add('### [medium] profile 缺少标准 bundle')
            [void]$lines.Add('')
            [void]$lines.Add('profile「' + $profile.Name + '」缺少：@deepseek-ai/dsh-base')
            [void]$lines.Add('')
        }
        if (($guiProfiles -contains $profile.Name) -and ($profile.Bundles -notcontains '@deepseek-ai/dsh-web-app')) {
            $diffCount += 1
            [void]$lines.Add('### [medium] GUI profile 缺少 web-app bundle')
            [void]$lines.Add('')
            [void]$lines.Add('profile「' + $profile.Name + '」缺少：@deepseek-ai/dsh-web-app')
            [void]$lines.Add('')
        }
        $badDeps = @($profile.Dependencies | Where-Object { $forbiddenDeps -contains $_ })
        if ($badDeps.Count -gt 0) {
            $diffCount += 1
            [void]$lines.Add('### [medium] profile 依赖里出现宿主包')
            [void]$lines.Add('')
            [void]$lines.Add('profile「' + $profile.Name + '」的 dependencies 含：' + ($badDeps -join '、'))
            [void]$lines.Add('')
        }
        $badTop = @($profile.TopLevel | Where-Object { $forbiddenTop -contains $_ })
        if ($badTop.Count -gt 0) {
            $diffCount += 1
            [void]$lines.Add('### [high] profile 里出现宿主包副本')
            [void]$lines.Add('')
            [void]$lines.Add('profile「' + $profile.Name + '」的 node_modules 顶层有：' + ($badTop -join '、'))
            [void]$lines.Add('')
        }
    }
    if ($diffCount -eq 0) { [void]$lines.Add('没有发现差异——这台机器的 DSH 结构与标准基线一致。'); [void]$lines.Add('') }

    [void]$lines.Add('## 后端报错')
    [void]$lines.Add('')
    if ($crash.Count -eq 0) {
        [void]$lines.Add('没有崩溃日志。')
    } else {
        [void]$lines.Add('- 崩溃日志数：' + $crash.Count + '，最近：' + $crash.Newest)
        if ($crash.FirstLine) { [void]$lines.Add('- 最近一次首行：`' + $crash.FirstLine + '`') }
        [void]$lines.Add('- 完整日志目录：`' + (Join-Path $env:APPDATA '@deepseek-ai\dsh-desktop\logs') + '`')
    }
    [void]$lines.Add('')
    [void]$lines.Add('## 提交方式')
    [void]$lines.Add('')
    [void]$lines.Add('1. 想求助：把本文件贴到 issue / 浏览器里的 AI；')
    [void]$lines.Add('2. 想贡献：按 CONTRIBUTING.md 整理成 bug 图鉴条目或检查包；')
    [void]$lines.Add('3. 提交地址：https://github.com/jincheng3870682453-hash/dsh-doctor/issues/new')
    [void]$lines.Add('')
    [void]$lines.Add('> 已脱敏：用户名 / 主机名 / 邮箱 / 用户主目录已替换为占位符（user、<machine>、user@example.com），其余路径保留原样以便定位。')
    return $lines -join "`n"
}

function Show-RescueWriteDiagnostics {
    Write-Host ('user: ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name)
    Write-Host ('desktop: ' + [Environment]::GetFolderPath('Desktop'))
    Write-Host ('dsh home: ' + (Get-DshHome))
    Write-Host ('temp: ' + [IO.Path]::GetTempPath())
    $probe = Join-Path ([IO.Path]::GetTempPath()) ('doctor-probe-' + [guid]::NewGuid().ToString('N') + '.txt')
    try { [IO.File]::WriteAllText($probe, 'x'); Write-Host 'temp write: OK'; Remove-Item -LiteralPath $probe -Force } catch { Write-Host ('temp write: FAIL - ' + $_.Exception.Message) }
    foreach ($name in @('Desktop', 'dsh')) {
        if ($name -eq 'Desktop') { $dir = [Environment]::GetFolderPath('Desktop') } else { $dir = Join-Path (Get-DshHome) 'dsh-doctor' }
        $target = Join-Path $dir ('doctor-probe-' + [guid]::NewGuid().ToString('N') + '.txt')
        try {
            if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
            [IO.File]::WriteAllText($target, 'x')
            Write-Host ($name + ' write: OK')
            Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Host ($name + ' write: FAIL - ' + $_.Exception.Message)
        }
    }
}

function Show-RescueDiffReport {
    $markdown = Get-SanitizedText -Text (Get-RescueDiffReport)
    $candidates = @(
        [Environment]::GetFolderPath('Desktop'),
        (Join-Path (Get-DshHome) 'dsh-doctor')
    )
    $file = ''
    $errors = @()
    foreach ($directory in $candidates) {
        if ([string]::IsNullOrWhiteSpace($directory)) { continue }
        try {
            if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
            $target = Join-Path $directory ('dsh-doctor-环境差异-' + (Get-Date -Format 'yyyyMMdd-HHmm') + '.md')
            try {
                [IO.File]::WriteAllText($target, $markdown, (New-Object Text.UTF8Encoding($false)))
            } catch {
                Set-Content -LiteralPath $target -Value $markdown -Encoding UTF8 -ErrorAction Stop
            }
            $file = $target
            break
        } catch {
            $errors += ($directory + ' -> ' + $_.Exception.Message)
        }
    }
    if ($file -eq '') {
        $warn = Get-SanitizedText -Text ('无法写入文件（' + ($errors -join '；') + '），已把报告打印在下面，可手动复制保存。')
        Write-DoctorWarn $warn
        Write-Host ''
        Write-Host $markdown
        return
    }
    Write-DoctorInfo ('差异报告已保存到：' + $file)
    Write-Host ''
    Write-Host $markdown
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
        Write-Host '   8) 生成环境差异报告（对照标准 DSH，可提交 issue）'
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
                '8' { Show-RescueDiffReport }
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
} elseif ($env:DSH_DOCTOR_EXE_ARGS -eq 'diff') {
    Show-RescueDiffReport
} elseif ($env:DSH_DOCTOR_EXE_ARGS -eq 'diag') {
    Show-RescueWriteDiagnostics
} else {
    Invoke-RescueMenu
}
