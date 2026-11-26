# 构建发行产物：Windows 急救 EXE、Unix 包、插件 zip 和 Windows 环境包。
# 输出到 dist/release/。GitHub Release 仍只上传 EXE / Unix 包 / 环境包三个用户资产。
# SkipDoctorSys 复用 doctorsys job 的引擎；OnlyWindows/OnlyEnvPack 用于 CI 分工。
# NodeExe/NodeZip 指定环境包使用的便携 Node 20；正常构建必须验收。
param(
    [switch]$SkipDoctorSys,
    [switch]$OnlyEnvPack,
    [switch]$OnlyWindows,
    [string]$NodeExe = '',
    [string]$NodeZip = '',
    [switch]$SkipVerify
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root 'dist\release'
New-Item -ItemType Directory -Path $release -Force | Out-Null
$utf8NoBom = New-Object Text.UTF8Encoding($false)
$pluginVersion = (Get-Content -LiteralPath (Join-Path $root 'plugin\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ([string]::IsNullOrWhiteSpace([string]$pluginVersion)) { throw 'plugin/package.json has no version' }

function Assert-WindowsX64Node([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "node.exe not found: $Path" }
    $bytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Path).Path)
    if ($bytes.Length -lt 64 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) { throw "Node is not a Windows executable: $Path" }
    $pe = [BitConverter]::ToInt32($bytes, 0x3C)
    if ($pe -lt 0 -or $pe + 6 -gt $bytes.Length -or [BitConverter]::ToUInt32($bytes, $pe) -ne 0x00004550) {
        throw "Invalid PE header in Node executable: $Path"
    }
    if ([BitConverter]::ToUInt16($bytes, $pe + 4) -ne 0x8664) { throw "Environment pack requires Windows x64 Node: $Path" }
    $nodeVersion = (& $Path --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v20\.') { throw "Environment pack requires Node 20, got: $nodeVersion" }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Build-EnvironmentPack {
    $nodeSource = $NodeExe
    $nodeStage = ''
    try {
        if (-not [string]::IsNullOrWhiteSpace($NodeZip)) {
            if (-not (Test-Path -LiteralPath $NodeZip -PathType Leaf)) { throw "Node zip not found: $NodeZip" }
            $nodeStage = Join-Path $release ('.node-' + [guid]::NewGuid().ToString('N'))
            Expand-Archive -LiteralPath $NodeZip -DestinationPath $nodeStage -Force
            $found = @(Get-ChildItem -LiteralPath $nodeStage -Recurse -Filter node.exe -File)
            if ($found.Count -ne 1) { throw "Node zip must contain exactly one node.exe, found $($found.Count)" }
            $nodeSource = $found[0].FullName
        }
        if ([string]::IsNullOrWhiteSpace($nodeSource)) {
            $command = Get-Command node.exe -ErrorAction SilentlyContinue
            if ($null -eq $command) { throw 'Windows x64 Node 20 is required for the environment pack (-NodeExe or -NodeZip)' }
            $nodeSource = $command.Source
        }
        $nodeSource = Assert-WindowsX64Node $nodeSource
        $pack = Join-Path $release '.envpack'
        if (Test-Path -LiteralPath $pack) { Remove-Item -LiteralPath $pack -Recurse -Force }
        New-Item -ItemType Directory -Force -Path (Join-Path $pack 'plugin\lib'), (Join-Path $pack 'plugin\bin') | Out-Null
        Copy-Item -LiteralPath $nodeSource (Join-Path $pack 'node.exe') -Force
        $cli = [IO.File]::ReadAllText((Join-Path $root 'tools\cli.mjs'), [Text.Encoding]::UTF8)
        $cli = $cli.Replace("'../plugin/lib/index.js'", "'./plugin/lib/index.mjs'")
        [IO.File]::WriteAllText((Join-Path $pack 'dsh-doctor.mjs'), $cli, $utf8NoBom)
        Copy-Item -LiteralPath (Join-Path $root 'plugin\lib\index.js') (Join-Path $pack 'plugin\lib\index.mjs') -Force
        # worker 全部随包：漏一个就是"检查包在发行版里静默失效"。
        Get-ChildItem -LiteralPath (Join-Path $root 'plugin\lib') -Filter '*.mjs' -File | Copy-Item -Destination (Join-Path $pack 'plugin\lib') -Force
        Copy-Item -LiteralPath (Join-Path $root 'plugin\package.json') (Join-Path $pack 'plugin\package.json') -Force
        Copy-Item -LiteralPath (Join-Path $root 'plugin\bin\doctor-sys.exe') (Join-Path $pack 'plugin\bin\doctor-sys.exe') -Force
        # .cmd 不能带 BOM（cmd.exe 会把 BOM 当命令的一部分）。
        $launcher = "@echo off`r`nchcp 65001 >nul`r`nsetlocal`r`ncd /d `"%~dp0`"`r`n`"%~dp0node.exe`" `"%~dp0dsh-doctor.mjs`" %*`r`necho.`r`npause`r`n"
        [IO.File]::WriteAllText((Join-Path $pack 'start.cmd'), $launcher, $utf8NoBom)
        $readme = "DSH 私人医生 · Windows 环境包`r`n================================`r`n`r`n这个包自带 node.exe，不需要另外安装 Node，也不需要 DSH 能启动。`r`n`r`n用法：`r`n  1. 解压到任意目录（不要放在桌面，避免图标被刷新）；`r`n  2. 双击 start.cmd；`r`n  3. 选 1 一键修复，或按菜单提示操作；也可以直接运行 node.exe dsh-doctor.mjs fix-all`r`n`r`n命令行：`r`n  node.exe dsh-doctor.mjs scan`r`n  node.exe dsh-doctor.mjs fix workspace-entry`r`n  node.exe dsh-doctor.mjs report`r`n`r`n全部在本机运行，不上传任何数据。`r`n"
        [IO.File]::WriteAllText((Join-Path $pack 'README.txt'), $readme, $utf8NoBom)
        $zip = Join-Path $release 'dsh-doctor-env-win-x64.zip'
        Compress-Archive -Path (Join-Path $pack '*') -DestinationPath $zip -Force
        Remove-Item -LiteralPath $pack -Recurse -Force
        Write-Host "built $zip"
    } finally {
        if (-not [string]::IsNullOrWhiteSpace($nodeStage) -and (Test-Path -LiteralPath $nodeStage)) {
            Remove-Item -LiteralPath $nodeStage -Recurse -Force
        }
    }
}

if ($OnlyEnvPack) {
    if (-not (Test-Path -LiteralPath (Join-Path $root 'plugin\bin\doctor-sys.exe') -PathType Leaf)) { throw 'Build or stage plugin/bin/doctor-sys.exe before building the environment pack' }
    Build-EnvironmentPack
    if (-not $SkipVerify) { & node (Join-Path $PSScriptRoot 'verify-release.mjs') --root $root --asset env --expected-version $pluginVersion --engine-source (Join-Path $root 'plugin\bin\doctor-sys.exe'); if ($LASTEXITCODE -ne 0) { throw 'environment pack verification failed' } }
    return
}

# ── 0) Rust 原语引擎：唯一来源是 doctor-sys/target/release/doctor-sys.exe ──
$engineSource = Join-Path $root 'doctor-sys\target\release\doctor-sys.exe'
if ($SkipDoctorSys) {
    if (-not (Test-Path -LiteralPath $engineSource -PathType Leaf)) { throw '-SkipDoctorSys requires an existing doctor-sys/target/release/doctor-sys.exe' }
    if ((Get-Item -LiteralPath $engineSource).Length -eq 0) { throw 'doctor-sys.exe is empty' }
    Write-Host 'using prebuilt doctor-sys.exe (-SkipDoctorSys)'
} else {
    $cargo = Get-Command cargo -ErrorAction SilentlyContinue
    if ($null -eq $cargo) { throw 'cargo not found; install Rust or use CI doctorsys artifact with -SkipDoctorSys' }
    & cargo build --release --manifest-path (Join-Path $root 'doctor-sys\Cargo.toml')
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed with exit code $LASTEXITCODE" }
}
Copy-Item -LiteralPath $engineSource (Join-Path $release 'doctor-sys.exe') -Force
Copy-Item -LiteralPath $engineSource (Join-Path $release 'dsh-doctor-native.exe') -Force
$pluginBin = Join-Path $root 'plugin\bin'
New-Item -ItemType Directory -Path $pluginBin -Force | Out-Null
Copy-Item -LiteralPath $engineSource (Join-Path $pluginBin 'doctor-sys.exe') -Force
Write-Host 'staged doctor-sys.exe, native CLI and plugin/bin/doctor-sys.exe'

# ── 1) Windows：自包含急救 EXE（C# 启动器内嵌 PowerShell 逻辑与同一引擎）──
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found: $csc" }
$parts = @('src\lib\common.ps1', 'src\lib\checks.ps1', 'src\lib\fixes.ps1', 'src\lib\report.ps1', 'tools\rescue-main.ps1')
$builder = New-Object System.Text.StringBuilder
foreach ($part in $parts) {
    $full = Join-Path $root $part
    if (-not (Test-Path -LiteralPath $full)) { throw "Missing script part: $full" }
    [void]$builder.AppendLine((Get-Content -LiteralPath $full -Raw -Encoding UTF8))
    [void]$builder.AppendLine('')
}
$scriptText = $builder.ToString().Replace("`$script:DshDoctorVersion = '0.1.0'", "`$script:DshDoctorVersion = '$pluginVersion'")
$versionDispatch = "if (`$env:DSH_DOCTOR_EXE_ARGS -eq 'version') {`r`n    Get-DoctorVersion`r`n} elseif (`$env:DSH_DOCTOR_EXE_ARGS -eq 'scan') {"
if (-not $scriptText.Contains("if (`$env:DSH_DOCTOR_EXE_ARGS -eq 'scan') {")) { throw 'rescue entry point has no scan dispatch' }
$scriptText = $scriptText.Replace("if (`$env:DSH_DOCTOR_EXE_ARGS -eq 'scan') {", $versionDispatch)
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($scriptText))

$launcher = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class DshDoctorLauncher
{
    const string ScriptBase64 = "__SCRIPT_B64__";
    const string SysBase64 = "__SYS_B64__";

    static int Main(string[] args)
    {
        string temp = null;
        string sysTemp = null;
        try
        {
            string script = Encoding.UTF8.GetString(Convert.FromBase64String(ScriptBase64));
            string[] candidates = new string[]
            {
                Path.GetTempPath(),
                AppDomain.CurrentDomain.BaseDirectory,
                Directory.GetCurrentDirectory()
            };
            foreach (string directory in candidates)
            {
                try
                {
                    if (string.IsNullOrEmpty(directory)) continue;
                    string probe = Path.Combine(directory, "dsh-doctor-" + Guid.NewGuid().ToString("N") + ".ps1");
                    File.WriteAllText(probe, script, new UTF8Encoding(true));
                    temp = probe;
                    break;
                }
                catch (Exception) { }
            }
            if (temp == null)
            {
                Console.Error.WriteLine("dsh-doctor: no writable directory for the embedded script");
                return 3;
            }
            var info = new ProcessStartInfo { FileName = "powershell.exe", UseShellExecute = false };
            if (!string.IsNullOrEmpty(SysBase64))
            {
                try
                {
                    sysTemp = Path.Combine(Path.GetTempPath(), "dsh-doctor-sys-" + Guid.NewGuid().ToString("N") + ".exe");
                    File.WriteAllBytes(sysTemp, Convert.FromBase64String(SysBase64));
                }
                catch (Exception) { sysTemp = null; }
            }
            info.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + temp + "\""
                + (sysTemp != null ? " -EnginePath \"" + sysTemp + "\"" : "");
            if (args.Length > 0) {
                info.EnvironmentVariables["DSH_DOCTOR_EXE_ARGS"] = args[0];
                if (args.Length >= 3 && args[0] == "fix" && args[1] == "-Id") {
                    info.EnvironmentVariables["DSH_DOCTOR_EXE_ID"] = args[2];
                }
            }
            var process = Process.Start(info);
            process.WaitForExit();
            return process.ExitCode;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("dsh-doctor launcher failed: " + error.GetType().Name + " - " + error.Message);
            return 2;
        }
        finally
        {
            try { if (temp != null) File.Delete(temp); } catch (Exception) { }
            try { if (sysTemp != null) File.Delete(sysTemp); } catch (Exception) { }
        }
    }
}
'@
$sysB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($engineSource))
$source = $launcher.Replace('__SCRIPT_B64__', $encoded).Replace('__SYS_B64__', $sysB64)
$csFile = Join-Path $release 'dsh-doctor-launcher.cs'
$exeFile = Join-Path $release 'dsh-doctor.exe'
Set-Content -LiteralPath $csFile -Value $source -Encoding UTF8
& $csc /nologo /target:exe /optimize+ "/out:$exeFile" $csFile
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }
Remove-Item -LiteralPath $csFile -Force
Write-Host "built $exeFile"

