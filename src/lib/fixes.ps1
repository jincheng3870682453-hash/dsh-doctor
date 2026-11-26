#Requires -Version 5.1
# Fixes for dsh-doctor. Every fix backs up first, verifies after, and prints a
# rollback command. Nothing runs unless the caller asked for that specific fix.

function Write-DoctorAclCommands {
    param([string]$Path, [string]$BackupFile)
    Write-DoctorInfo ('Backup command: icacls "' + $Path + '" /save "' + $BackupFile + '"')
    Write-DoctorInfo ('Rollback command: icacls "' + (Split-Path -Parent $Path) + '" /restore "' + $BackupFile + '"')
}

function Repair-DoctorIntegrityLabel {
    # 单路径备份、修改、复检及尽力回滚；多路径由调用方逐项处理，不宣称整批事务。
    param([Parameter(Mandatory)][string]$Path)

    $before = Get-PathAclInfo -Path $Path
    if (-not $before.Exists) { throw ('ACL target not found: ' + $Path) }
    if ($before.Error -or [string]::IsNullOrWhiteSpace([string]$before.Sddl)) {
        throw ('ACL cannot be read; refusing to change it: ' + $Path + ' ' + $before.Error)
    }
    if (-not ($before.LowLabel -or $before.EveryoneDeny)) {
        return [pscustomobject]@{ Success = $true; Changed = $false; BackupFile = '' }
    }

    $backupDir = New-DoctorBackupDir -Purpose 'integrity-acl'
    $backupFile = Join-Path $backupDir ('desktop-acl-' + (Get-DoctorStamp) + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.txt')
    $save = Invoke-DoctorProcess -FilePath 'icacls.exe' -Arguments @($Path, '/save', $backupFile)
    Write-DoctorStep ('ACL backup -> ' + $backupFile + ' (exit ' + $save.ExitCode + ')')
    if ($save.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $backupFile -PathType Leaf)) {
        throw ('ACL backup failed; nothing was changed: ' + $save.Output)
    }
    try {
        if ((Get-Item -LiteralPath $backupFile -ErrorAction Stop).Length -le 0) {
            throw ('ACL backup is empty; nothing was changed: ' + $backupFile)
        }
    } catch {
        if ($_.Exception.Message -like 'ACL backup is empty*') { throw }
        throw ('ACL backup could not be confirmed; nothing was changed: ' + $_.Exception.Message)
    }
    # Plain-text sibling metadata lets the interactive rollback locate the exact
    # original target instead of assuming every ACL backup belongs to Desktop.
    [IO.File]::WriteAllText($backupFile + '.path.txt', $Path, (New-Object Text.UTF8Encoding($false)))
    Write-DoctorAclCommands -Path $Path -BackupFile $backupFile

    $failure = ''
    if ($before.LowLabel) {
        $result = Invoke-DoctorProcess -FilePath 'icacls.exe' -Arguments @($Path, '/setintegritylevel', '(OI)(CI)Medium')
        if ($result.ExitCode -ne 0) { $failure = 'setintegritylevel failed: ' + $result.Output }
        else { Write-DoctorStep ('Integrity label set to Medium: ' + $Path) }
    }
    if ($failure -eq '' -and $before.EveryoneDeny) {
        $result = Invoke-DoctorProcess -FilePath 'icacls.exe' -Arguments @($Path, '/remove:d', '*S-1-1-0')
        if ($result.ExitCode -ne 0) { $failure = 'Everyone deny removal failed: ' + $result.Output }
    }
    if ($failure -eq '') {
        $after = Get-PathAclInfo -Path $Path
        if (-not $after.Exists -or $after.Error -or [string]::IsNullOrWhiteSpace([string]$after.Sddl)) {
            $failure = 'verification could not read the ACL: ' + $after.Error
        } elseif ($after.LowLabel) {
            $failure = 'verification still found the Low integrity label'
        } elseif ($after.EveryoneDeny) {
            $failure = 'verification still found an Everyone deny ACE'
        }
    }
    if ($failure -ne '') {
        $restore = Invoke-DoctorProcess -FilePath 'icacls.exe' -Arguments @((Split-Path -Parent $Path), '/restore', $backupFile)
        if ($restore.ExitCode -ne 0) {
            $failure += '; ROLLBACK FAILED, run the rollback command above manually: ' + $restore.Output
        } else {
            $recovered = Get-PathAclInfo -Path $Path
            $recoveredSddl = if ($recovered.Error) { '' } else { ([string]$recovered.Sddl -replace '\s+', '') }
            $beforeSddl = ([string]$before.Sddl -replace '\s+', '')
            if ($recoveredSddl.Length -gt 0 -and $recoveredSddl -eq $beforeSddl) {
                $failure += '; rollback was verified against the original SDDL'
            } else {
                $failure += '; ROLLBACK UNVERIFIED: ACL did not read back as the original SDDL, run the rollback command above manually'
            }
        }
        throw ('ACL repair failed for ' + $Path + ': ' + $failure)
    }
    return [pscustomobject]@{ Success = $true; Changed = $true; BackupFile = $backupFile }
}

