#Requires -Version 5.1
# Read-only checks for dsh-doctor. Every check returns an array of findings and
# must never throw: failures degrade into a Medium finding.

function Test-DoctorDesktopIntegrity {
    $findings = New-Object System.Collections.ArrayList
    $desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desktop)) {
        [void]$findings.Add((New-Finding -Id 'desktop-unresolved' -Severity 'Info' -Title 'Desktop folder could not be resolved'))
        return $findings.ToArray()
    }
    Write-DoctorStep ('Check desktop ACL: ' + $desktop)
    $info = Get-PathAclInfo -Path $desktop
    if (-not $info.Exists) { return $findings.ToArray() }
    if ($info.Error) {
        [void]$findings.Add((New-Finding -Id 'desktop-acl-unreadable' -Severity 'Medium' -Path $desktop `
            -Title 'Desktop ACL could not be read' -Detail $info.Error))
        return $findings.ToArray()
    }
    if ($info.LowLabel) {
        [void]$findings.Add((New-Finding -Id 'desktop-low-label' -Severity 'High' -Path $desktop `
            -Title 'Desktop carries a Low integrity label: Explorer cannot resolve your icons' `
            -Detail ('The sandbox grants write access by stamping a Low mandatory label on the workspace root. ' +
                'When the workspace is the Desktop itself, every shortcut renders as a blank white page. ' +
                'Removing the label does NOT break sandbox writes: writes are granted by the S-1-4-* capability ACE, ' +
                'which stays in place.') `
            -Evidence @($info.Sddl) `
            -Fix 'dsh-doctor fix -Id desktop-label'))
    }
    if ($info.EveryoneDeny) {
        [void]$findings.Add((New-Finding -Id 'desktop-everyone-deny' -Severity 'Medium' -Path $desktop `
            -Title 'Desktop denies Everyone delete-subdirectories-and-files' `
            -Detail 'Left over from a sandbox grant. It does not break rendering, but it blocks normal cleanup and DSH never removes it.' `
            -Evidence @($info.Sddl) `
            -Fix 'dsh-doctor fix -Id desktop-label'))
    }
    if ($info.CapabilityAces.Count -gt 0) {
        [void]$findings.Add((New-Finding -Id 'desktop-capability-ace' -Severity 'Info' -Path $desktop `
            -Title ('Sandbox capability ACE present: ' + ($info.CapabilityAces -join ', ')) `
            -Detail 'Expected while a workspace is provisioned here. Keep it: removing it breaks sandbox writes.' `
            -Evidence @($info.Sddl)))
    }
    return $findings.ToArray()
}

