#Requires -Version 5.1
# Real PowerShell / concatenated-EXE-script integration, isolated in .dsh-test-tmp.
param([string]$FixtureRoot = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($FixtureRoot)) {
    $FixtureRoot = Join-Path $root ('.dsh-test-tmp\rescue-' + [guid]::NewGuid().ToString('N'))
}
$fixture = [IO.Path]::GetFullPath($FixtureRoot)
$allowed = [IO.Path]::GetFullPath((Join-Path $root '.dsh-test-tmp')).TrimEnd('\') + '\'
if (-not $fixture.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'FixtureRoot must be under .dsh-test-tmp' }
New-Item -ItemType Directory -Path $fixture -Force | Out-Null
$env:DSH_HOME = Join-Path $fixture 'home'
foreach ($name in @('DSH_DOCTOR_SYS', 'DSH_DOCTOR_EXE_ARGS', 'DSH_DOCTOR_EXE_ID')) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}
New-Item -ItemType Directory -Path $env:DSH_HOME -Force | Out-Null
$utf8Bom = New-Object Text.UTF8Encoding($true)
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
foreach ($name in @('DSH_DOCTOR_EXE_ARGS', 'DSH_DOCTOR_EXE_ID')) {
    Assert-True ($null -eq [Environment]::GetEnvironmentVariable($name, 'Process')) ('Could not clear ' + $name)
}
function Invoke-Native([string]$FilePath, [string[]]$Arguments) {
    $output = (& $FilePath @Arguments 2>&1 | Out-String)
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output }
}
$expected = @('desktop-label', 'workspace-label', 'workspace-entry', 'create-workspace-dir', 'profile-host-dup', 'restore-patch-layer', 'clear-cookies')
foreach ($command in @('list', 'help')) {
    $result = Invoke-Native 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'src\dsh-doctor.ps1'), $command)
    Assert-True ($result.ExitCode -eq 0) ($command + ' failed: ' + $result.Output)
    foreach ($id in $expected) { Assert-True ($result.Output.Contains($id)) ($command + ' omitted fix ID ' + $id) }
}
Write-Host 'PASS CLI list/help complete fix catalog'

# A finding is a health result, not a CLI execution failure.
$profileDir = Join-Path $env:DSH_HOME 'profiles\alpha'
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $profileDir 'cordis.patch.yml.bak-1'), 'name: test', $utf8Bom)
[IO.File]::WriteAllBytes((Join-Path $profileDir 'cordis.patch.yml'), [byte[]]@())
$scan = Invoke-Native 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'src\dsh-doctor.ps1'), 'scan', '-Json')
Assert-True ($scan.ExitCode -eq 0) ('scan with a finding returned nonzero: ' + $scan.Output)
Assert-True ($scan.Output.Contains('patch-layer-missing')) 'CLI scan did not find patch-layer-missing'
Write-Host 'PASS scan finding still exits zero'

$bad = Invoke-Native 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'src\dsh-doctor.ps1'), 'fix', '-Id', 'not-a-fix', '-Yes')
Assert-True ($bad.ExitCode -ne 0) 'Unknown fix returned zero'
Write-Host 'PASS CLI fix failure returns nonzero'

# Missing workspace fixtures stay under .dsh-test-tmp; one invalid drive forces
# a real partial failure in the direct CLI without touching the actual DSH_HOME.
$storage = Join-Path $env:DSH_HOME 'storages'
New-Item -ItemType Directory -Path $storage -Force | Out-Null
$missing = Join-Path $fixture 'created-workspace'
$registry = @{ tables = @{ workspaces = @{ one = @{ path = $missing }; two = @{ path = 'Z:\dsh-doctor-test-cannot-create' } } } } | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $storage 'workspace.json'), $registry, $utf8Bom)
$partial = Invoke-Native 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'src\dsh-doctor.ps1'), 'fix', '-Id', 'create-workspace-dir', '-Yes')
Assert-True ($partial.ExitCode -ne 0) 'Partial CLI fix failure returned zero'
Assert-True (Test-Path -LiteralPath $missing -PathType Container) 'Isolated valid workspace fixture was not created'
Write-Host 'PASS partial CLI fix failure returns nonzero'