function Repair-DoctorDesktopLabel {
    param([switch]$RestartExplorer)

    $desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desktop)) { throw 'Desktop folder could not be resolved.' }
    if (-not (Test-Path -LiteralPath $desktop)) { throw ('Desktop folder not found: ' + $desktop) }
    $repair = Repair-DoctorIntegrityLabel -Path $desktop
    if (-not $repair.Success) { throw 'Desktop ACL repair did not verify.' }
    if (-not $repair.Changed) {
        Write-DoctorInfo 'Desktop ACL is already clean - nothing to do.'
        return
    }
    Write-DoctorInfo ('Fixed: ' + $desktop + ' (Low label and Everyone deny verified absent)')

    if ($RestartExplorer) {
        try {
            Stop-Process -Name explorer -Force -ErrorAction Stop
            Write-DoctorStep 'Explorer restarted'
        } catch {
            Write-DoctorWarn ('Could not restart Explorer: ' + $_.Exception.Message)
        }
    } else {
        Write-DoctorStep 'Icons should refresh on their own within a few seconds; use -RestartExplorer to force it.'
    }
}

function Repair-DoctorWorkspaceLabel {
    $entries = @(Get-DshWorkspaceEntries)
    if ($entries.Count -eq 0) { Write-DoctorInfo 'No workspace entries found - nothing to do.'; return }

    $repaired = New-Object System.Collections.ArrayList
    $failed = New-Object System.Collections.ArrayList
    foreach ($entry in $entries) {
        if (-not (Test-Path -LiteralPath $entry)) { continue }
        try {
            $repair = Repair-DoctorIntegrityLabel -Path $entry
            if (-not $repair.Success) { throw 'verification did not succeed' }
            if ($repair.Changed) { [void]$repaired.Add($entry) }
        } catch {
            [void]$failed.Add($entry + ' (' + $_.Exception.Message + ')')
        }
    }

    if ($repaired.Count -eq 0 -and $failed.Count -eq 0) {
        Write-DoctorInfo 'All workspace labels are clean - nothing to do.'
        return
    }
    foreach ($path in $repaired) { Write-DoctorInfo ('Fixed: ' + $path + ' (Low label and Everyone deny verified absent; capability ACE kept)') }
    if ($failed.Count -gt 0) {
        foreach ($item in $failed) { Write-DoctorError ('Failed: ' + $item) }
        throw ('Workspace ACL repair failed for ' + $failed.Count + ' path(s); see rollback output above.')
    }
    if ($repaired.Count -gt 0) {
        Write-DoctorInfo 'If DSH re-applies the label after every provision, remove the workspace entry instead (fix -Id workspace-entry).'
    }
}