function Get-DshWorkspaceEntries {
    $file = Join-Path (Get-DshHome) 'storages\workspace.json'
    $result = New-Object System.Collections.ArrayList
    if (-not (Test-Path -LiteralPath $file)) { return $result.ToArray() }
    $raw = ''
    try { $raw = Get-Content -LiteralPath $file -Raw -Encoding UTF8 } catch { return $result.ToArray() }
    try {
        $data = $raw | ConvertFrom-Json
        if ($null -ne $data -and $null -ne $data.tables -and $null -ne $data.tables.workspaces) {
            foreach ($property in @($data.tables.workspaces.PSObject.Properties)) {
                $path = [string]$property.Value.path
                if ([string]::IsNullOrWhiteSpace($path)) { continue }
                if (-not $result.Contains($path)) { [void]$result.Add($path) }
            }
            return $result.ToArray()
        }
    } catch { }
    foreach ($match in [regex]::Matches($raw, '"([A-Za-z]:[^"]{1,400})"')) {
        $value = $match.Groups[1].Value.Replace('\\\\', '\')
        if (-not $result.Contains($value)) { [void]$result.Add($value) }
    }
    return $result.ToArray()
}

function Get-DoctorWorkspaceRisk {
    param([Parameter(Mandatory)][string]$Path)
    $userProfile = [Environment]::GetFolderPath('UserProfile')
    if ([string]::IsNullOrWhiteSpace($userProfile)) { return $null }
    $trimmed = $Path.TrimEnd('\', '/')
    $userProfile = $userProfile.TrimEnd('\', '/')

    $risky = @{}
    $risky[$userProfile] = 'the user profile root'
    $risky[(Join-Path $userProfile 'Desktop')] = 'the Desktop itself'
    $risky[(Join-Path $userProfile 'Documents')] = 'the Documents folder'
    $risky[(Join-Path $userProfile 'Downloads')] = 'the Downloads folder'
    $risky[(Join-Path $userProfile 'Pictures')] = 'the Pictures folder'
    $risky[(Join-Path $userProfile 'Videos')] = 'the Videos folder'
    $risky[(Join-Path $userProfile 'Music')] = 'the Music folder'

    foreach ($key in $risky.Keys) {
        if ([string]::Equals($trimmed, $key, [StringComparison]::OrdinalIgnoreCase)) {
            return $risky[$key]
        }
    }
    if ($trimmed -match '^[A-Za-z]:$') { return 'a whole drive root' }
    return $null
}

function Test-DoctorWorkspaceRegistry {
    $findings = New-Object System.Collections.ArrayList
    $entries = @(Get-DshWorkspaceEntries)
    if ($entries.Count -eq 0) { return $findings.ToArray() }
    Write-DoctorStep ('Check workspace registry entries: ' + $entries.Count)

    foreach ($entry in $entries) {
        $risk = Get-DoctorWorkspaceRisk -Path $entry
        if (-not $risk) { continue }
        $info = Get-PathAclInfo -Path $entry
        $labelState = 'path not found'
        if ($info.Exists) {
            if ($info.LowLabel) { $labelState = 'Low (icons break here)' } else { $labelState = 'normal' }
        }
        [void]$findings.Add((New-Finding -Id 'workspace-risky-path' -Severity 'High' -Path $entry `
            -Title ('Workspace registered on ' + $risk) `
            -Detail ('DSH re-applies the Low integrity label every time this workspace is provisioned, so blank ' +
                'desktop icons always come back after each manual fix. Point the workspace at a subfolder or ' +
                'another drive instead. Current label state: ' + $labelState + '.') `
            -Evidence @('workspace.json -> ' + $entry) `
            -Fix 'dsh-doctor fix -Id workspace-entry'))
    }

    foreach ($entry in $entries) {
        if (Test-Path -LiteralPath $entry) { continue }
        [void]$findings.Add((New-Finding -Id 'workspace-missing' -Severity 'High' -Path $entry `
            -Title ('Workspace directory missing: ' + $entry) `
            -Detail ('workspace.json still points at a directory that no longer exists. Sessions in this workspace fail ' +
                'with "working-directory: directory does not exist" at run time. Recreate the empty directory (fix), or ' +
                'move the project back / repoint the workspace.') `
            -Evidence @('workspace.json -> ' + $entry) `
            -Fix 'dsh-doctor fix -Id workspace-create'))
    }
    return $findings.ToArray()
}

function Test-DoctorProfileHostDup {
    $findings = New-Object System.Collections.ArrayList
    $profilesRoot = Join-Path (Get-DshHome) 'profiles'
    if (-not (Test-Path -LiteralPath $profilesRoot)) { return $findings.ToArray() }
    Write-DoctorStep ('Check profile node_modules for duplicate host packages: ' + $profilesRoot)

    $dirs = @()
    try {
        $dirs = @(Get-ChildItem -LiteralPath $profilesRoot -Recurse -Directory -Filter '@deepseek-ai' -Depth 6 -ErrorAction SilentlyContinue)
    } catch {
        $dirs = @(Get-ChildItem -LiteralPath $profilesRoot -Recurse -Directory -Filter '@deepseek-ai' -ErrorAction SilentlyContinue)
    }

    # Only these host packages trigger the "Cannot read properties of undefined" crash.
    $criticalNames = @('dsh-tools', 'dsh-skill', 'schemastery', 'dsh-util-values', 'cordis', 'dsh-settings', 'dsh-llm', 'dsh-credentials', 'dsh-session')
    $flagged = New-Object System.Collections.ArrayList
    foreach ($dir in $dirs) {
        if ($dir.Name -like '*.stale*') { continue }
        $full = $dir.FullName
        if ($full -match '(?i)(\.stale|\.ignored|node_modules\.stale)') { continue }
        $nested = $false
        foreach ($parent in $flagged) {
            if ($full.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase)) { $nested = $true; break }
        }
        if ($nested) { continue }

        $isLink = $false
        try { $isLink = [bool]($dir.Attributes -band [System.IO.FileAttributes]::ReparsePoint) } catch { $isLink = $false }
        $packages = @()
        try {
            $packages = @(Get-ChildItem -LiteralPath $full -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
        } catch { $packages = @() }

        if ($isLink) {
            [void]$flagged.Add($full)
            [void]$findings.Add((New-Finding -Id 'profile-host-link' -Severity 'Medium' -Path $full `
                -Title 'Profile @deepseek-ai folder is a reparse point (junction/symlink)' `
                -Detail 'A linked host-package folder can silently point at a different DSH runtime version. Prefer letting the runtime provide these packages.'))
        } elseif ($packages.Count -gt 0) {
            $hostPackages = @($packages | Where-Object { $criticalNames -contains $_ })
            if ($hostPackages.Count -eq 0) { continue }
            [void]$flagged.Add($full)
            [void]$findings.Add((New-Finding -Id 'profile-host-duplicate' -Severity 'High' -Path $full `
                -Title ('Host package copy inside a profile: ' + ($hostPackages -join ', ')) `
                -Detail ('Two copies of @deepseek-ai/dsh-tools in one process produce the classic ' +
                    '"Cannot read properties of undefined (reading ''prepare'')" crash. A plugin that lists ' +
                    'host packages under dependencies re-creates this copy whenever pnpm installs.') `
                -Evidence @($full) `
                -Fix 'dsh-doctor fix -Id profile-host-dup'))
        }
    }
    return $findings.ToArray()
}

function Get-DoctorProfilePluginManifests {
    $results = New-Object System.Collections.ArrayList
    $profilesRoot = Join-Path (Get-DshHome) 'profiles'
    if (-not (Test-Path -LiteralPath $profilesRoot)) { return $results.ToArray() }

    foreach ($profile in @(Get-ChildItem -LiteralPath $profilesRoot -Directory -ErrorAction SilentlyContinue)) {
        $nodeModules = Join-Path $profile.FullName 'node_modules'
        if (-not (Test-Path -LiteralPath $nodeModules)) { continue }

        $candidates = New-Object System.Collections.ArrayList
        foreach ($item in @(Get-ChildItem -LiteralPath $nodeModules -Directory -ErrorAction SilentlyContinue)) {
            if ($item.Name.StartsWith('@')) {
                foreach ($scoped in @(Get-ChildItem -LiteralPath $item.FullName -Directory -ErrorAction SilentlyContinue)) {
                    [void]$candidates.Add($scoped.FullName)
                }
            } else {
                [void]$candidates.Add($item.FullName)
            }
        }

        foreach ($candidate in $candidates) {
            if ($candidate -match '(?i)(\.stale|\.ignored)') { continue }
            $packagePath = Join-Path $candidate 'package.json'
            if (-not (Test-Path -LiteralPath $packagePath)) { continue }
            $package = $null
            try { $package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
            if ($null -eq $package) { continue }

            $dependencies = Get-JsonProperty -Object $package -Name 'dependencies' -Default $null
            if ($null -eq $dependencies) { continue }
            $dependencyNames = @()
            if ($dependencies -is [System.Collections.IDictionary]) {
                $dependencyNames = @($dependencies.Keys)
            } else {
                $dependencyNames = @($dependencies.PSObject.Properties | ForEach-Object { $_.Name })
            }
            $hostDeps = @($dependencyNames | Where-Object { $_ -like '@deepseek-ai/*' -or $_ -eq 'schemastery' })
            if ($hostDeps.Count -eq 0) { continue }

            [void]$results.Add([pscustomobject]@{
                Profile  = $profile.Name
                Package  = [string](Get-JsonProperty -Object $package -Name 'name' -Default '')
                Dir      = $candidate
                HostDeps = $hostDeps
            })
        }
    }
    return $results.ToArray()
}

function Test-DoctorPluginManifests {
    $findings = New-Object System.Collections.ArrayList
    $offenders = @(Get-DoctorProfilePluginManifests)
    if ($offenders.Count -eq 0) { return $findings.ToArray() }
    Write-DoctorStep ('Check plugin manifests for host-package dependencies: ' + $offenders.Count + ' offender(s)')

    foreach ($offender in $offenders) {
        [void]$findings.Add((New-Finding -Id 'plugin-host-dependency' -Severity 'Medium' -Path $offender.Dir `
            -Title ('Plugin "' + $offender.Package + '" declares host packages as dependencies') `
            -Detail ('Declares ' + ($offender.HostDeps -join ', ') + ' under dependencies. pnpm will install a real copy ' +
                'into the profile, and the next DSH start can crash with "reading ''prepare''". These belong in ' +
                'peerDependencies (or nowhere: the runtime provides them).') `
            -Evidence @($offender.Profile + ' / ' + $offender.Dir) ))
    }
    return $findings.ToArray()
}

function Test-DoctorPluginSourceKind {
    $findings = New-Object System.Collections.ArrayList
    $profilesRoot = Join-Path (Get-DshHome) 'profiles'
    if (-not (Test-Path -LiteralPath $profilesRoot)) { return $findings.ToArray() }
    Write-DoctorStep 'Scan plugin sources for the retired source.kind = "plugin"'

    $pattern = 'kind\s*:\s*[''"]plugin[''"]'
    foreach ($profile in @(Get-ChildItem -LiteralPath $profilesRoot -Directory -ErrorAction SilentlyContinue)) {
        $nodeModules = Join-Path $profile.FullName 'node_modules'
        if (-not (Test-Path -LiteralPath $nodeModules)) { continue }
        $hits = @()
        try {
            $hits = @(
                Get-ChildItem -LiteralPath $nodeModules -Recurse -File -Depth 3 -ErrorAction SilentlyContinue |
                    Where-Object { $_.Extension -in @('.js', '.mjs', '.cjs') } |
                    Select-String -Pattern $pattern -ErrorAction SilentlyContinue
            )
        } catch { $hits = @() }

        foreach ($hit in $hits) {
            [void]$findings.Add((New-Finding -Id 'plugin-legacy-source-kind' -Severity 'High' -Path $hit.Path `
                -Title 'Plugin injects messages with the retired source.kind = "plugin"' `
                -Detail ('Session format v4 rejects this value, so every turn that injects such a message fails with ' +
                    '"format v4 message requires a producer-owned source kind". Rename it to a producer-owned kind. ' +
                    'Line ' + $hit.LineNumber + ': ' + $hit.Line.Trim()) `
                -Evidence @($hit.Path) ))
        }
    }
    return $findings.ToArray()
}

function Test-DoctorCrashLogs {
    $findings = New-Object System.Collections.ArrayList
    $logDir = Join-Path $env:APPDATA '@deepseek-ai\dsh-desktop\logs'
    if (-not (Test-Path -LiteralPath $logDir)) { return $findings.ToArray() }
    Write-DoctorStep ('Check desktop crash logs: ' + $logDir)

    $logs = @()
    try {
        $logs = @(Get-ChildItem -LiteralPath $logDir -Filter 'crash-*.log' -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 10)
    } catch { $logs = @() }
    if ($logs.Count -eq 0) { return $findings.ToArray() }

    $newest = $logs[0]
    $firstLine = ''
    try {
        $firstLine = (Get-Content -LiteralPath $newest.FullName -TotalCount 3 -Encoding UTF8 | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -First 1)
    } catch { $firstLine = '' }
    if ($null -eq $firstLine) { $firstLine = '' }

    $severity = 'Info'
    if ($newest.LastWriteTime -gt (Get-Date).AddDays(-7)) { $severity = 'Medium' }
    [void]$findings.Add((New-Finding -Id 'desktop-crash-logs' -Severity $severity -Path $newest.FullName `
        -Title ('Desktop crash logs present: ' + $logs.Count + ' file(s), newest ' + $newest.LastWriteTime.ToString('yyyy-MM-dd HH:mm')) `
        -Detail ('First line: ' + $firstLine + '  (renderer crashes often carry no stack at all.)') `
        -Evidence @(($logs | ForEach-Object { $_.Name }) ) ))
    return $findings.ToArray()
}

function Get-DoctorDesktopSessionDirs {
    $sessionsRoot = Join-Path (Get-DshHome) 'sessions'
    $desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desktop)) { return @() }
    if (-not (Test-Path -LiteralPath $sessionsRoot)) { return @() }
    $slug = $desktop.TrimEnd('\', '/').Replace(':', '-').Replace('\', '-').Replace('/', '-')
    $expected = '--' + $slug + '--'
    $result = New-Object System.Collections.ArrayList
    foreach ($dir in @(Get-ChildItem -LiteralPath $sessionsRoot -Directory -ErrorAction SilentlyContinue)) {
        if ([string]::Equals($dir.Name, $expected, [StringComparison]::OrdinalIgnoreCase)) {
            [void]$result.Add($dir)
        }
    }
    return $result.ToArray()
}

function Test-DoctorDesktopSessionActivity {
    $findings = New-Object System.Collections.ArrayList
    $dirs = @(Get-DoctorDesktopSessionDirs)
    if ($dirs.Count -eq 0) { return $findings.ToArray() }
    Write-DoctorStep ('Check DSH sessions whose workspace is the Desktop: ' + $dirs.Count)

    foreach ($dir in $dirs) {
        $latest = $null
        try {
            $latest = Get-ChildItem -LiteralPath $dir.FullName -Recurse -File -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
        } catch { $latest = $null }

        $ageText = 'unknown'
        $active = $false
        if ($null -ne $latest) {
            $minutes = [math]::Round(((Get-Date) - $latest.LastWriteTime).TotalMinutes, 1)
            $ageText = [string]$minutes + ' min ago'
            if ($minutes -lt 10) { $active = $true }
        }

        $severity = 'Info'
        $suffix = ''
        if ($active) { $severity = 'High'; $suffix = ' (written within the last 10 minutes)' }

        [void]$findings.Add((New-Finding -Id 'desktop-workspace-session' -Severity $severity -Path $dir.FullName `
            -Title ('DSH session uses the Desktop as its workspace' + $suffix) `
            -Detail ('Every file this session creates, deletes or renames makes Explorer repaint the entire desktop, ' +
                'which is exactly the "all desktop icons flicker" symptom. It also re-stamps the Low integrity label, ' +
                'so icons can turn blank. Last write: ' + $ageText + '. Close that conversation or move its workspace ' +
                'to a subfolder / another drive.') `
            -Evidence @($dir.Name, ('last write: ' + $ageText)) `
            -Fix 'dsh-doctor fix -Id workspace-entry'))
    }
    return $findings.ToArray()
}

function Watch-DoctorDesktop {
    param([int]$Seconds = 120)

    $desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path -LiteralPath $desktop)) {
        throw 'Desktop folder was not found.'
    }

    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = $desktop
    $watcher.IncludeSubdirectories = $true
    $watcher.Filter = '*'
    $watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, DirectoryName, LastWrite, CreationTime'
    $activity = New-Object System.Collections.ArrayList
    $counts = @{}
    $sessions = @(Get-DoctorDesktopSessionDirs)

    Write-DoctorInfo ('Watching ' + $desktop + ' for ' + $Seconds + ' second(s)... (Ctrl+C to stop)')
    Write-DoctorStep ('Sessions with the Desktop as workspace: ' + $sessions.Count)

    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        $change = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::All, 1000)
        if ($change.TimedOut) { continue }
        $name = [string]$change.Name
        if ([string]::IsNullOrWhiteSpace($name)) { $name = '(desktop root)' }
        [void]$activity.Add([pscustomobject]@{ Time = (Get-DoctorTimestamp); Type = [string]$change.ChangeType; Name = $name })
        if (-not $counts.ContainsKey($name)) { $counts[$name] = 0 }
        $counts[$name] = $counts[$name] + 1
        Write-Host ('  ' + (Get-DoctorTimestamp) + '  ' + [string]$change.ChangeType + '  ' + $name) -ForegroundColor DarkGray
    }
    $watcher.Dispose()

    Write-Host ''
    if ($activity.Count -eq 0) {
        Write-DoctorInfo 'No file activity on the Desktop during the watch window.'
        Write-DoctorWarn 'So the flicker is NOT caused by file writes. Next suspects: Explorer repaint storms, shell icon overlays (OneDrive), or the display layer (MPO / HDR / refresh rate).'
        return
    }

    Write-DoctorInfo ('File activity during the watch window: ' + $activity.Count + ' event(s)')
    foreach ($key in ($counts.Keys | Sort-Object { -$counts[$_] })) {
        Write-Host ('  ' + $counts[$key].ToString().PadLeft(4) + 'x  ' + $key) -ForegroundColor Yellow
    }
    if ($sessions.Count -gt 0) {
        Write-DoctorWarn 'A DSH session has the Desktop as its workspace. It is the most likely writer - see the scan findings.'
    } else {
        Write-DoctorWarn 'No Desktop-rooted DSH session found: something else is writing to the Desktop.'
    }
    Write-DoctorInfo 'Whatever writes to the Desktop makes Explorer repaint the whole icon grid: that is the flicker.'
}

function Get-DoctorEnvironmentSnapshot {
    $snapshot = [ordered]@{
        Timestamp  = Get-DoctorTimestamp
        Tool       = 'dsh-doctor'
        Version    = Get-DoctorVersion
        PsVersion  = [string]$PSVersionTable.PSVersion
        DshHome    = Get-DshHome
        Profiles   = @()
        Ports      = @()
        DshCommand = @()
        Installs   = @()
    }
    $profilesRoot = Join-Path (Get-DshHome) 'profiles'
    if (Test-Path -LiteralPath $profilesRoot) {
        $snapshot.Profiles = @(Get-ChildItem -LiteralPath $profilesRoot -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    }
    foreach ($port in @(19387, 3080)) {
        $listening = $false
        try {
            $connection = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($null -ne $connection) { $listening = $true }
        } catch { $listening = $false }
        $snapshot.Ports += [pscustomobject]@{ Port = $port; Listening = $listening }
    }
    try {
        $commands = @(Get-Command dsh -All -ErrorAction SilentlyContinue)
        foreach ($command in $commands) {
            $snapshot.DshCommand += [pscustomobject]@{ Name = $command.Name; Source = [string]$command.Source }
        }
    } catch { }

    # 安装位置不写死：先看常见安装目录，再从正在运行的桌面端进程反查。
    $candidates = @(
        (Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh'),
        (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\@deepseek-ai\dsh-desktop'),
        (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\DeepSeek Harness'),
        (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'DeepSeek Harness'),
        (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'DeepSeek Harness')
    )
    try {
        $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'DeepSeek|dsh' })
        foreach ($process in $running) {
            try {
                if (-not [string]::IsNullOrWhiteSpace($process.Path)) {
                    $candidates += (Split-Path -Parent $process.Path)
                }
            } catch { }
        }
    } catch { }
    foreach ($candidate in @($candidates | Select-Object -Unique)) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        if (Test-Path -LiteralPath $candidate) {
            $snapshot.Installs += [pscustomobject]@{ Path = $candidate; Exists = $true }
        }
    }
    return $snapshot
}

function Test-DoctorPluginBootFailure {
    $findings = New-Object System.Collections.ArrayList
    $logDir = Join-Path $env:APPDATA '@deepseek-ai\dsh-desktop\logs'
    if (-not (Test-Path -LiteralPath $logDir)) { return $findings.ToArray() }
    Write-DoctorStep ('Check plugin boot failures: ' + $logDir)

    $logs = @()
    try {
        $logs = @(Get-ChildItem -LiteralPath $logDir -Filter 'crash-*.log' -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 10)
    } catch { $logs = @() }
    $seen = @{}
    foreach ($log in $logs) {
        $text = ''
        try { $text = Get-Content -LiteralPath $log.FullName -Raw -Encoding UTF8 } catch { continue }
        if ($null -eq $text) { continue }
        $text = [string]$text
        if ($text.Length -gt 65536) { $text = $text.Substring(0, 65536) }
        $pendingMatch = [regex]::Match($text, '(?:^|\n)\s*([a-z0-9][\w@/.-]*): pending \(waiting for service: ([A-Za-z0-9_$.-]+)\)')
        if ($pendingMatch.Success) {
            $pluginName = $pendingMatch.Groups[1].Value
            $serviceName = $pendingMatch.Groups[2].Value
            $pendingKey = 'pending|' + $pluginName + '|' + $serviceName
            if (-not $seen.ContainsKey($pendingKey)) {
                $seen[$pendingKey] = $true
                $detail = 'Startup log shows ' + $pluginName + ' pending, waiting for service ' + $serviceName +
                    ', but no enabled plugin provides it. The provider was probably uninstalled, disabled or deleted. ' +
                    'Install/enable the plugin providing ' + $serviceName + ', or use "disable third-party plugins, back up profile patch and restart" and then disable/remove ' + $pluginName + '.'
                [void]$findings.Add((New-Finding -Id 'plugin-service-pending' -Severity 'High' -Path $log.FullName `
                    -Title ('Plugin waits for a missing service: ' + $pluginName + ' -> ' + $serviceName) -Detail $detail))
            }
            continue
        }
        $bootMatch = [regex]::Match($text, '(?:^|\n)\s*([a-z0-9][\w@/.-]*): import failed')
        if ($bootMatch.Success) {
            $pluginName = $bootMatch.Groups[1].Value
            $bootKey = 'boot|' + $pluginName
            if ($seen.ContainsKey($bootKey)) { continue }
            $seen[$bootKey] = $true
            $detail = 'The startup log shows ' + $pluginName + ' failed to import, so the host did not boot. Usually a self-update race or a version mismatch. Restart once; if it repeats, disable or update that plugin.'
            [void]$findings.Add((New-Finding -Id 'plugin-boot-failure' -Severity 'Medium' -Path $log.FullName -Title ('Plugin failed to start: ' + $pluginName) -Detail $detail))
            continue
        }
        $errorMatch = [regex]::Match($text, '(ReferenceError|TypeError|SyntaxError|RangeError): ([^\r\n]+)')
        if (-not $errorMatch.Success) { continue }
        $fileMatch = [regex]::Match($text, 'file:///([^\s)''"]+?\.(?:js|mjs|cjs|ts))')
        if (-not $fileMatch.Success) { continue }
        $filePath = $fileMatch.Groups[1].Value -replace '/', '\'
        try { $filePath = [System.Uri]::UnescapeDataString($filePath) } catch { }
        $key = $errorMatch.Value + '|' + $filePath
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $message = $errorMatch.Groups[2].Value.Trim()
        [void]$findings.Add((New-Finding -Id 'plugin-boot-failure' -Severity 'High' -Path $log.FullName `
            -Title ('Plugin crashed during startup: ' + $message) `
            -Detail ('File ' + $filePath + ' threw ' + $errorMatch.Groups[1].Value + ': ' + $message + '. ' +
                'This is a plugin bug, not DSH itself (ESM is strict mode, so a missing declaration such as const server = ... throws). ' +
                'Recover: use "disable third-party plugins, back up profile patch and restart" in the startup dialog; then fix, update or remove that plugin.') ))
    }
    return $findings.ToArray()
}

