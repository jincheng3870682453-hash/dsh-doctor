# 去掉文档与 CLI 输出里的所有图标（emoji）。
$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object Text.UTF8Encoding($false)
$emoji = [regex]'[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D]'

$docs = @('README.md', 'CHANGELOG.md', 'docs/catalog.md', 'docs/fixable.md', 'docs/traps.md', 'docs/protocol.md', 'docs/design.md')
foreach ($rel in $docs) {
    $path = Join-Path $root $rel
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $text = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
    if ($rel -eq 'README.md') {
        $text = $text.Replace('✅', '可')
    } elseif ($rel -eq 'docs/fixable.md') {
        $text = $text.Replace('✅', '[可修]').Replace('🔍', '[只查]')
    } elseif ($rel -eq 'docs/catalog.md') {
        $text = $text.Replace('✅', '可')
    }
    $text = $emoji.Replace($text, '')
    $text = [regex]::Replace($text, '(?m)^(#+)\s{2,}', '$1 ')
    $text = [regex]::Replace($text, '[ \t]+(\r?\n)', '$1')
    [IO.File]::WriteAllText($path, $text, $utf8)
    Write-Host ("cleaned " + $rel)
}

$cli = Join-Path $root 'tools/cli.mjs'
$text = [IO.File]::ReadAllText($cli, [Text.Encoding]::UTF8)
$text = $text.Replace("'🔴 高危'", "'[高危]'").Replace("'🟡 提醒'", "'[提醒]'").Replace("'⚪ 信息'", "'[信息]'")
$text = $text.Replace("'✅ 没有发现问题。'", "'没有发现问题。'")
$text = $text.Replace("(entry.ok === true ? '✅' : '❌')", "(entry.ok === true ? '[成功]' : '[失败]')")
$text = $emoji.Replace($text, '')
[IO.File]::WriteAllText($cli, $text, $utf8)
Write-Host 'cleaned tools/cli.mjs'

# 报告里的 emoji 也清掉（host 与 CLI 同源）
$host = Join-Path $root 'plugin/lib/index.js'
$text = [IO.File]::ReadAllText($host, [Text.Encoding]::UTF8)
$text = $emoji.Replace($text, '')
[IO.File]::WriteAllText($host, $text, $utf8)
Write-Host 'cleaned plugin/lib/index.js'
