#Requires -Version 5.1
# Shared helpers for dsh-doctor. ASCII-only source: keep messages in English here,
# user-facing documentation lives in README.md / docs/ (UTF-8).

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$script:DshDoctorVersion = '0.1.0'

function Get-DoctorVersion {
    # 打包时 build.ps1 会把上面的常量替换成 plugin/package.json 的真实版本；
    # 直接跑源码时退回到读仓库里的 package.json。
    if ($script:DshDoctorVersion -ne '0.1.0') { return $script:DshDoctorVersion }
    $candidates = @(
        (Join-Path $PSScriptRoot '..\..\plugin\package.json'),
        (Join-Path $PSScriptRoot '..\plugin\package.json')
    )
    foreach ($candidate in $candidates) {
        try {
            $pkg = Get-Content -LiteralPath $candidate -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($null -ne $pkg.version -and -not [string]::IsNullOrWhiteSpace([string]$pkg.version)) {
                return [string]$pkg.version
            }
        } catch { }
    }
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

function Get-SanitizedText {
    # 报告对外提交前脱敏：用户名 / 主机名 / 邮箱 / 用户主目录换成占位符，保留目录结构。
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return $Text }
    $out = $Text
    $out = [regex]::Replace($out, '([A-Za-z]:\\Users\\)([^\\/\s''"`()<>|,;]+)', '${1}user', 'IgnoreCase')
    $out = [regex]::Replace($out, '(/home/)([^/\s''"`()<>|,;]+)', '${1}user')
    $out = [regex]::Replace($out, '(/Users/)([^/\s''"`()<>|,;]+)', '${1}user')
    $user = [string]$env:USERNAME
    if (-not [string]::IsNullOrWhiteSpace($user) -and $user.Length -ge 3) {
        $out = [regex]::Replace($out, [regex]::Escape($user), 'user', 'IgnoreCase')
    }
    $machine = [string]$env:COMPUTERNAME
    if (-not [string]::IsNullOrWhiteSpace($machine) -and $machine.Length -ge 3) {
        $out = [regex]::Replace($out, [regex]::Escape($machine), '<machine>', 'IgnoreCase')
    }
    $out = [regex]::Replace($out, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', 'user@example.com')
    return $out
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
        # 容忍 AI 控制位与继承标志（SetNamedSecurityInfoW 写的标签读回是 S:AI(ML;;…，DSH 直写的没有）。
        # 字段结构固定：ML;flags;rights;;;LW —— flags 吸收 ID/CIOI，rights 吸收 NW/NWNR。
        $result.LowLabel = [bool]($sddl -match 'S:(AI)?\(ML;[^;]*;[^;]*;;;LW')
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