function Repair-DoctorProfileHostDup {
    param([switch]$Yes)

    $critical = @(Get-DoctorHostPackageNames)
    $stamp = (Get-DoctorStamp) + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $quarantineRoot = Join-Path (Get-DshHome) ('dsh-doctor-backups\hostpkgs-' + $stamp)
    $profilesRoot = Join-Path (Get-DshHome) 'profiles'
    $candidates = New-Object System.Collections.ArrayList
    if (Test-Path -LiteralPath $profilesRoot) {
        foreach ($profile in @(Get-ChildItem -LiteralPath $profilesRoot -Directory -ErrorAction SilentlyContinue)) {
            if ($profile.Name -like '*.stale*') { continue }
            # Only the profile's actual dependency tree, not arbitrary nested
            # packages or an existing quarantine, is a repair target.
            $target = Join-Path $profile.FullName 'node_modules\@deepseek-ai'
            if (-not (Test-Path -LiteralPath $target -PathType Container)) { continue }
            foreach ($name in $critical) {
                $packagePath = Join-Path $target $name
                if (-not (Test-Path -LiteralPath $packagePath)) { continue }
                $profileDir = Join-Path $quarantineRoot $profile.Name
                [void]$candidates.Add([pscustomobject]@{
                    Path = $packagePath; Name = $name; Profile = $profile.Name
                    Destination = Join-Path $profileDir ($name + '.stale-' + $stamp)
                })
            }
        }
    }
    if ($candidates.Count -eq 0) {
        Write-DoctorInfo 'No duplicate host-package folders found - nothing to do.'
        return
    }

    Write-DoctorWarn ('Found ' + $candidates.Count + ' host-package copy/copies:')
    foreach ($candidate in $candidates) { Write-Host ('    ' + $candidate.Path) -ForegroundColor Yellow }
    if (-not $Yes) {
        $answer = Read-Host 'Move only these host-package copies into the doctor backup folder? [y/N]'
        if ($answer -notmatch '^(y|yes)$') {
            Write-DoctorInfo 'Cancelled - nothing changed.'
            return
        }
    }

    $moved = New-Object System.Collections.ArrayList
    $failed = New-Object System.Collections.ArrayList
    foreach ($candidate in $candidates) {
        try {
            if (Test-Path -LiteralPath $candidate.Destination) { throw ('quarantine destination already exists: ' + $candidate.Destination) }
            $parent = Split-Path -Parent $candidate.Destination
            New-Item -ItemType Directory -Force -Path $parent -ErrorAction Stop | Out-Null
            Move-Item -LiteralPath $candidate.Path -Destination $candidate.Destination -ErrorAction Stop
            if (Test-Path -LiteralPath $candidate.Path) { throw 'source still exists after move' }
            if (-not (Test-Path -LiteralPath $candidate.Destination)) { throw 'quarantine destination was not created' }
            [void]$moved.Add($candidate)
            Write-DoctorStep ('Quarantined: ' + $candidate.Path + ' -> ' + $candidate.Destination)
        } catch {
            [void]$failed.Add($candidate.Path + ': ' + $_.Exception.Message)
        }
    }

    # Re-run the real read-only check. An unreadable or remaining target is not success.
    $remaining = @(Test-DoctorProfileHostDup | Where-Object { $_.Id -eq 'profile-host-duplicate' })
    if ($remaining.Count -gt 0) { [void]$failed.Add('post-check still found ' + $remaining.Count + ' profile host-package folder(s)') }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate.Path) {
            if (-not ($failed | Where-Object { $_.StartsWith($candidate.Path + ':', [StringComparison]::OrdinalIgnoreCase) })) {
                [void]$failed.Add($candidate.Path + ': source still exists after the operation')
            }
        }
    }
    if ($failed.Count -gt 0) {
        foreach ($item in $failed) { Write-DoctorError ('Failed: ' + $item) }
        throw 'Host-package quarantine did not fully verify; no partial success is reported.'
    }
    Write-DoctorInfo ('Quarantined and verified ' + $moved.Count + ' host-package copy/copies.')
    Write-DoctorInfo 'Other plugins in the same folder were left untouched. Fully quit and restart DSH.'
    foreach ($candidate in $moved) {
        Write-DoctorInfo ('Rollback: Move-Item -LiteralPath "' + $candidate.Destination + '" -Destination "' + $candidate.Path + '"')
    }
}

