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

    Write-DoctorWarn ('Found ' + $targets.Count + ' duplicate host-package folder(s):')
    foreach ($target in $targets) { Write-Host ('    ' + $target) -ForegroundColor Yellow }

    if (-not $Yes) {
        $answer = Read-Host 'Quarantine them by renaming to @deepseek-ai.stale-<timestamp>? [y/N]'
        if ($answer -notmatch '^(y|yes)$') {
            Write-DoctorInfo 'Cancelled - nothing changed.'
            return
        }
    }

    $stamp = (Get-Date).ToString('yyyyMMddHHmmss')
    $renamed = New-Object System.Collections.ArrayList
    foreach ($target in $targets) {
        try {
            $item = Get-Item -LiteralPath $target -Force
            $newName = $item.Name + '.stale-' + $stamp
            Rename-Item -LiteralPath $target -NewName $newName -ErrorAction Stop
            [void]$renamed.Add($item.FullName)
            Write-DoctorStep ('Quarantined: ' + $target + ' -> ' + $newName)
        } catch {
            Write-DoctorWarn ('Failed to quarantine ' + $target + ': ' + $_.Exception.Message)
        }
    }

    if ($renamed.Count -gt 0) {
        Write-DoctorInfo ('Quarantined ' + $renamed.Count + ' folder(s).')
        Write-DoctorInfo 'Now fully quit and restart the DSH desktop app so the runtime reloads without the duplicate.'
        Write-DoctorInfo 'Rollback: rename each *.stale-<timestamp> folder back by removing the suffix.'
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
    $backup = $file + '.bak-' + (Get-DoctorStamp)
    Copy-Item -LiteralPath $file -Destination $backup -Force

    $updated = $raw
    foreach ($path in $Paths) {
        $jsonEscaped = $path.Replace('\', '\\')
        $updated = [regex]::Replace($updated, '"' + [regex]::Escape($jsonEscaped) + '"', '')
    }
    $updated = [regex]::Replace($updated, ',\s*([\]}])', '$1')
    $updated = [regex]::Replace($updated, '([\[{])\s*,', '$1')
    $updated = [regex]::Replace($updated, ',\s*,', ',')

    $valid = $true
    try { $null = $updated | ConvertFrom-Json } catch { $valid = $false }

    if (-not $valid) {
        Write-DoctorError 'Result is not valid JSON - restoring the backup.'
        Copy-Item -LiteralPath $backup -Destination $file -Force
        throw 'Workspace registry edit aborted (JSON validation failed).'
    }

    Set-Content -LiteralPath $file -Value $updated -Encoding UTF8 -NoNewline
    Write-DoctorInfo ('Updated ' + $file)
    Write-DoctorInfo ('Rollback: Copy-Item "' + $backup + '" "' + $file + '" -Force')
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
        default {
            throw ('Unknown fix id: ' + $Id + '. Known ids: desktop-label, profile-host-dup, workspace-entry.')
        }
    }
}
