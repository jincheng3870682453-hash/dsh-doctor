# 构建自包含急救 EXE：把 PowerShell 逻辑内嵌进 .NET 启动器，输出 dist\dsh-doctor.exe。
# 不需要 Node、不需要 DSH、不需要联网；只需要 Windows 自带的 .NET Framework 编译器。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
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
$script = $builder.ToString()
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))

$launcher = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class DshDoctorLauncher
{
    const string ScriptBase64 = "__SCRIPT_B64__";

    static void Trace(string line)
    {
        try
        {
            string log = Path.Combine(Path.GetTempPath(), "dsh-doctor-launcher.log");
            File.AppendAllText(log, DateTime.Now.ToString("s") + " " + line + Environment.NewLine);
        }
        catch (Exception) { }
    }

    static int Main(string[] args)
    {
        try
        {
            Trace("start args=" + string.Join(",", args));
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
                Console.Error.WriteLine("launcher failed: no writable directory for the embedded script");
                return 3;
            }
            Trace("script written " + temp + " bytes=" + script.Length);

            var info = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + temp + "\"",
                UseShellExecute = false
            };
            if (args.Length > 0)
            {
                info.EnvironmentVariables["DSH_DOCTOR_EXE_ARGS"] = args[0];
            }

            var process = Process.Start(info);
            Trace("child pid=" + process.Id);
            process.WaitForExit();
            Trace("child exit=" + process.ExitCode);
            try { File.Delete(temp); } catch (Exception) { }
            return process.ExitCode;
        }
        catch (Exception error)
        {
            Trace("FAILED type=" + error.GetType().FullName + " msg=" + error.Message);
            Trace("stack=" + error.StackTrace);
            Console.Error.WriteLine("launcher failed: " + error.GetType().FullName + " - " + error.Message);
            return 2;
        }
    }
}
'@

$source = $launcher.Replace('__SCRIPT_B64__', $encoded)
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$csFile = Join-Path $dist 'dsh-doctor-launcher.cs'
$exeFile = Join-Path $dist 'dsh-doctor.exe'
Set-Content -LiteralPath $csFile -Value $source -Encoding UTF8

& $csc /nologo /target:exe /optimize+ "/out:$exeFile" $csFile
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $exeFile)) { throw 'EXE was not produced.' }

Remove-Item -LiteralPath $csFile -Force
$info = Get-Item -LiteralPath $exeFile
Write-Host ("built " + $info.FullName + " (" + [math]::Round($info.Length / 1KB, 1) + " KB, embedded script " + [math]::Round($script.Length / 1KB, 1) + " KB)")