# Exercise only the rescue function definitions (the final dispatch is removed),
# with a mocked process. This never runs icacls against Desktop or a workspace.
foreach ($lib in @('common.ps1', 'checks.ps1', 'fixes.ps1', 'report.ps1')) {
    . (Join-Path $root ('src\lib\' + $lib))
}
$rescueText = [IO.File]::ReadAllText((Join-Path $root 'tools\rescue-main.ps1'), [Text.Encoding]::UTF8)
$dispatch = $rescueText.LastIndexOf('try {', [StringComparison]::Ordinal)
Assert-True ($dispatch -gt 0) 'Could not locate rescue dispatch for isolated function test'
. ([scriptblock]::Create($rescueText.Substring(0, $dispatch)))
$aclBackup = Join-Path $env:DSH_HOME 'dsh-doctor-backups\fixture\desktop-acl-test.txt'
New-Item -ItemType Directory -Path (Split-Path -Parent $aclBackup) -Force | Out-Null
[IO.File]::WriteAllText($aclBackup, 'fixture backup', $utf8Bom)
$aclTarget = Join-Path $fixture 'acl-target'
New-Item -ItemType Directory -Path $aclTarget -Force | Out-Null
[IO.File]::WriteAllText($aclBackup + '.path.txt', $aclTarget, $utf8Bom)
$item = @(Get-RescueBackups | Where-Object { $_.Path -eq $aclBackup })
Assert-True ($item.Count -eq 1 -and $item[0].TargetPath -eq $aclTarget) 'Rescue backup list lost ACL original target'
${function:Invoke-DoctorProcess} = { param([string]$FilePath, [string[]]$Arguments) [pscustomobject]@{ ExitCode = 0; Output = 'fixture restore' } }
Restore-RescueBackup -Item $item[0]
Write-Host 'PASS rescue backup discovery and target-specific mocked rollback'

# Exercise the exact part order and -EnginePath convention of tools/build.ps1.
# No rebuilding, no modification of build.ps1 and no real engine execution.
$builder = New-Object Text.StringBuilder
foreach ($part in @('src\lib\common.ps1', 'src\lib\checks.ps1', 'src\lib\fixes.ps1', 'src\lib\report.ps1', 'tools\rescue-main.ps1')) {
    [void]$builder.AppendLine([IO.File]::ReadAllText((Join-Path $root $part), [Text.Encoding]::UTF8))
    [void]$builder.AppendLine('')
}
$combined = Join-Path $fixture 'combined-rescue.ps1'
[IO.File]::WriteAllText($combined, $builder.ToString(), $utf8Bom)
$engine = Join-Path $fixture 'fake-engine.exe'
[IO.File]::WriteAllText($engine, 'fixture', $utf8Bom)
$tokens = $null; $errors = $null
$null = [Management.Automation.Language.Parser]::ParseFile($combined, [ref]$tokens, [ref]$errors)
Assert-True ($errors.Count -eq 0) ('Combined script syntax error: ' + ($errors -join '; '))
$env:DSH_DOCTOR_EXE_ARGS = 'scan'
$combinedScan = Invoke-Native 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $combined, '-EnginePath', $engine)
Assert-True ($combinedScan.ExitCode -eq 0) ('Concatenated script rejected -EnginePath or failed: ' + $combinedScan.Output)
Assert-True ($combinedScan.Output.Contains('empty or missing cordis.patch.yml')) 'Concatenated scan missed fixture finding'
$env:DSH_DOCTOR_EXE_ARGS = 'fix'
$env:DSH_DOCTOR_EXE_ID = 'not-a-fix'
$combinedBad = Invoke-Native 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $combined, '-EnginePath', $engine)
[Environment]::SetEnvironmentVariable('DSH_DOCTOR_EXE_ARGS', $null, 'Process')
[Environment]::SetEnvironmentVariable('DSH_DOCTOR_EXE_ID', $null, 'Process')
Assert-True ($combinedBad.ExitCode -ne 0) 'Concatenated fix failure returned zero'
Write-Host 'PASS concatenated EnginePath, scan and failing-fix exit code'

# PS5.1 needs a BOM when a file contains Chinese. Use the real CLI to prove the
# file-encoding invariant, rather than merely parsing strings as UTF-8.
$files = @('src\lib\common.ps1', 'src\lib\checks.ps1', 'src\lib\fixes.ps1', 'src\lib\report.ps1', 'src\dsh-doctor.ps1', 'tools\rescue-main.ps1', 'tools\build-exe.ps1', 'tests\powershell-regression.ps1', 'tests\rescue-integration.ps1')
foreach ($file in $files) {
    $path = Join-Path $root $file
    $bytes = [IO.File]::ReadAllBytes($path)
    $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191
    Assert-True $bom ($file + ' has no UTF8 BOM; PS5.1 would misread Chinese')
    # 文件中间再出现 EF BB BF（常见于"补 BOM"补错位置）会被 PS5.1 当命令字符，必须拦下。
    $stray = -1
    for ($i = 3; $i -le $bytes.Length - 3; $i++) {
        if ($bytes[$i] -eq 239 -and $bytes[$i + 1] -eq 187 -and $bytes[$i + 2] -eq 191) { $stray = $i; break }
    }
    Assert-True ($stray -lt 0) ($file + ' has a stray UTF8 BOM at byte ' + $stray + '; PS5.1 would treat it as a command')
    $tokens = $null; $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    Assert-True ($errors.Count -eq 0) ($file + ' has syntax errors: ' + ($errors -join '; '))
}
Write-Host 'PASS UTF8 BOM and PS5.1 parser checks'
Write-Host 'rescue-integration OK'
