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
    $criticalNames = @('dsh-tools', 'dsh-skill', 'schemastery', 'dsh-util-values', 'cordis')
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

    $candidates = @(
        (Join-Path $env:APPDATA 'npm\node_modules\@deepseek-ai\dsh'),
        (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\@deepseek-ai\dsh-desktop'),
        'E:\dsh',
        'C:\dsh'
    )
    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        if (Test-Path -LiteralPath $candidate) {
            $snapshot.Installs += [pscustomobject]@{ Path = $candidate; Exists = $true }
        }
    }
    return $snapshot
}

function Invoke-DoctorScan {
    $checks = @(
        'Test-DoctorDesktopIntegrity',
        'Test-DoctorWorkspaceRegistry',
        'Test-DoctorDesktopSessionActivity',
        'Test-DoctorProfileHostDup',
        'Test-DoctorPluginManifests',
        'Test-DoctorPluginSourceKind',
        'Test-DoctorCrashLogs'
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