function Test-DoctorPermissionTooBroad {
    $findings = New-Object System.Collections.ArrayList
    $file = Join-Path (Get-DshHome) 'storages\session_projcache.json'
    if (-not (Test-Path -LiteralPath $file)) { return $findings.ToArray() }
    Write-DoctorStep ('Check session permission presets: ' + $file)
    try {
        $cache = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        [void]$findings.Add((New-Finding -Id 'permission-cache-unreadable' -Severity 'Info' -Path $file `
            -Title 'Session projection cache could not be read' -Detail $_.Exception.Message))
        return $findings.ToArray()
    }
    $tables = Get-JsonProperty -Object $cache -Name 'tables'
    $sessions = Get-JsonProperty -Object $tables -Name 'sessions'
    if ($null -eq $sessions) { return $findings.ToArray() }

    $broad = New-Object System.Collections.ArrayList
    foreach ($property in @($sessions.PSObject.Properties)) {
        $rows = Get-JsonProperty -Object $property.Value -Name 'rows'
        $permission = Get-JsonProperty -Object $rows -Name 'permissions'
        $value = Get-JsonProperty -Object $permission -Name 'val'
        if ($null -eq $value) { continue }
        $preset = [string](Get-JsonProperty -Object $value -Name 'preset')
        $sandbox = [string](Get-JsonProperty -Object $value -Name 'sandbox')
        $approval = [string](Get-JsonProperty -Object $value -Name 'approval')
        if ($sandbox -ne 'danger-full-access' -and $preset -ne 'danger-full-access') { continue }
        [void]$broad.Add([pscustomobject]@{ Session = $property.Name; Approval = $approval })
    }
    if ($broad.Count -eq 0) { return $findings.ToArray() }

    $noApproval = @($broad | Where-Object { $_.Approval -eq 'never' }).Count
    $severity = if ($noApproval -gt 0) { 'High' } else { 'Medium' }
    $sample = (@($broad | Select-Object -First 5 | ForEach-Object {
        $short = $_.Session -replace '^session-', ''
        if ($short.Length -gt 8) { $short = $short.Substring(0, 8) }
        $short
    }) -join ', ')
    $suffix = if ($noApproval -gt 0) { ' and approval never' } else { '' }
    [void]$findings.Add((New-Finding -Id 'permission-too-broad' -Severity $severity -Path $file `
        -Title ('Sessions run with danger-full-access' + $suffix + ': ' + $broad.Count) `
        -Detail ('danger-full-access hands the whole machine to the model; deletes do not go to the Recycle Bin and cannot be undone. ' +
            'Switch to workspace-write + ask via /permission. Recovery steps: docs/recovery.md. Sessions: ' + $sample) `
        -Evidence @($file)))
    return $findings.ToArray()
}

function Test-DoctorMcpEntries {
    $findings = New-Object System.Collections.ArrayList
    $profiles = Join-Path (Get-DshHome) 'profiles'
    if (-not (Test-Path -LiteralPath $profiles)) { return $findings.ToArray() }
    Write-DoctorStep 'Check stdio MCP server entry points'

    $node = $null
    try { $node = (Get-Command node -ErrorAction Stop).Source } catch { $node = $null }
    $reported = @{}
    foreach ($profile in @(Get-ChildItem -LiteralPath $profiles -Directory -ErrorAction SilentlyContinue)) {
        if ($profile.Name -like '*.stale*') { continue }
        $patch = Join-Path $profile.FullName 'cordis.patch.yml'
        if (-not (Test-Path -LiteralPath $patch)) { continue }
        $text = ''
        try { $text = Get-Content -LiteralPath $patch -Raw -Encoding UTF8 } catch { continue }
        $lines = $text -split "`r?`n"
        for ($index = 0; $index -lt $lines.Count; $index++) {
            if ($lines[$index] -notmatch '@deepseek-ai/dsh-mcp-client') { continue }
            $end = [Math]::Min($index + 40, $lines.Count)
            $block = ($lines[$index..($end - 1)] -join "`n")
            foreach ($match in [regex]::Matches($block, '([A-Za-z]:[\\/][^"''\s,]+?\.(?:js|mjs|cjs))')) {
                $entry = $match.Groups[1].Value -replace '/', '\'
                if ($reported.ContainsKey($entry)) { continue }
                $reported[$entry] = $true
                if (-not (Test-Path -LiteralPath $entry)) {
                    [void]$findings.Add((New-Finding -Id 'mcp-entry-broken' -Severity 'High' -Path $entry `
                        -Title ('MCP server entry missing: ' + [System.IO.Path]::GetFileName($entry)) `
                        -Detail ('Profile ' + $profile.Name + ' registers this stdio MCP server but the entry file does not exist. ' +
                            'Any MCP server that fails to load makes the host exit; the desktop then shows "application failed to start". ' +
                            'Fix: restore the file or remove its row from cordis.patch.yml.')))
                    continue
                }
                if ($null -ne $node) {
                    $check = & $node --check $entry 2>&1
                    if ($LASTEXITCODE -ne 0) {
                        $reason = (@($check) | Where-Object { $_.Trim().Length -gt 0 } | Select-Object -Last 2) -join ' '
                        [void]$findings.Add((New-Finding -Id 'mcp-entry-broken' -Severity 'High' -Path $entry `
                            -Title ('MCP server entry cannot be loaded: ' + [System.IO.Path]::GetFileName($entry)) `
                            -Detail ('node --check failed: ' + $reason + '. Fix the file or remove its row from cordis.patch.yml.')))
                    }
                }
            }
        }
    }
    return $findings.ToArray()
}

function Test-DoctorStaleHomeBackup {
    $findings = New-Object System.Collections.ArrayList
    $homeDir = Get-DshHome
    if ([string]::IsNullOrWhiteSpace($homeDir)) { return $findings.ToArray() }
    $parent = Split-Path -Parent $homeDir
    if (-not (Test-Path -LiteralPath $parent)) { return $findings.ToArray() }
    $current = $homeDir.TrimEnd('\', '/')
    foreach ($dir in @(Get-ChildItem -LiteralPath $parent -Directory -Force -ErrorAction SilentlyContinue)) {
        if ($dir.FullName.TrimEnd('\', '/') -eq $current) { continue }
        if ($dir.Name -notmatch '^\.dsh([._\s-]|$)') { continue }
        if (-not (Test-Path -LiteralPath (Join-Path $dir.FullName 'profiles')) -and
            -not (Test-Path -LiteralPath (Join-Path $dir.FullName 'sessions')) -and
            -not (Test-Path -LiteralPath (Join-Path $dir.FullName 'storages'))) { continue }
        Write-DoctorStep ('Check stale DSH home: ' + $dir.FullName)
        [void]$findings.Add((New-Finding -Id 'stale-home-backup' -Severity 'Medium' -Path $dir.FullName `
            -Title ('Old DSH home left over: ' + $dir.Name) `
            -Detail ('Current home is ' + $homeDir + '; ' + $dir.FullName + ' looks like a renamed old home (a common rescue move when DSH would not start). Keep it: sessions, plugins and settings live there. Copy what you need before deleting.')))
    }
    return $findings.ToArray()
}

function Test-DoctorStorageCorrupt {
    $findings = New-Object System.Collections.ArrayList
    $dir = Join-Path (Get-DshHome) 'storages'
    if (-not (Test-Path -LiteralPath $dir)) { return $findings.ToArray() }
    Write-DoctorStep ('Check storage JSON: ' + $dir)
    foreach ($file in @(Get-ChildItem -LiteralPath $dir -Filter '*.json' -File -ErrorAction SilentlyContinue)) {
        if ($file.Length -gt 8MB) { continue }
        try {
            $null = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        } catch {
            [void]$findings.Add((New-Finding -Id 'storage-corrupt' -Severity 'Medium' -Path $file.FullName `
                -Title ('Corrupt storage file: ' + $file.Name) `
                -Detail ('Not valid JSON: ' + $_.Exception.Message + '. DSH may fail to start or load state. Back it up, then delete it so it rebuilds.')))
        }
    }
    return $findings.ToArray()
}

function Test-DoctorCredentialRecords {
    $findings = New-Object System.Collections.ArrayList
    $file = Join-Path (Get-DshHome) '.credentials.yaml'
    if (-not (Test-Path -LiteralPath $file)) { return $findings.ToArray() }
    Write-DoctorStep ('Check credential records: ' + $file)
    $lines = @()
    try { $lines = @(Get-Content -LiteralPath $file -Encoding UTF8) } catch { return $findings.ToArray() }
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i += 1) { if ($lines[$i] -match '^records:\s*$') { $start = $i; break } }
    if ($start -lt 0) { return $findings.ToArray() }
    $keys = @{}
    for ($i = $start + 1; $i -lt $lines.Count; $i += 1) {
        $line = $lines[$i]
        if ($line -match '^\S') { break }
        $match = [regex]::Match($line, '^  (\S[^:]*):\s*$')
        if ($match.Success) {
            $key = $match.Groups[1].Value
            if ($keys.ContainsKey($key)) { $keys[$key] += 1 } else { $keys[$key] = 1 }
        }
    }
    $duplicates = @($keys.Keys | Where-Object { $keys[$_] -gt 1 })
    $count = $keys.Count
    $size = (Get-Item -LiteralPath $file).Length
    $severity = ''
    if ($duplicates.Count -gt 0 -or $count -ge 40 -or $size -gt 200KB) { $severity = 'High' }
    elseif ($count -ge 15 -or $size -gt 80KB) { $severity = 'Medium' }
    if ($severity -eq '') { return $findings.ToArray() }
    $detail = 'records: ' + $count + ' entries, ' + $size + ' bytes'
    if ($duplicates.Count -gt 0) { $detail += '; duplicate keys: ' + (($duplicates | Select-Object -First 5) -join ', ') }
    $detail += '. A login grant appended on every launch can eventually make DSH fail to start. Back up the file and keep only the newest record per key (or delete it and sign in again).'
    [void]$findings.Add((New-Finding -Id 'credential-record-bloat' -Severity $severity -Path $file -Title ('Credential records accumulating: ' + $count) -Detail $detail))
    return $findings.ToArray()
}

function Test-DoctorProfileLockedEntries {
    $findings = New-Object System.Collections.ArrayList
    $profiles = Join-Path (Get-DshHome) 'profiles'
    if (-not (Test-Path -LiteralPath $profiles)) { return $findings.ToArray() }
    foreach ($profile in @(Get-ChildItem -LiteralPath $profiles -Directory -Force -ErrorAction SilentlyContinue)) {
        $modules = Join-Path $profile.FullName 'node_modules'
        if (-not (Test-Path -LiteralPath $modules)) { continue }
        foreach ($entry in @(Get-ChildItem -LiteralPath $modules -Force -ErrorAction SilentlyContinue)) {
            if (-not $entry.PSIsContainer) { continue }
            if ($entry.Name.StartsWith('.') -or $entry.Name.StartsWith('@')) { continue }
            $locked = $false
            try { Get-ChildItem -LiteralPath $entry.FullName -Force -ErrorAction Stop | Out-Null }
            catch { if ($_.Exception.Message -match 'denied|拒绝|EPERM|EACCES') { $locked = $true } }
            if (-not $locked) { continue }
            [void]$findings.Add((New-Finding -Id 'profile-entry-locked' -Severity 'High' -Path $entry.FullName `
                -Title ('Plugin directory locked by sandbox: ' + $entry.Name) `
                -Detail ('Access denied even for admin/SYSTEM (Codex/AppContainer bindflt residue). pnpm install fails with EPERM opening package.json. Remove Codex sandbox, reboot, then takeown/icacls/rd the directory as admin.')))
        }
    }
    return $findings.ToArray()
}

function Get-DoctorDesktopVersion {
    # 卸载表里的 DisplayVersion 由安装器写入，和安装包里的 version 是同一个值。
    # 拿不到就返回 $null：版本判断宁可不做，也不能拿过期数据误报。
    $roots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($key in @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
            $entry = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
            if ($null -eq $entry) { continue }
            if ($entry.DisplayName -ne 'DeepSeek Harness') { continue }
            $version = [string]$entry.DisplayVersion
            if ([string]::IsNullOrWhiteSpace($version)) { continue }
            return $version
        }
    }
    return $null
}

function Get-DoctorSemverParts {
    param([string]$Version)
    $m = [regex]::Match([string]$Version, '^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$')
    if (-not $m.Success) { return $null }
    $pre = @()
    if ($m.Groups[4].Success) { $pre = @($m.Groups[4].Value -split '\.') }
    return @{
        Main = @([long]$m.Groups[1].Value, [long]$m.Groups[2].Value, [long]$m.Groups[3].Value)
        Pre  = $pre
    }
}

function Get-DoctorPartialSemver {
    param([string]$Version)
    $m = [regex]::Match([string]$Version, '^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$')
    if (-not $m.Success) { return $null }
    $parts = @()
    for ($i = 1; $i -le 3; $i++) {
        if (-not $m.Groups[$i].Success -or $m.Groups[$i].Value -match '^[xX*]$') { $parts += $null }
        else { $parts += [long]$m.Groups[$i].Value }
    }
    $pre = @()
    if ($m.Groups[4].Success) { $pre = @($m.Groups[4].Value -split '\.') }
    return @{ Main = $parts; Pre = $pre }
}

function Compare-DoctorSemver {
    param([string]$Left, [string]$Right)
    $a = Get-DoctorSemverParts $Left
    $b = Get-DoctorSemverParts $Right
    if ($null -eq $a -or $null -eq $b) { return $null }
    for ($i = 0; $i -lt 3; $i++) {
        if ($a.Main[$i] -ne $b.Main[$i]) { if ($a.Main[$i] -lt $b.Main[$i]) { return -1 } else { return 1 } }
    }
    # A prerelease sorts before the release with the same core version.
    if ($a.Pre.Count -eq 0 -and $b.Pre.Count -eq 0) { return 0 }
    if ($a.Pre.Count -eq 0) { return 1 }
    if ($b.Pre.Count -eq 0) { return -1 }
    $max = [Math]::Max($a.Pre.Count, $b.Pre.Count)
    for ($i = 0; $i -lt $max; $i++) {
        if ($i -ge $a.Pre.Count) { return -1 }
        if ($i -ge $b.Pre.Count) { return 1 }
        $x = [string]$a.Pre[$i]
        $y = [string]$b.Pre[$i]
        if ($x -eq $y) { continue }
        $xNumeric = $x -match '^\d+$'
        $yNumeric = $y -match '^\d+$'
        if ($xNumeric -and $yNumeric) { if ([long]$x -lt [long]$y) { return -1 } else { return 1 } }
        if ($xNumeric) { return -1 }
        if ($yNumeric) { return 1 }
        if ([string]::CompareOrdinal($x, $y) -lt 0) { return -1 } else { return 1 }
    }
    return 0
}

# Mirrors the semver subset the ecosystem actually declares. Unknown syntax returns $null
# so the scan says "cannot judge" instead of inventing an incompatibility.
function Test-DoctorSemverRange {
    param([string]$Version, [string]$Range)
    if ($null -eq (Get-DoctorSemverParts $Version)) { return $null }
    if ([string]::IsNullOrWhiteSpace($Range)) { return $null }
    $text = $Range.Trim()
    if ($text -eq '*' -or $text -eq 'x' -or $text -eq 'X') { return $true }
    if ($text -eq 'workspace:*' -or $text -eq 'workspace:^' -or $text -eq 'workspace:~') { return $true }
    foreach ($comparator in @($text -split '\s+')) {
        $m = [regex]::Match($comparator, '^(\^|~|>=|<=|>|<|=)?(.+)$')
        if (-not $m.Success) { return $null }
        $op = $m.Groups[1].Value
        if ($op -eq '') { $op = '=' }
        $partial = Get-DoctorPartialSemver $m.Groups[2].Value
        if ($null -eq $partial) { return $null }
        $lower = @()
        for ($i = 0; $i -lt 3; $i++) {
            if ($null -eq $partial.Main[$i]) { $lower += [long]0 } else { $lower += [long]$partial.Main[$i] }
        }
        $lowerText = ('{0}.{1}.{2}' -f $lower[0], $lower[1], $lower[2])
        if ($partial.Pre.Count -gt 0) { $lowerText = $lowerText + '-' + ($partial.Pre -join '.') }
        if ($op -eq '^' -or $op -eq '~') {
            if ($null -eq $partial.Main[0]) { continue }
            if ($op -eq '~') {
                if ($null -eq $partial.Main[1]) { $upper = @(($partial.Main[0] + 1), 0, 0) }
                else { $upper = @($partial.Main[0], ($partial.Main[1] + 1), 0) }
            } elseif ($partial.Main[0] -gt 0) {
                $upper = @(($partial.Main[0] + 1), 0, 0)
            } elseif ($null -eq $partial.Main[1]) {
                $upper = @(1, 0, 0)
            } elseif ($partial.Main[1] -gt 0) {
                $upper = @(0, ($partial.Main[1] + 1), 0)
            } elseif ($null -eq $partial.Main[2]) {
                $upper = @(0, 1, 0)
            } else {
                $upper = @(0, 0, ($partial.Main[2] + 1))
            }
            $upperText = '{0}.{1}.{2}' -f $upper[0], $upper[1], $upper[2]
            $aboveLower = Compare-DoctorSemver $Version $lowerText
            $belowUpper = Compare-DoctorSemver $Version $upperText
            if ($null -eq $aboveLower -or $null -eq $belowUpper) { return $null }
            if (-not ($aboveLower -ge 0 -and $belowUpper -lt 0)) { return $false }
            continue
        }
        if ($op -eq '=' -and ($null -eq $partial.Main[0] -or $null -eq $partial.Main[1] -or $null -eq $partial.Main[2])) {
            # Wildcard range such as 1.2.x: compare only the written components.
            $versionParts = Get-DoctorSemverParts $Version
            for ($i = 0; $i -lt 3; $i++) {
                if ($null -eq $partial.Main[$i]) { break }
                if ($versionParts.Main[$i] -ne $partial.Main[$i]) { return $false }
            }
            continue
        }
        $cmp = Compare-DoctorSemver $Version $lowerText
        if ($null -eq $cmp) { return $null }
        switch ($op) {
            '>=' { if ($cmp -lt 0) { return $false } }
            '>'  { if ($cmp -le 0) { return $false } }
            '<=' { if ($cmp -gt 0) { return $false } }
            '<'  { if ($cmp -ge 0) { return $false } }
            '='  { if ($cmp -ne 0) { return $false } }
            default { return $null }
        }
    }
    return $true
}

# Same rule as dsh-app-boot's unmetRequirements: engines.dsh decides alone,
# otherwise only @deepseek-ai/dsh and @deepseek-ai/dsh-* peers are checked.
function Get-DoctorUnmetDshRequirements {
    param($Manifest, [string]$RuntimeVersion)
    if ($null -eq $Manifest) { return $null }
    $engineNames = @($Manifest.PSObject.Properties.Name)
    if ($engineNames -contains 'engines' -and $null -ne $Manifest.engines) {
        if (($Manifest.engines.PSObject.Properties.Name) -contains 'dsh') {
            $range = $Manifest.engines.dsh
            if ($range -isnot [string]) { return $null }
            $ok = Test-DoctorSemverRange $RuntimeVersion $range
            if ($null -eq $ok) { return $null }
            if ($ok) { return @{} }
            return @{ 'engines.dsh' = $range }
        }
    }
    if ($null -eq $Manifest.peerDependencies) { return @{} }
    $unmet = @{}
    foreach ($prop in @($Manifest.peerDependencies.PSObject.Properties)) {
        if ($prop.Name -ne '@deepseek-ai/dsh' -and -not $prop.Name.StartsWith('@deepseek-ai/dsh-')) { continue }
        $range = $prop.Value
        if ($range -isnot [string]) { return $null }
        $effective = $range
        if ($range -eq 'workspace:^' -or $range -eq 'workspace:~' -or $range -eq 'workspace:*') { $effective = $RuntimeVersion }
        $ok = Test-DoctorSemverRange $RuntimeVersion $effective
        if ($null -eq $ok) { return $null }
        if (-not $ok) { $unmet[$prop.Name] = $range }
    }
    return $unmet
}

function Test-DoctorBundleVersionSkew {
    $findings = New-Object System.Collections.ArrayList
    $runtimeVersion = Get-DoctorDesktopVersion
    if ([string]::IsNullOrWhiteSpace($runtimeVersion)) { return $findings.ToArray() }
    $profiles = Join-Path (Get-DshHome) 'profiles'
    if (-not (Test-Path -LiteralPath $profiles)) { return $findings.ToArray() }
    $separator = [IO.Path]::DirectorySeparatorChar
    foreach ($profile in @(Get-ChildItem -LiteralPath $profiles -Directory -Force -ErrorAction SilentlyContinue)) {
        if ($profile.Name -like '*.stale*') { continue }
        $manifest = Join-Path $profile.FullName 'package.json'
        if (-not (Test-Path -LiteralPath $manifest)) { continue }
        try { $pkg = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
        if ($null -eq $pkg -or $null -eq $pkg.dependencies) { continue }
        foreach ($prop in @($pkg.dependencies.PSObject.Properties)) {
            if (-not $prop.Name.StartsWith('@deepseek-ai/')) { continue }
            $declared = [string]$prop.Value
            # link: / github: / 版本范围都不是固定版本，跳过。
            if ($declared -notmatch '^\d') { continue }
            $version = $declared
            $installedPkg = $null
            $relative = ($prop.Name -replace '/', [string]$separator) + $separator + 'package.json'
            $installedManifest = Join-Path (Join-Path $profile.FullName 'node_modules') $relative
            if (Test-Path -LiteralPath $installedManifest) {
                try {
                    $installedPkg = Get-Content -LiteralPath $installedManifest -Raw -Encoding UTF8 | ConvertFrom-Json
                    $installedVersion = [string]$installedPkg.version
                    if (-not [string]::IsNullOrWhiteSpace($installedVersion)) { $version = $installedVersion }
                } catch { $installedPkg = $null }
            }
            if ($version -eq $runtimeVersion) { continue }
            # A different version number is not a failure by itself: dsh only checks the declared ranges.
            $unmet = $null
            if ($null -ne $installedPkg) { $unmet = Get-DoctorUnmetDshRequirements -Manifest $installedPkg -RuntimeVersion $runtimeVersion }
            if ($null -eq $unmet) {
                [void]$findings.Add((New-Finding -Id 'bundle-version-skew' -Severity 'Low' -Path $profile.FullName `
                    -Title ('Plugin version behind runtime: ' + $prop.Name) `
                    -Detail ('Profile "' + $profile.Name + '" has ' + $version + ', the desktop app is ' + $runtimeVersion + '. Its manifest is missing or declares a range this scan cannot evaluate, so compatibility cannot be judged. Check it by hand.')))
                continue
            }
            $requirementNames = @($unmet.Keys)
            if ($requirementNames.Count -eq 0) {
                [void]$findings.Add((New-Finding -Id 'bundle-version-skew' -Severity 'Low' -Path $profile.FullName `
                    -Title ('Plugin version behind but compatible: ' + $prop.Name) `
                    -Detail ('Profile "' + $profile.Name + '" has ' + $version + ', the desktop app is ' + $runtimeVersion + '. Its declared dsh ranges still match the runtime, so the compatibility guard does not block it. This is version drift, not a fault; upgrade it on the next plugin update.')))
                continue
            }
            $requirements = (@($requirementNames | ForEach-Object { $_ + ' requires ' + $unmet[$_] }) -join '; ')
            [void]$findings.Add((New-Finding -Id 'bundle-version-skew' -Severity 'Medium' -Path $profile.FullName `
                -Title ('Plugin is skipped by the compatibility guard: ' + $prop.Name) `
                -Detail ('Profile "' + $profile.Name + '" has ' + $version + ', the desktop app is ' + $runtimeVersion + '; ' + $requirements + ' are unmet. dsh skips the whole bundle layer at load (skippedBundles), so every feature it brings is absent. Fix: upgrade it to ' + $runtimeVersion + ', or grant an exact-version exemption for ' + $prop.Name + '@' + $version + ' in the plugin manager (dsh plugin allow-version). An exemption only bypasses the check; a cross-version run may still crash, so prefer the upgrade.')))
        }
    }
    return $findings.ToArray()
}

function Test-DoctorRuntimeMetadataStale {
    $findings = New-Object System.Collections.ArrayList
    $runtimeFile = Join-Path (Join-Path (Get-DshHome) 'dsh-runtimes') (Join-Path 'dsh-primary-runtime' 'runtime.json')
    if (-not (Test-Path -LiteralPath $runtimeFile)) { return $findings.ToArray() }
    try { $meta = Get-Content -LiteralPath $runtimeFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $findings.ToArray() }
    if ($null -eq $meta) { return $findings.ToArray() }
    $declaredVersion = [string]$meta.desktopVersion
    if ([string]::IsNullOrWhiteSpace($declaredVersion)) { return $findings.ToArray() }
    $runtimeVersion = Get-DoctorDesktopVersion
    if ([string]::IsNullOrWhiteSpace($runtimeVersion)) { return $findings.ToArray() }
    if ($declaredVersion -eq $runtimeVersion) { return $findings.ToArray() }
    [void]$findings.Add((New-Finding -Id 'runtime-metadata-stale' -Severity 'Low' -Path $runtimeFile `
        -Title 'Runtime metadata version is stale' `
        -Detail ('runtime.json says ' + $declaredVersion + ' but the desktop app is ' + $runtimeVersion + '. Any tool or plugin that reads runtime.json to judge versions will misjudge them.')))
    return $findings.ToArray()
}

function Invoke-DoctorScan {
    $checks = @(
        'Test-DoctorDesktopIntegrity',
        'Test-DoctorWorkspaceRegistry',
        'Test-DoctorDesktopSessionActivity',
        'Test-DoctorProfileHostDup',
        'Test-DoctorProfileLockedEntries',
        'Test-DoctorPluginManifests',
        'Test-DoctorPluginSourceKind',
        'Test-DoctorCrashLogs',
        'Test-DoctorPluginBootFailure',
        'Test-DoctorMcpEntries',
        'Test-DoctorStaleHomeBackup',
        'Test-DoctorStorageCorrupt',
        'Test-DoctorCredentialRecords',
        'Test-DoctorPermissionTooBroad',
        'Test-DoctorBundleVersionSkew',
        'Test-DoctorRuntimeMetadataStale'
    )
    $all = New-Object System.Collections.ArrayList
    foreach ($check in $checks) {
        try {
            $result = & $check
            if ($null -eq $result) { continue }
            foreach ($finding in @($result)) {
                if ($null -ne $finding) { [void]$all.Add($finding) }
            }
        } catch {
            [void]$all.Add((New-Finding -Id ('check-failed:' + $check) -Severity 'Medium' `
                -Title ('Check failed: ' + $check) -Detail $_.Exception.Message))
        }
    }
    return $all.ToArray()
}
