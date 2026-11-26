#Requires -Version 5.1
# Smoke test: the module loads, findings have the expected shape, scanning and
# JSON export work even on a machine without DSH installed.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

$root = Split-Path -Parent $PSScriptRoot
$libRoot = Join-Path $root 'src'
$libRoot = Join-Path $libRoot 'lib'

foreach ($lib in @('common.ps1', 'checks.ps1', 'fixes.ps1', 'report.ps1')) {
    $libPath = Join-Path $libRoot $lib
    . $libPath
}

if ([string]::IsNullOrWhiteSpace((Get-DoctorVersion))) { throw 'Get-DoctorVersion returned nothing' }

$finding = New-Finding -Id 'smoke' -Severity 'High' -Title 'smoke'
if ($finding.Severity -ne 'High') { throw 'New-Finding returned an unexpected shape' }
if ($finding.Evidence.Count -ne 0) { throw 'New-Finding Evidence default is not empty' }

$acl = Get-PathAclInfo -Path ([Environment]::GetFolderPath('UserProfile'))
if ($null -eq $acl) { throw 'Get-PathAclInfo returned null' }

$environment = Get-DoctorEnvironmentSnapshot
if ($null -eq $environment) { throw 'Get-DoctorEnvironmentSnapshot returned null' }

$findings = @(Invoke-DoctorScan)
if ($null -eq $findings) { throw 'Invoke-DoctorScan returned null' }

$json = ConvertTo-DoctorScanJson -Findings $findings -Environment $environment
if ($json -notmatch '"findings"') { throw 'JSON export missing findings key' }
$parsed = $json | ConvertFrom-Json
if ($null -eq $parsed) { throw 'JSON export is not parseable' }

# 体检内部的"探路失败"（例如 where.exe 找不到 dsh）不能改调用方的退出码：
# EXE 用 powershell 跑内嵌脚本、CI 用 -Command 跑本脚本，都会把 $LASTEXITCODE 当进程退出码。
$leaked = Get-Variable -Name 'LASTEXITCODE' -ErrorAction SilentlyContinue
if ($null -ne $leaked -and [int]$leaked.Value -ne 0) {
    throw ('native probe leaked LASTEXITCODE=' + [string]$leaked.Value + ' into the scan; the EXE / CI would exit nonzero')
}

Write-Host ('smoke OK - ' + $findings.Count + ' finding(s)') -ForegroundColor Green
