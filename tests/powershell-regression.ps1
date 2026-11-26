#Requires -Version 5.1
# Isolated PowerShell regressions. No real DSH_HOME, Desktop, ACL or process is changed.
param([string]$FixtureRoot = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($FixtureRoot)) {
    $FixtureRoot = Join-Path $root ('.dsh-test-tmp\powershell-' + [guid]::NewGuid().ToString('N'))
}
$fixture = [IO.Path]::GetFullPath($FixtureRoot)
$allowed = [IO.Path]::GetFullPath((Join-Path $root '.dsh-test-tmp')).TrimEnd('\') + '\'
if (-not $fixture.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'FixtureRoot must be under .dsh-test-tmp' }
New-Item -ItemType Directory -Path $fixture -Force | Out-Null
$env:DSH_HOME = Join-Path $fixture 'home'
$env:DSH_DOCTOR_SYS = ''
New-Item -ItemType Directory -Path $env:DSH_HOME -Force | Out-Null
foreach ($lib in @('common.ps1', 'checks.ps1', 'fixes.ps1', 'report.ps1')) {
    . (Join-Path $root ('src\lib\' + $lib))
}
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Throws([scriptblock]$Action, [string]$Pattern) {
    $message = ''
    try { & $Action } catch { $message = $_.Exception.Message }
    Assert-True ($message -match $Pattern) ('Expected failure /' + $Pattern + '/, got: ' + $message)
}
function Write-Fixture([string]$Path, [string]$Text) {
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

# Both new credentials checks and patch detection are reached through the full scan.
Write-Fixture (Join-Path $env:DSH_HOME '.credentials.yaml') "records:`n  one:`n    token: redacted`n"
Write-Fixture (Join-Path $env:DSH_HOME '.credentials.yml') "version: '2'`n"
$profileDir = Join-Path $env:DSH_HOME 'profiles\alpha'
Write-Fixture (Join-Path $profileDir 'cordis.patch.yml.bak-1') 'name: test'
Write-Fixture (Join-Path $profileDir 'cordis.patch.yml') ''
$scan = @(Invoke-DoctorScan)
$ids = @($scan | ForEach-Object { $_.Id })
Assert-True ($ids -contains 'credentials-no-version') 'Full scan missed credentials-no-version'
Assert-True ($ids -contains 'credentials-version') 'Full scan missed credentials-version'
Assert-True ($ids -contains 'patch-layer-missing') 'Full scan missed patch-layer-missing'
Write-Host 'PASS full scan: credentials and patch findings'

# where.exe is simulated; no process is spawned for this check.
$dead = Join-Path $fixture 'missing\dsh.cmd'
$savedProcess = ${function:Invoke-DoctorProcess}
${function:Invoke-DoctorProcess} = { param($FilePath, [string[]]$Arguments) [pscustomobject]@{ ExitCode = 0; Output = $dead } }
$pathFinding = @(Test-DoctorPathVariable)
${function:Invoke-DoctorProcess} = $savedProcess
Assert-True ($pathFinding.Count -eq 1 -and $pathFinding[0].Id -eq 'path-dead-dsh') 'Dead PATH shim was not detected'
Write-Host 'PASS path-dead-dsh'

# Every detected package is repaired, with a profile-specific quarantine path.
$names = @(Get-DoctorHostPackageNames)
foreach ($profile in @('alpha', 'beta')) {
    foreach ($name in $names) { Write-Fixture (Join-Path $env:DSH_HOME ('profiles\' + $profile + '\node_modules\@deepseek-ai\' + $name + '\package.json')) ('{"name":"@deepseek-ai/' + $name + '"}') }
    Write-Fixture (Join-Path $env:DSH_HOME ('profiles\' + $profile + '\node_modules\@deepseek-ai\valid-plugin\package.json')) '{"name":"valid-plugin"}'
}
$before = @(Test-DoctorProfileHostDup | Where-Object { $_.Id -eq 'profile-host-duplicate' })
Assert-True ($before.Count -eq 2) 'Host-package scan did not find both profiles'
Repair-DoctorProfileHostDup -Yes
$after = @(Test-DoctorProfileHostDup | Where-Object { $_.Id -eq 'profile-host-duplicate' })
Assert-True ($after.Count -eq 0) 'Host-package post-check still has findings'
foreach ($profile in @('alpha', 'beta')) {
    Assert-True (Test-Path -LiteralPath (Join-Path $env:DSH_HOME ('profiles\' + $profile + '\node_modules\@deepseek-ai\valid-plugin'))) 'Valid plugin was moved'
    foreach ($name in $names) {
        $copy = @(Get-ChildItem -LiteralPath (Join-Path $env:DSH_HOME 'dsh-doctor-backups') -Recurse -Directory -Filter ($name + '.stale-*') | Where-Object { $_.FullName -match ('[\\/]' + [regex]::Escape($profile) + '[\\/]') })
        Assert-True ($copy.Count -eq 1) ('Missing profile-preserved quarantine: ' + $profile + '/' + $name)
    }
}
Write-Host 'PASS host package parity, profile quarantine and post-check'

# ACL tests use only fixture state and a mocked icacls. They never call real icacls.
function New-MockAcl([bool]$Low, [bool]$Deny) {
    [pscustomobject]@{ Exists = $true; Sddl = 'fixture'; LowLabel = $Low; EveryoneDeny = $Deny; CapabilityAces = @(); Error = $null }
}
$target = Join-Path $fixture 'acl-target'
New-Item -ItemType Directory -Path $target -Force | Out-Null
$script:aclMode = ''
$script:aclLow = $true
$script:aclDeny = $true
$script:restored = $false
$script:wrongRestore = $false
$script:aclCalls = @()
function Reset-AclMock {
    $script:aclMode = ''
    $script:aclLow = $true
    $script:aclDeny = $true
    $script:restored = $false
    $script:wrongRestore = $false
    $script:aclCalls = @()
}
${function:Get-PathAclInfo} = {
    param([string]$Path)
    if ($script:aclMode -eq 'unreadable') { return [pscustomobject]@{ Exists = $true; Sddl = ''; LowLabel = $false; EveryoneDeny = $false; CapabilityAces = @(); Error = 'simulated unreadable ACL' } }
    $mock = New-MockAcl $script:aclLow $script:aclDeny
    if ($script:restored -and $script:wrongRestore) {
        # 模拟 /restore 退出码为 0，但读回的 ACL 与原始 SDDL 不一致。
        $mock.Sddl = 'not-the-original-sddl'
        $mock.LowLabel = $false
        $mock.EveryoneDeny = $false
    }
    return $mock
}
${function:Invoke-DoctorProcess} = {
    param([string]$FilePath, [string[]]$Arguments)
    $script:aclCalls += ,@($Arguments)
    if ($Arguments[1] -eq '/save') {
        if ($script:aclMode -eq 'backup-fail') { return [pscustomobject]@{ ExitCode = 5; Output = 'simulated backup failure' } }
        if ($script:aclMode -eq 'empty-backup') { Write-Fixture $Arguments[2] ''; return [pscustomobject]@{ ExitCode = 0; Output = 'empty' } }
        Write-Fixture $Arguments[2] 'confirmed ACL backup'
        return [pscustomobject]@{ ExitCode = 0; Output = 'saved' }
    }
    if ($Arguments[1] -eq '/setintegritylevel') { $script:aclLow = $false; return [pscustomobject]@{ ExitCode = 0; Output = 'medium' } }
    if ($Arguments[1] -eq '/remove:d') {
        # rollback-wrong 与 deny-fails 都让删除"成功但未生效"，复检仍看到拒绝项 → 触发回滚。
        if ($script:aclMode -ne 'deny-fails' -and $script:aclMode -ne 'rollback-wrong') { $script:aclDeny = $false }
        return [pscustomobject]@{ ExitCode = 0; Output = 'removed' }
    }
    if ($Arguments[1] -eq '/restore') {
        $script:aclLow = $true; $script:aclDeny = $true
        $script:restored = $true
        return [pscustomobject]@{ ExitCode = 0; Output = 'restored fixture' }
    }
    throw ('Unexpected icacls operation: ' + ($Arguments -join ' '))
}
$script:aclMode = 'backup-fail'
$script:aclCalls = @()
Assert-Throws { Repair-DoctorIntegrityLabel -Path $target } 'ACL backup failed'
Assert-True (@($script:aclCalls | Where-Object { $_[1] -ne '/save' }).Count -eq 0) 'ACL was changed after backup failure'
Write-Host 'PASS ACL backup failure is fail-closed'
foreach ($mode in @('empty-backup', 'unreadable')) {
    $script:aclMode = $mode; $script:aclCalls = @()
    Assert-Throws { Repair-DoctorIntegrityLabel -Path $target } 'ACL'
    Assert-True (@($script:aclCalls | Where-Object { $_[1] -ne '/save' }).Count -eq 0) ('ACL was changed in ' + $mode)
}
Write-Host 'PASS empty backup and unreadable ACL are fail-closed'

$script:aclMode = 'deny-fails'
Reset-AclMock
$script:aclMode = 'deny-fails'
Assert-Throws { Repair-DoctorIntegrityLabel -Path $target } 'Everyone deny ACE'
Assert-True (@($script:aclCalls | Where-Object { $_[1] -eq '/restore' }).Count -eq 1) 'Confirmed backup was not restored'
Assert-True ($script:aclLow -and $script:aclDeny) 'Fixture ACL was not rolled back'
Write-Host 'PASS Everyone deny verification failure and rollback'

$script:aclMode = 'success'; $script:aclLow = $true; $script:aclDeny = $true; $script:aclCalls = @()
$script:restored = $false; $script:wrongRestore = $false
$success = Repair-DoctorIntegrityLabel -Path $target
Assert-True ($success.Success -and $success.Changed -and -not $script:aclLow -and -not $script:aclDeny) 'ACL successful transaction did not verify clean'
Assert-True (@($script:aclCalls | Where-Object { $_[1] -eq '/restore' }).Count -eq 0) 'Successful ACL repair unexpectedly rolled back'
Assert-True (([IO.File]::ReadAllText($success.BackupFile + '.path.txt', [Text.Encoding]::UTF8)) -eq $target) 'ACL backup lost its original target path'
Write-Host 'PASS ACL clean verification and rollback metadata'

Reset-AclMock
$script:aclMode = 'rollback-wrong'
$script:wrongRestore = $true
Assert-Throws { Repair-DoctorIntegrityLabel -Path $target } 'ROLLBACK UNVERIFIED'
Write-Host 'PASS rollback result is compared with original SDDL'
Reset-AclMock
$script:aclMode = 'deny-fails'
Assert-Throws { Repair-DoctorIntegrityLabel -Path $target } 'rollback was verified'
Write-Host 'PASS matching original SDDL verifies rollback'

# A failed second workspace must make the aggregate repair fail, without undoing
# an independently successful workspace. The mocked ACL checks above prove rollback.
$workspace = Join-Path $fixture 'workspace'
Write-Fixture (Join-Path $env:DSH_HOME 'storages\workspace.json') (@{ tables = @{ workspaces = @{ one = @{ path = $workspace } } }; global = @{ workspaceIds = @('one') } } | ConvertTo-Json -Depth 5)
New-Item -ItemType Directory -Path $workspace -Force | Out-Null
$savedWorkspaceFix = ${function:Repair-DoctorIntegrityLabel}
${function:Repair-DoctorIntegrityLabel} = { param([string]$Path) throw 'simulated partial failure' }
Assert-Throws { Repair-DoctorWorkspaceLabel } 'failed for 1 path'
${function:Repair-DoctorIntegrityLabel} = $savedWorkspaceFix
Write-Host 'PASS workspace aggregate failure'
$savedEntries = ${function:Get-DshWorkspaceEntries}
${function:Repair-DoctorIntegrityLabel} = $savedWorkspaceFix
${function:Get-DshWorkspaceEntries} = { return @('Z:\path-that-cannot-be-created-by-this-test') }
Assert-Throws { Repair-DoctorMissingWorkspaces } 'Could not create 1'
${function:Get-DshWorkspaceEntries} = $savedEntries
Write-Host 'PASS partial workspace creation failure is fatal'

# Restore actual helpers before report tests.
. (Join-Path $root 'src\lib\common.ps1')
. (Join-Path $root 'src\lib\checks.ps1')
$env:USERNAME = 'fixture-user'
$env:COMPUTERNAME = 'fixture-host'
$userPath = 'C:\Users\fixture-user\project\file.txt'
$envMap = [ordered]@{ DshHome = $userPath; Note = 'host fixture-host and /home/fixture-user/file' }
$reportFinding = New-Finding -Id 'privacy' -Severity 'Low' -Title 'host fixture-host' -Path $userPath -Detail 'User fixture-user at fixture-host' -Evidence @($userPath, '/Users/fixture-user/file')
$json = ConvertTo-DoctorScanJson -Findings @($reportFinding) -Environment $envMap
Assert-True ($json -notmatch 'fixture-user|fixture-host') 'JSON report leaked user or hostname'
$null = $json | ConvertFrom-Json
$out = Join-Path $fixture 'report'
$bundle = New-DoctorReportBundle -OutDir $out -Findings @($reportFinding) -Environment $envMap
$markdown = [IO.File]::ReadAllText($bundle.Markdown, [Text.Encoding]::UTF8)
$jsonFile = [IO.File]::ReadAllText($bundle.Json, [Text.Encoding]::UTF8)
Assert-True ($markdown -notmatch 'fixture-user|fixture-host') 'Markdown report leaked user or hostname'
Assert-True ($markdown -match '<machine>' -and $markdown -match 'C:\\Users\\user') 'Markdown sanitization placeholders missing'
Assert-True ($jsonFile -notmatch 'fixture-user|fixture-host') 'JSON report file leaked user or hostname'
Write-Host 'PASS JSON and report-bundle privacy'

# Restore the workspace fix's real implementation for any caller of this test.
. (Join-Path $root 'src\lib\fixes.ps1')
$global:LASTEXITCODE = 0
Write-Host 'powershell-regression OK'
