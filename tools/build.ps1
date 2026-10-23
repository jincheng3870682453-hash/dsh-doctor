# 构建全部发行产物：Windows 急救 EXE + 跨平台 Node CLI + Linux/macOS 外壳。
# 输出到 dist/release/。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root 'dist\release'
New-Item -ItemType Directory -Path $release -Force | Out-Null
$utf8NoBom = New-Object Text.UTF8Encoding($false)

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
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($builder.ToString()))

$launcher = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class DshDoctorLauncher
{
    const string ScriptBase64 = "__SCRIPT_B64__";

    static int Main(string[] args)
    {
        try
        {
            string script = Encoding.UTF8.GetString(Convert.FromBase64String(ScriptBase64));
            string[] candidates = new string[]
            {
                Path.GetTempPath(),
                AppDomain.CurrentDomain.BaseDirectory,
                Directory.GetCurrentDirectory()
            };
            string temp = null;
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
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + temp + "\"",
                UseShellExecute = false
            };
            if (args.Length > 0) info.EnvironmentVariables["DSH_DOCTOR_EXE_ARGS"] = args[0];
            var process = Process.Start(info);
            process.WaitForExit();
            try { File.Delete(temp); } catch (Exception) { }
            return process.ExitCode;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("dsh-doctor launcher failed: " + error.GetType().Name + " - " + error.Message);
            return 2;
        }
    }
}
'@
$source = $launcher.Replace('__SCRIPT_B64__', $encoded)
$csFile = Join-Path $release 'dsh-doctor-launcher.cs'
$exeFile = Join-Path $release 'dsh-doctor.exe'
Set-Content -LiteralPath $csFile -Value $source -Encoding UTF8
& $csc /nologo /target:exe /optimize+ "/out:$exeFile" $csFile
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }
Remove-Item -LiteralPath $csFile -Force
Write-Host ('built ' + $exeFile + ' (' + [math]::Round((Get-Item $exeFile).Length / 1KB, 1) + ' KB)')

# ── 2) 跨平台 Node CLI（Linux / macOS / 任何有 Node 的地方）────────────────────
$cliSource = [IO.File]::ReadAllText((Join-Path $root 'tools\cli.mjs'), [Text.Encoding]::UTF8)
$cliRelease = $cliSource.Replace("'../plugin/lib/index.js'", "'./plugin/lib/index.js'")
[IO.File]::WriteAllText((Join-Path $release 'dsh-doctor.mjs'), $cliRelease, $utf8NoBom)
$pluginDir = Join-Path $release 'plugin\lib'
New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $pluginDir 'index.js'),
    [IO.File]::ReadAllText((Join-Path $root 'plugin\lib\index.js'), [Text.Encoding]::UTF8), $utf8NoBom)
Write-Host 'built dsh-doctor.mjs + plugin/lib/index.js'

# ── 3) Linux / macOS 外壳（LF 换行）──────────────────────────────────────────
$posix = @'
#!/bin/sh
# dsh-doctor · 点一下修复。
DIR=$(cd "$(dirname "$0")" && pwd)
if command -v node >/dev/null 2>&1; then
  NODE=node
elif [ -x "$DIR/node" ]; then
  NODE="$DIR/node"
else
  printf '\n需要 Node.js（>=18）。如果 DSH 里能跑终端，也可以直接用它的 node：\n  node %s\n\n' "$DIR/dsh-doctor.mjs"
  exit 1
fi
exec "$NODE" "$DIR/dsh-doctor.mjs" "$@"
'@
$mac = @'
#!/bin/bash
# dsh-doctor · 点一下修复。（macOS 双击运行）
DIR="$(cd "$(dirname "$0")" && pwd)"
if command -v node >/dev/null 2>&1; then
  NODE=node
elif [ -x "$DIR/node" ]; then
  NODE="$DIR/node"
else
  echo
  echo "需要 Node.js（>=18）。装好后再双击我，或手动执行："
  echo "  node \"$DIR/dsh-doctor.mjs\""
  echo
  read -n 1 -s -r -p '按任意键关闭…'
  exit 1
fi
"$NODE" "$DIR/dsh-doctor.mjs" "$@"
echo
read -n 1 -s -r -p '按任意键关闭…'
'@
[IO.File]::WriteAllText((Join-Path $release 'dsh-doctor.sh'), ($posix -replace "`r`n", "`n"), $utf8NoBom)
[IO.File]::WriteAllText((Join-Path $release 'dsh-doctor.command'), ($mac -replace "`r`n", "`n"), $utf8NoBom)
Write-Host 'built dsh-doctor.sh + dsh-doctor.command'

Write-Host ''
Write-Host 'dist/release/'
Get-ChildItem -Recurse -File $release | ForEach-Object {
    $relative = $_.FullName.Substring($release.Length + 1)
    Write-Host ('  ' + $relative.PadRight(34) + [math]::Round($_.Length / 1KB, 1) + ' KB')
}