function Remove-DoctorWorkspaceEntries {
    param(
        [Parameter(Mandatory)][string[]]$Paths,
        [switch]$Yes
    )

    $file = Join-Path (Get-DshHome) 'storages\workspace.json'
    if (-not (Test-Path -LiteralPath $file)) { throw ('Workspace registry not found: ' + $file) }

    Write-DoctorWarn 'The desktop app may rewrite this file while it runs. Quit DSH first if possible.'
    Write-DoctorStep ('Registry: ' + $file)
    foreach ($path in $Paths) { Write-Host ('    removing entry: ' + $path) -ForegroundColor Yellow }

    if (-not $Yes) {
        $answer = Read-Host 'Remove these workspace entries? [y/N]'
        if ($answer -notmatch '^(y|yes)$') {
            Write-DoctorInfo 'Cancelled - nothing changed.'
            return
        }
    }

    $raw = Get-Content -LiteralPath $file -Raw -Encoding UTF8
    $data = $null
    try { $data = $raw | ConvertFrom-Json } catch { throw 'workspace.json is not valid JSON - nothing changed.' }
    if ($null -eq $data -or $null -eq $data.tables -or $null -eq $data.tables.workspaces) {
        throw 'workspace.json structure is unknown - nothing changed.'
    }

    $backup = $file + '.bak-' + (Get-DoctorStamp)
    Copy-Item -LiteralPath $file -Destination $backup -Force

    # 结构级删除：删记录 + 删 global.workspaceIds 里的引用，不再按字符串抠。
    $targets = @{}
    foreach ($path in $Paths) { $targets[$path.ToLowerInvariant()] = $true }
    $removed = New-Object System.Collections.ArrayList
    $records = $data.tables.workspaces
    foreach ($property in @($records.PSObject.Properties)) {
        $recordPath = [string]$property.Value.path
        if ([string]::IsNullOrWhiteSpace($recordPath)) { continue }
        if (-not $targets.ContainsKey($recordPath.ToLowerInvariant())) { continue }
        [void]$removed.Add([string]$property.Name)
        $records.PSObject.Properties.Remove($property.Name)
    }
    if ($removed.Count -eq 0) { Write-DoctorInfo 'No matching workspace entries found.'; return }

    if ($null -ne $data.global -and $null -ne $data.global.workspaceIds) {
        $kept = @($data.global.workspaceIds | Where-Object { $removed -notcontains [string]$_ })
        $data.global.workspaceIds = $kept
    }

    $updated = $data | ConvertTo-Json -Depth 20
    try { $null = $updated | ConvertFrom-Json } catch {
        Write-DoctorError 'Validation failed - restoring the backup.'
        Copy-Item -LiteralPath $backup -Destination $file -Force
        throw 'Workspace registry edit aborted (JSON validation failed).'
    }

    Set-Content -LiteralPath $file -Value $updated -Encoding UTF8
    Write-DoctorInfo ('Removed ' + $removed.Count + ' workspace record(s). Restart the desktop app.')
    Write-DoctorInfo ('Rollback: Copy-Item "' + $backup + '" "' + $file + '" -Force')
}

