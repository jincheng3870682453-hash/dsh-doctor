#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Position = 0)][string]$Command = 'scan',
    [string]$Id = '',
    [string]$Out = '',
    [int]$Seconds = 120,
    [switch]$Json,
    [switch]$Yes,
    [switch]$RestartExplorer
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$libRoot = Join-Path $PSScriptRoot 'lib'
foreach ($lib in @('common.ps1', 'checks.ps1', 'fixes.ps1', 'report.ps1')) {
    $libPath = Join-Path $libRoot $lib
    if (-not (Test-Path -LiteralPath $libPath)) { throw ('Missing library file: ' + $libPath) }
    . $libPath
}

function Show-DoctorHelp {
    Write-DoctorInfo ('dsh-doctor ' + (Get-DoctorVersion) + ' - Windows health check for DeepSeek Harness')
    Write-Host ''
    Write-Host 'Usage:'
    Write-Host '  dsh-doctor.cmd scan                     Read-only health check (default)'
    Write-Host '  dsh-doctor.cmd scan -Json               Machine-readable output'
    Write-Host '  dsh-doctor.cmd list                     List available fixes'
    Write-Host '  dsh-doctor.cmd fix -Id <id> [-Yes]      Apply one fix'
    Write-Host '  dsh-doctor.cmd report [-Out <dir>]      Write a bug-report bundle'
    Write-Host '  dsh-doctor.cmd watch [-Seconds 120]     Watch the Desktop and report who is writing to it'
    Write-Host '  dsh-doctor.cmd version                  Print the version'
    Write-Host ''
    Write-Host 'Fixes:'
    Write-Host '  desktop-label      Reset the Desktop integrity label / Everyone deny ACE'
    Write-Host '  workspace-entry    Remove Desktop-like paths from the DSH workspace registry'
    Write-Host '  profile-host-dup   Quarantine duplicate host packages inside a profile'
    Write-Host ''
}

try {
    switch ($Command.ToLowerInvariant()) {
        'scan' {
            $findings = @(Invoke-DoctorScan)
            $environment = Get-DoctorEnvironmentSnapshot
            if ($Json) {
                ConvertTo-DoctorScanJson -Findings $findings -Environment $environment
            } else {
                Write-DoctorInfo ('dsh-doctor ' + (Get-DoctorVersion) + ' - scanning ' + (Get-DshHome))
                Show-DoctorFindings -Findings $findings
            }
        }
        'list' {
            Write-Host 'desktop-label      Reset the Desktop integrity label / Everyone deny ACE'
            Write-Host 'workspace-entry    Remove Desktop-like paths from the DSH workspace registry'
            Write-Host 'profile-host-dup   Quarantine duplicate host packages inside a profile'
        }
        'fix' {
            if ([string]::IsNullOrWhiteSpace($Id)) { throw 'fix requires -Id. Run "dsh-doctor.cmd list" to see the ids.' }
            Invoke-DoctorFix -Id $Id -Yes:$Yes -RestartExplorer:$RestartExplorer
        }
        'report' {
            $findings = @(Invoke-DoctorScan)
            $environment = Get-DoctorEnvironmentSnapshot
            $bundle = New-DoctorReportBundle -OutDir $Out -Findings $findings -Environment $environment
            Write-DoctorInfo ('Report bundle: ' + $bundle.Directory)
            Write-Host ('  markdown: ' + $bundle.Markdown)
            Write-Host ('  json:     ' + $bundle.Json)
        }
        'watch' {
            Watch-DoctorDesktop -Seconds $Seconds
        }
        'version' {
            Get-DoctorVersion
        }
        default {
            Show-DoctorHelp
        }
    }
} catch {
    Write-DoctorError ('dsh-doctor failed: ' + $_.Exception.Message)
    if ($env:DSH_DOCTOR_DEBUG) { Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray }
    exit 1
}
