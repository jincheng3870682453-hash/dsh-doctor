# 构建全部发行产物：Windows 急救 EXE + 跨平台 Node CLI + Linux/macOS 外壳 + Rust 原语引擎。
# 输出到 dist/release/。
param(
    # CI 的 doctorsys job 已单独构建 Rust 引擎时使用，避免重复构建/产物不一致。
    [switch]$SkipDoctorSys
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root 'dist\release'
New-Item -ItemType Directory -Path $release -Force | Out-Null
$utf8NoBom = New-Object Text.UTF8Encoding($false)

# ── 0) Rust 原语引擎 doctor-sys.exe（设计文档 §9；CI 的 doctorsys job 单独构建）──
#    构建时传 -SkipDoctorSys 可跳过（CI 的 windows job 就是这么用的）。
$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if ($SkipDoctorSys) {
    Write-Host 'skip doctor-sys.exe (-SkipDoctorSys)'
} elseif ($cargo) {
    & cargo build --release --manifest-path (Join-Path $root 'doctor-sys\Cargo.toml')
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed with exit code $LASTEXITCODE" }
    Copy-Item (Join-Path $root 'doctor-sys\target\release\doctor-sys.exe') (Join-Path $release 'doctor-sys.exe') -Force
    Write-Host ('built ' + (Join-Path $release 'doctor-sys.exe') + ' (' + [math]::Round((Get-Item (Join-Path $release 'doctor-sys.exe')).Length / 1KB, 1) + ' KB)')
    # 纯 Rust 原生 CLI（scan/fix）：同一份二进制，换个名字给"不想要 PowerShell"的用户。
    Copy-Item (Join-Path $root 'doctor-sys\target\release\doctor-sys.exe') (Join-Path $release 'dsh-doctor-native.exe') -Force
    Write-Host ('built ' + (Join-Path $release 'dsh-doctor-native.exe') + ' (' + [math]::Round((Get-Item (Join-Path $release 'dsh-doctor-native.exe')).Length / 1KB, 1) + ' KB)')
    # 插件侧也要能读 SACL（Low 完整性标签）：PowerShell 的 Get-Acl 读不到，必须用引擎。
    $pluginBin = Join-Path $root 'plugin\bin'
    New-Item -ItemType Directory -Path $pluginBin -Force | Out-Null
    Copy-Item (Join-Path $root 'doctor-sys\target\release\doctor-sys.exe') (Join-Path $pluginBin 'doctor-sys.exe') -Force
    Write-Host ('staged plugin engine: ' + (Join-Path $pluginBin 'doctor-sys.exe'))
} else {
    Write-Host 'cargo not found - skip doctor-sys.exe (CI builds it separately)'
}

# ── 1) Windows：自包含急救 EXE（C# 启动器内嵌 PowerShell 逻辑）────────────────
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found: $csc" }
$parts = @(
    'src\lib\common.ps1',
    'src\lib\checks.ps1',
    'src\lib\fixes.ps1',
    'src\lib\report.ps1',
    'tools\rescue-main.ps1'
)
$builder = New-Object System.Text.StringBuilder
foreach ($part in $parts) {
    $full = Join-Path $root $part
    if (-not (Test-Path -LiteralPath $full)) { throw "Missing script part: $full" }
    [void]$builder.AppendLine((Get-Content -LiteralPath $full -Raw -Encoding UTF8))
    [void]$builder.AppendLine('')
}
# 把 PowerShell 侧的版本常量替换成真实版本（源码里是 0.1.0 占位）。
$pluginVersion = (Get-Content -LiteralPath (Join-Path $root 'plugin\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$scriptText = $builder.ToString().Replace("`$script:DshDoctorVersion = '0.1.0'", "`$script:DshDoctorVersion = '$pluginVersion'")
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
            var info = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                UseShellExecute = false
            };
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
            if (args.Length > 0) info.EnvironmentVariables["DSH_DOCTOR_EXE_ARGS"] = args[0];
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
$engineSource = Join-Path $root 'doctor-sys\target\release\doctor-sys.exe'
$sysB64 = ''
if (Test-Path -LiteralPath $engineSource) { $sysB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($engineSource)) }
$source = $launcher.Replace('__SCRIPT_B64__', $encoded).Replace('__SYS_B64__', $sysB64)
$csFile = Join-Path $release 'dsh-doctor-launcher.cs'
$exeFile = Join-Path $release 'dsh-doctor.exe'
Set-Content -LiteralPath $csFile -Value $source -Encoding UTF8
& $csc /nologo /target:exe /optimize+ "/out:$exeFile" $csFile
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }
Remove-Item -LiteralPath $csFile -Force
Write-Host ('built ' + $exeFile + ' (' + [math]::Round((Get-Item $exeFile).Length / 1KB, 1) + ' KB)')

