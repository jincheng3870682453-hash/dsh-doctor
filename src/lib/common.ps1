#Requires -Version 5.1
# Shared helpers for dsh-doctor. ASCII-only source: keep messages in English here,
# user-facing documentation lives in README.md / docs/ (UTF-8).

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$script:DshDoctorVersion = '0.1.0'

function Get-DoctorVersion {
    return $script:DshDoctorVersion
}

function Get-DshHome {
    if ($env:DSH_HOME) { return $env:DSH_HOME }
    $profileDir = [Environment]::GetFolderPath('UserProfile')
    if ([string]::IsNullOrWhiteSpace($profileDir)) { $profileDir = $HOME }
    return (Join-Path $profileDir '.dsh')
}

function Get-DoctorTimestamp {
    return (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
}

function Get-DoctorStamp {
    return (Get-Date).ToString('yyyyMMdd-HHmmss')
}

function Write-DoctorStep {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host ('  - ' + $Message) -ForegroundColor DarkGray
}

function Write-DoctorInfo {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Write-DoctorWarn {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow
}

function Write-DoctorError {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Red
}

function New-Finding {
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$Severity,
        [Parameter(Mandatory)][string]$Title,
        [string]$Detail = '',
        [string[]]$Evidence = @(),
        [string]$Fix = '',
        [string]$Path = ''
    )
    [pscustomobject]@{
        Id       = $Id
        Severity = $Severity
        Title    = $Title
        Detail   = $Detail
        Path     = $Path
        Evidence = @($Evidence)
        Fix      = $Fix
    }
}

function Get-JsonProperty {
    param($Object, [string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $Default }
    return $prop.Value
}

function Invoke-DoctorProcess {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @()
    )
    $output = ''
    $exitCode = 0
    try {
        $output = (& $FilePath @Arguments 2>&1 | Out-String).Trim()
        $hasLastExitCode = $null -ne (Get-Variable -Name 'LASTEXITCODE' -ErrorAction SilentlyContinue)
        if ($hasLastExitCode) { $exitCode = [int]$LASTEXITCODE }
    } catch {
        $output = $_.Exception.Message
        $exitCode = -1
    }
    [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $output
    }
}

function New-DoctorBackupDir {
    param([string]$Purpose = 'backup')
    $base = Join-Path (Get-DshHome) 'dsh-doctor-backups'
    $dir = Join-Path $base (Get-DoctorStamp)
    $dir = Join-Path $dir $Purpose
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    return $dir
}

function Get-PathAclInfo {
    param([Parameter(Mandatory)][string]$Path)
    $result = [pscustomobject]@{
        Path           = $Path
        Exists         = $false
        Sddl           = ''
        LowLabel       = $false
        EveryoneDeny   = $false
        CapabilityAces = @()
        Error          = $null
    }
    if (-not (Test-Path -LiteralPath $Path)) { return $result }
    $result.Exists = $true
    try {
        $acl = Get-Acl -LiteralPath $Path
        $sddl = [string]$acl.Sddl
        $result.Sddl = $sddl
        $result.LowLabel = [bool]($sddl -match 'S:\(ML;;[^;]*;;;LW')
        $result.EveryoneDeny = [bool]($sddl -match '\(D;[^)]*;;;WD\)')
        $result.CapabilityAces = @(
            [regex]::Matches($sddl, 'S-1-4-[\d-]+') |
                ForEach-Object { $_.Value } |
                Sort-Object -Unique
        )
    } catch {
        $result.Error = $_.Exception.Message
    }
    return $result
}
