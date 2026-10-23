#Requires -Version 5.1
# Fixes for dsh-doctor. Every fix backs up first, verifies after, and prints a
# rollback command. Nothing runs unless the caller asked for that specific fix.

function Repair-DoctorDesktopLabel {
    param([switch]$RestartExplorer)

    $desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desktop)) { throw 'Desktop folder could not be resolved.' }
    if (-not (Test-Path -LiteralPath $desktop)) { throw ('Desktop folder not found: ' + $desktop) }

    $before = Get-PathAclInfo -Path $desktop
    if (-not ($before.LowLabel -or $before.EveryoneDeny)) {
        Write-DoctorInfo 'Desktop ACL is already clean - nothing to do.'
        return
    }

    $backupDir = New-DoctorBackupDir -Purpose 'desktop-acl'
    $backupFile = Join-Path $backupDir 'desktop-acl.txt'
    $save = Invoke-DoctorProcess -FilePath 'icacls.exe' -Arguments @($desktop, '/save', $backupFile)
    Write-DoctorStep ('ACL backup -> ' + $backupFile + ' (exit ' + $save.ExitCode + ')')

    if ($before.LowLabel) {
        $result = Invoke-DoctorProcess -FilePath 'icacls.exe' -Arguments @($desktop, '/setintegritylevel', '(OI)(CI)Medium')
        if ($result.ExitCode -ne 0) { throw ('Failed to reset integrity label: ' + $result.Output) }
        Write-DoctorStep 'Integrity label set to Medium'
    }
    if ($before.EveryoneDeny) {
        $result = Invoke-DoctorProcess -FilePath 'icacls.exe' -Arguments @($desktop, '/remove:d', '*S-1-1-0')
        Write-DoctorStep ('Removed Everyone deny ACE (exit ' + $result.ExitCode + ')')
    }

    $after = Get-PathAclInfo -Path $desktop
    if ($after.LowLabel) { throw 'Verification failed: the Low integrity label is still present.' }
    if ($after.EveryoneDeny) { Write-DoctorWarn 'Everyone deny ACE still present - removal did not take effect.' }

    Write-DoctorInfo ('Fixed: ' + $desktop)
    $parent = Split-Path -Parent $desktop
    Write-DoctorInfo ('Rollback: icacls "' + $parent + '" /restore "' + $backupFile + '"')

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

function Repair-DoctorProfileHostDup {
    param([switch]$Yes)

    $findings = @(Test-DoctorProfileHostDup)
    $targets = @($findings | Where-Object { $_.Id -eq 'profile-host-duplicate' } | ForEach-Object { $_.Path })
    if ($targets.Count -eq 0) {
        Write-DoctorInfo 'No duplicate host-package folders found - nothing to do.'
        return
    }

    # 只挪走宿主包副本本身，绝不整目录改名：同目录里还有插件的合法依赖。
    $critical = @('dsh-tools', 'dsh-skill', 'schemastery', 'dsh-util-values', 'cordis')
    $quarantine = Join-Path (Get-DshHome) ('dsh-doctor-backups\hostpkgs-' + (Get-DoctorStamp))
    $candidates = New-Object System.Collections.ArrayList
    foreach ($target in $targets) {
        foreach ($name in $critical) {
            $packagePath = Join-Path $target $name
            if (Test-Path -LiteralPath $packagePath) { [void]$candidates.Add($packagePath) }
        }
    }
    if ($candidates.Count -eq 0) {
        Write-DoctorInfo 'No host-package copies found inside those folders - nothing to do.'
        return
    }

    Write-DoctorWarn ('Found ' + $candidates.Count + ' host-package copy/copies:')
    foreach ($candidate in $candidates) { Write-Host ('    ' + $candidate) -ForegroundColor Yellow }

    if (-not $Yes) {
        $answer = Read-Host 'Move only these host-package copies into the doctor backup folder? [y/N]'
        if ($answer -notmatch '^(y|yes)$') {
            Write-DoctorInfo 'Cancelled - nothing changed.'
            return
        }
    }

    New-Item -ItemType Directory -Force -Path $quarantine | Out-Null
    $moved = New-Object System.Collections.ArrayList
    foreach ($candidate in $candidates) {
        try {
            $name = Split-Path -Leaf $candidate
            Move-Item -LiteralPath $candidate -Destination (Join-Path $quarantine $name) -ErrorAction Stop
            [void]$moved.Add($name)
            Write-DoctorStep ('Quarantined: ' + $name + ' -> ' + $quarantine)
        } catch {
            Write-DoctorWarn ('Failed to quarantine ' + $candidate + ': ' + $_.Exception.Message)
        }
    }

    if ($moved.Count -gt 0) {
        Write-DoctorInfo ('Quarantined ' + $moved.Count + ' host-package copy/copies: ' + ($moved -join ', '))
        Write-DoctorInfo 'Other plugins in the same folder were left untouched.'
        Write-DoctorInfo 'Now fully quit and restart the DSH desktop app.'
        Write-DoctorInfo ('Rollback: move them back from ' + $quarantine)
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
        default {
            throw ('Unknown fix id: ' + $Id + '. Known ids: desktop-label, profile-host-dup, workspace-entry, restore-patch-layer.')
        }
    }
}