# ── 2) 跨平台 Node CLI（Linux / macOS / 任何有 Node 的地方）────────────────────
$cliSource = [IO.File]::ReadAllText((Join-Path $root 'tools\cli.mjs'), [Text.Encoding]::UTF8)
$cliRelease = $cliSource.Replace("'../plugin/lib/index.js'", "'./plugin/lib/index.mjs'")
[IO.File]::WriteAllText((Join-Path $release 'dsh-doctor.mjs'), $cliRelease, $utf8NoBom)
$pluginDir = Join-Path $release 'plugin\lib'
New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $pluginDir 'index.mjs'),
    [IO.File]::ReadAllText((Join-Path $root 'plugin\lib\index.js'), [Text.Encoding]::UTF8), $utf8NoBom)
Copy-Item (Join-Path $root 'plugin\package.json') (Join-Path $release 'plugin\package.json') -Force
Write-Host 'built dsh-doctor.mjs + plugin/lib/index.mjs'

# ── 3) Linux / macOS 外壳（LF 换行，源码在 tools/launcher/）──────────────────
foreach ($launcherFile in @('dsh-doctor.sh', 'dsh-doctor.command')) {
    $source = Join-Path $root ('tools\launcher\' + $launcherFile)
    $text = [IO.File]::ReadAllText($source, [Text.Encoding]::UTF8) -replace "`r`n", "`n"
    [IO.File]::WriteAllText((Join-Path $release $launcherFile), $text, $utf8NoBom)
}
Write-Host 'built dsh-doctor.sh + dsh-doctor.command'

# ── 4) 打 Unix 包（与 CI 用同一份布局；CI 里跑 tools/package-unix.sh）──────────
$stage = Join-Path $env:TEMP ('dsh-doctor-unix-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path (Join-Path $stage 'plugin\lib') -Force | Out-Null
Copy-Item (Join-Path $release 'dsh-doctor.mjs') $stage -Force
Copy-Item (Join-Path $release 'dsh-doctor.sh') $stage -Force
Copy-Item (Join-Path $release 'dsh-doctor.command') $stage -Force
Copy-Item (Join-Path $pluginDir 'index.mjs') (Join-Path $stage 'plugin\lib\index.mjs') -Force
Copy-Item (Join-Path $release 'plugin\package.json') (Join-Path $stage 'plugin\package.json') -Force
# Git Bash 的 GNU tar 会把 "D:\..." 当远程主机，优先用 Windows 自带 bsdtar
$tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $tarExe)) { $tarExe = 'tar' }
& $tarExe -czf (Join-Path $release 'dsh-doctor-unix.tar.gz') -C $stage '.'
if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
Remove-Item -LiteralPath $stage -Recurse -Force
Write-Host 'built dsh-doctor-unix.tar.gz'

# ── 5) 插件包：给"不想用 link 安装"的用户，解压后 install_bundle 指向解压目录 ──
$pluginZip = Join-Path $release 'dsh-doctor-plugin.zip'
$pluginStage = Join-Path $env:TEMP ('dsh-doctor-plugin-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $pluginStage -Force | Out-Null
Copy-Item (Join-Path $root 'plugin\*') $pluginStage -Recurse -Force
Compress-Archive -Path (Join-Path $pluginStage '*') -DestinationPath $pluginZip -Force
Remove-Item -LiteralPath $pluginStage -Recurse -Force
Write-Host 'built dsh-doctor-plugin.zip'

Write-Host ''
Write-Host 'dist/release/'
Get-ChildItem -Recurse -File $release | ForEach-Object {
    $relative = $_.FullName.Substring($release.Length + 1)
    Write-Host ('  ' + $relative.PadRight(34) + [math]::Round($_.Length / 1KB, 1) + ' KB')
}