function Repair-DoctorPatchLayer {
    $profilesRoot = Join-Path (Get-DshHome) 'profiles'
    if (-not (Test-Path -LiteralPath $profilesRoot)) { throw ('Profiles directory not found: ' + $profilesRoot) }
    $restored = New-Object System.Collections.ArrayList
    foreach ($profile in @(Get-ChildItem -LiteralPath $profilesRoot -Directory -ErrorAction SilentlyContinue)) {
        if ($profile.Name -like '*.stale*') { continue }
        $backups = @(Get-ChildItem -LiteralPath $profile.FullName -Filter 'cordis.patch.yml.bak*' -File -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
        if ($backups.Count -eq 0) { continue }
        $patchFile = Join-Path $profile.FullName 'cordis.patch.yml'
        $size = -1
        if (Test-Path -LiteralPath $patchFile) { $size = (Get-Item -LiteralPath $patchFile).Length }
        if ($size -gt 2) { continue }
        if (Test-Path -LiteralPath $patchFile) {
            Copy-Item -LiteralPath $patchFile -Destination ($patchFile + '.empty-' + (Get-DoctorStamp)) -Force
        }
        Copy-Item -LiteralPath $backups[0].FullName -Destination $patchFile -Force
        [void]$restored.Add($profile.Name)
    }
    if ($restored.Count -eq 0) { Write-DoctorInfo 'No patch layer needs restoring.'; return }
    Write-DoctorInfo ('Restored cordis.patch.yml for: ' + ($restored -join ', ') + '. Restart the desktop app.')
}

function Repair-DoctorCookies {
    $running = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        throw 'DSH 还在运行：请先从托盘完全退出 DSH，再执行清理。'
    }
    $network = Join-Path $env:APPDATA '@deepseek-ai\dsh-desktop\Network'
    if (-not (Test-Path -LiteralPath $network)) {
        Write-DoctorInfo '没有找到 cookie 目录，无需清理。'
        return
    }
    $backup = Join-Path (Get-DshHome) ('dsh-doctor-backups\cookies-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    New-Item -ItemType Directory -Force -Path $backup | Out-Null
    $moved = @()
    foreach ($name in @('Cookies', 'Cookies-journal')) {
        $src = Join-Path $network $name
        if (-not (Test-Path -LiteralPath $src)) { continue }
        Copy-Item -LiteralPath $src -Destination (Join-Path $backup $name) -Force
        Remove-Item -LiteralPath $src -Force
        $moved += $name
    }
    if ($moved.Count -eq 0) {
        Write-DoctorInfo '没有可清理的 cookie 文件。'
        return
    }
    Write-DoctorInfo ('已备份并清理：' + ($moved -join '、') + ' → ' + $backup)
    Write-DoctorInfo '重新打开 DSH 并登录即可；每次启动仍会多一条，建议每 1~2 个月清一次。'
}

function Repair-DoctorMissingWorkspaces {
    $entries = @(Get-DshWorkspaceEntries)
    if ($entries.Count -eq 0) { Write-DoctorInfo 'No workspace entries found - nothing to do.'; return }
    $created = New-Object System.Collections.ArrayList
    $failed = New-Object System.Collections.ArrayList
    foreach ($entry in $entries) {
        if (Test-Path -LiteralPath $entry) { continue }
        try {
            [void][System.IO.Directory]::CreateDirectory($entry)
            [void]$created.Add($entry)
        } catch {
            [void]$failed.Add($entry + ' (' + $_.Exception.Message + ')')
        }
    }
    if ($created.Count -eq 0 -and $failed.Count -eq 0) { Write-DoctorInfo 'All workspace directories exist - nothing to do.'; return }
    foreach ($path in $created) { Write-DoctorInfo ('Created empty workspace directory: ' + $path) }
    foreach ($path in $failed) { Write-DoctorError ('Could not create: ' + $path) }
    if ($failed.Count -gt 0) { throw ('Could not create ' + $failed.Count + ' workspace director' + $(if ($failed.Count -eq 1) { 'y' } else { 'ies' }) + '.') }
    Write-DoctorInfo 'Directories are empty; move the project back or repoint the workspace to the new location.'
}

function Invoke-DoctorFixAll {
    $findings = @(Invoke-DoctorScan)
    $map = @{
        'desktop-low-label' = 'desktop-label'
        'desktop-everyone-deny' = 'desktop-label'
        'workspace-low-label' = 'workspace-label'
        'workspace-everyone-deny' = 'workspace-label'
        'profile-host-duplicate' = 'profile-host-dup'
        'patch-layer-missing' = 'restore-patch-layer'
        'workspace-missing' = 'create-workspace-dir'
    }
    $wanted = New-Object System.Collections.ArrayList
    foreach ($finding in $findings) {
        if (-not $map.ContainsKey([string]$finding.Id)) { continue }
        $fixId = $map[[string]$finding.Id]
        if (-not $wanted.Contains($fixId)) { [void]$wanted.Add($fixId) }
    }
    if ($wanted.Count -eq 0) {
        Write-DoctorInfo '一键修复：没有发现可自动修复的问题。'
        Write-DoctorInfo '（危险的 workspace 移除、需要退出 DSH 的 cookie 清理等仍请在菜单里单独操作。）'
        return
    }
    Write-DoctorInfo ('一键修复：共 ' + $wanted.Count + ' 类可修项，开始执行……')
    $failed = 0
    foreach ($fixId in $wanted) {
        Write-DoctorStep ('一键修复 → ' + $fixId)
        try {
            Invoke-DoctorFix -Id $fixId -Yes
        } catch {
            $failed += 1
            Write-DoctorError ('  失败：' + $_.Exception.Message)
        }
    }
    if ($failed -eq 0) { Write-DoctorInfo '一键修复完成。' }
    else { throw ('一键修复有 ' + $failed + ' 项失败，请按上面的备份/还原命令处理。') }
}

function Get-DoctorFixCatalog {
    return @(
        [pscustomobject]@{ Id = 'desktop-label'; Description = 'Reset Desktop Low integrity label and Everyone deny ACE' },
        [pscustomobject]@{ Id = 'workspace-label'; Description = 'Reset workspace Low integrity labels and Everyone deny ACEs' },
        [pscustomobject]@{ Id = 'workspace-entry'; Description = 'Back up and remove risky workspace registry entries' },
        [pscustomobject]@{ Id = 'create-workspace-dir'; Description = 'Create missing registered workspace directories (legacy alias: workspace-create)' },
        [pscustomobject]@{ Id = 'profile-host-dup'; Description = 'Quarantine duplicate host packages, preserving profile names' },
        [pscustomobject]@{ Id = 'restore-patch-layer'; Description = 'Restore an empty or missing cordis.patch.yml from its backup' },
        [pscustomobject]@{ Id = 'clear-cookies'; Description = 'Back up and clear accumulated DSH cookies (DSH must be stopped)' }
    )
}

function Show-DoctorFixCatalog {
    foreach ($fix in @(Get-DoctorFixCatalog)) {
        Write-Host ($fix.Id.PadRight(22) + $fix.Description)
    }
}

function Invoke-DoctorFix {
    param(
        [Parameter(Mandatory)][string]$Id,
        [switch]$Yes,
        [switch]$RestartExplorer
    )

    switch ($Id.ToLowerInvariant()) {
        'desktop-label' {
            Repair-DoctorDesktopLabel -RestartExplorer:$RestartExplorer
        }
        'profile-host-dup' {
            Repair-DoctorProfileHostDup -Yes:$Yes
        }
        'workspace-entry' {
            $findings = @(Invoke-DoctorScan)
            $targets = @($findings | Where-Object { $_.Id -eq 'workspace-risky-path' } | ForEach-Object { $_.Path } | Select-Object -Unique)
            if ($targets.Count -eq 0) {
                Write-DoctorInfo 'No risky workspace entries found - nothing to do.'
                return
            }
            Remove-DoctorWorkspaceEntries -Paths $targets -Yes:$Yes
        }
        'restore-patch-layer' {
            Repair-DoctorPatchLayer
        }
        'clear-cookies' {
            Repair-DoctorCookies
        }
        'create-workspace-dir' {
            Repair-DoctorMissingWorkspaces
        }
        'workspace-create' {
            # v0.14.x 兼容别名；新脚本统一使用 JS 侧同一 ID。
            Repair-DoctorMissingWorkspaces
        }
        'workspace-label' {
            Repair-DoctorWorkspaceLabel
        }
        default {
            throw ('Unknown fix id: ' + $Id + '. Run "dsh-doctor.cmd list" for the complete fix catalog.')
        }
    }
}
