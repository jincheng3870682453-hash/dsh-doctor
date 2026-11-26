# 兼容入口：只调用主构建器，不再维护第二份 C# 启动器。
# 产物统一在 dist/release/；需要 Node 20 来组装环境包并完成验收。
param(
    [switch]$SkipDoctorSys,
    [string]$NodeExe = '',
    [string]$NodeZip = ''
)
$ErrorActionPreference = 'Stop'
$builder = Join-Path $PSScriptRoot 'build.ps1'
& $builder -SkipDoctorSys:$SkipDoctorSys -NodeExe $NodeExe -NodeZip $NodeZip
exit $LASTEXITCODE