if ($OnlyWindows) {
    if (-not $SkipVerify) { & node (Join-Path $PSScriptRoot 'verify-release.mjs') --root $root --asset exe --expected-version $pluginVersion --engine-source $engineSource; if ($LASTEXITCODE -ne 0) { throw 'Windows EXE verification failed' } }
    Write-Host 'Windows EXE and native engine built and verified'
    return
}

# ── 2) Unix 发行布局（与 tools/package-unix.sh 一致）──
$cliSource = [IO.File]::ReadAllText((Join-Path $root 'tools\cli.mjs'), [Text.Encoding]::UTF8)
$cliRelease = $cliSource.Replace("'../plugin/lib/index.js'", "'./plugin/lib/index.mjs'")
[IO.File]::WriteAllText((Join-Path $release 'dsh-doctor.mjs'), $cliRelease, $utf8NoBom)
$pluginDir = Join-Path $release 'plugin\lib'
New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $pluginDir 'index.mjs'), [IO.File]::ReadAllText((Join-Path $root 'plugin\lib\index.js'), [Text.Encoding]::UTF8), $utf8NoBom)
Get-ChildItem -LiteralPath (Join-Path $root 'plugin\lib') -Filter '*.mjs' -File | Copy-Item -Destination $pluginDir -Force
Copy-Item -LiteralPath (Join-Path $root 'plugin\package.json') (Join-Path $release 'plugin\package.json') -Force
foreach ($launcherFile in @('dsh-doctor.sh', 'dsh-doctor.command')) {
    $text = [IO.File]::ReadAllText((Join-Path $root ('tools\launcher\' + $launcherFile)), [Text.Encoding]::UTF8) -replace "`r`n", "`n"
    [IO.File]::WriteAllText((Join-Path $release $launcherFile), $text, $utf8NoBom)
}

# ── 3) Unix tar（内容与 tools/package-unix.sh 相同）──
$stage = Join-Path $release ('.unix-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $stage 'plugin\lib') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $release 'dsh-doctor.mjs') $stage -Force
Copy-Item -LiteralPath (Join-Path $release 'dsh-doctor.sh') $stage -Force
Copy-Item -LiteralPath (Join-Path $release 'dsh-doctor.command') $stage -Force
Copy-Item -LiteralPath (Join-Path $pluginDir 'index.mjs') (Join-Path $stage 'plugin\lib\index.mjs') -Force
Get-ChildItem -LiteralPath (Join-Path $root 'plugin\lib') -Filter '*.mjs' -File | Copy-Item -Destination (Join-Path $stage 'plugin\lib') -Force
Copy-Item -LiteralPath (Join-Path $release 'plugin\package.json') (Join-Path $stage 'plugin\package.json') -Force
$tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $tarExe)) { $tarExe = 'tar' }
& $tarExe -czf (Join-Path $release 'dsh-doctor-unix.tar.gz') -C $stage '.'
if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
Remove-Item -LiteralPath $stage -Recurse -Force
Write-Host 'built dsh-doctor-unix.tar.gz'

# ── 4) 插件包：包含真实 doctor-sys，不使用仓库外的引擎替代 ──
$pluginZip = Join-Path $release 'dsh-doctor-plugin.zip'
$pluginStage = Join-Path $release ('.plugin-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $pluginStage -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $root 'plugin') -Force | Where-Object { $_.Name -ne 'node_modules' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $pluginStage -Recurse -Force
}
Compress-Archive -Path (Join-Path $pluginStage '*') -DestinationPath $pluginZip -Force
Remove-Item -LiteralPath $pluginStage -Recurse -Force
Write-Host 'built dsh-doctor-plugin.zip'

Build-EnvironmentPack

if (-not $SkipVerify) {
    & node (Join-Path $PSScriptRoot 'verify-release.mjs') --root $root --asset all --expected-version $pluginVersion --engine-source $engineSource
    if ($LASTEXITCODE -ne 0) { throw 'release verification failed' }
}

Write-Host ''
Write-Host 'dist/release/'
Get-ChildItem -File $release | ForEach-Object {
    Write-Host ('  ' + $_.Name.PadRight(34) + [math]::Round($_.Length / 1KB, 1) + ' KB')
}
