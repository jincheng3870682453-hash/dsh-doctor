#Requires -Version 5.1
# Console rendering, JSON output and the bug-report bundle.

function Show-DoctorFindings {
    param([object[]]$Findings)

    $items = @()
    if ($null -ne $Findings) { $items = @($Findings) }
    if ($items.Count -eq 0) {
        Write-Host 'No findings. This machine looks clean.' -ForegroundColor Green
        return
    }

    $order = @{ High = 0; Medium = 1; Low = 2; Info = 3 }
    $sorted = @($items | Sort-Object -Property @{ Expression = { $order[[string]$_.Severity] } }, @{ Expression = { $_.Id } })

    foreach ($finding in $sorted) {
        $color = 'Gray'
        switch ([string]$finding.Severity) {
            'High' { $color = 'Red' }
            'Medium' { $color = 'Yellow' }
            'Low' { $color = 'DarkYellow' }
            default { $color = 'Gray' }
        }
        Write-Host ''
        Write-Host ('[' + $finding.Severity + '] ' + $finding.Title) -ForegroundColor $color
        if ($finding.Path) { Write-Host ('  path:     ' + $finding.Path) -ForegroundColor DarkGray }
        if ($finding.Detail) { Write-Host ('  detail:   ' + $finding.Detail) -ForegroundColor Gray }
        foreach ($evidence in @($finding.Evidence)) {
            if ($evidence) { Write-Host ('  evidence: ' + $evidence) -ForegroundColor DarkGray }
        }
        if ($finding.Fix) { Write-Host ('  fix:      ' + $finding.Fix) -ForegroundColor Cyan }
    }

    $high = @($items | Where-Object { $_.Severity -eq 'High' }).Count
    $medium = @($items | Where-Object { $_.Severity -eq 'Medium' }).Count
    $info = @($items | Where-Object { $_.Severity -eq 'Info' }).Count
    Write-Host ''
    Write-Host ('Summary: ' + $high + ' high / ' + $medium + ' medium / ' + $info + ' info') -ForegroundColor Cyan
    if ($high -gt 0) { Write-DoctorWarn 'At least one High finding means the desktop app is currently in a broken state.' }
}

function ConvertTo-DoctorScanJson {
    param($Findings, $Environment)
    $payload = [ordered]@{
        tool        = 'dsh-doctor'
        version     = Get-DoctorVersion
        timestamp   = Get-DoctorTimestamp
        environment = $Environment
        findings    = @($Findings)
    }
    return ($payload | ConvertTo-Json -Depth 8)
}

function New-DoctorReportBundle {
    param(
        [string]$OutDir,
        [object[]]$Findings,
        $Environment
    )

    if ([string]::IsNullOrWhiteSpace($OutDir)) {
        $OutDir = Join-Path ([Environment]::CurrentDirectory) ('dsh-doctor-report-' + (Get-DoctorStamp))
    }
    if (-not (Test-Path -LiteralPath $OutDir)) {
        New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
    }

    $items = @()
    if ($null -ne $Findings) { $items = @($Findings) }

    $jsonFile = Join-Path $OutDir 'findings.json'
    ConvertTo-DoctorScanJson -Findings $items -Environment $Environment | Set-Content -LiteralPath $jsonFile -Encoding UTF8

    $md = New-Object System.Text.StringBuilder
    [void]$md.AppendLine('# dsh-doctor report')
    [void]$md.AppendLine('')
    [void]$md.AppendLine('- generated: ' + (Get-DoctorTimestamp))
    [void]$md.AppendLine('- tool: dsh-doctor ' + (Get-DoctorVersion))
    [void]$md.AppendLine('- host: ' + $env:COMPUTERNAME)
    [void]$md.AppendLine('- os: ' + [Environment]::OSVersion.VersionString)
    [void]$md.AppendLine('- powershell: ' + [string]$PSVersionTable.PSVersion)
    [void]$md.AppendLine('')
    [void]$md.AppendLine('## Findings')
    [void]$md.AppendLine('')

    if ($items.Count -eq 0) {
        [void]$md.AppendLine('_No findings._')
    }
    foreach ($finding in $items) {
        [void]$md.AppendLine('### [' + $finding.Severity + '] ' + $finding.Title)
        [void]$md.AppendLine('')
        if ($finding.Path) { [void]$md.AppendLine('- path: `' + $finding.Path + '`') }
        if ($finding.Detail) { [void]$md.AppendLine('- detail: ' + $finding.Detail) }
        foreach ($evidence in @($finding.Evidence)) {
            if ($evidence) { [void]$md.AppendLine('- evidence: `' + [string]$evidence + '`') }
        }
        if ($finding.Fix) { [void]$md.AppendLine('- fix: `' + $finding.Fix + '`') }
        [void]$md.AppendLine('')
    }

    [void]$md.AppendLine('## Environment')
    [void]$md.AppendLine('')
    if ($null -ne $Environment) {
        foreach ($key in $Environment.Keys) {
            $value = $Environment[$key]
            if ($value -is [System.Array]) {
                $rendered = @($value | ForEach-Object { if ($_ -is [string]) { $_ } else { ($_ | Out-String).Trim() } }) -join '; '
            } else {
                $rendered = [string]$value
            }
            [void]$md.AppendLine('- ' + $key + ': ' + $rendered)
        }
    }

    $mdFile = Join-Path $OutDir 'report.md'
    Set-Content -LiteralPath $mdFile -Value $md.ToString() -Encoding UTF8
    return [pscustomobject]@{ Markdown = $mdFile; Json = $jsonFile; Directory = $OutDir }
}
