# Push the current HEAD tree to GitHub through the REST API.
# Needed because this machine cannot reach github.com:443 (git push times out),
# while api.github.com is reachable. Creates blobs, a tree, a commit and the ref.
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$owner = 'jincheng3870682453-hash'
$repo = 'dsh-doctor'
$root = Split-Path -Parent $PSScriptRoot

function Invoke-Gh {
    param([string[]]$Arguments)
    $text = (& gh @Arguments 2>&1 | Out-String)
    return [pscustomobject]@{ code = $LASTEXITCODE; text = $text }
}

Push-Location $root
try {
    $probe = Invoke-Gh @('api', "repos/$owner/$repo/git/refs/heads/main")
    if ($probe.code -ne 0) {
        Write-Host 'bootstrap: repository has no branch yet, creating the default branch'
        $readmeB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'README.md')))
        $boot = Invoke-Gh @('api', "repos/$owner/$repo/contents/README.md", '-X', 'PUT',
            '-f', 'message=chore: initialize repository', '-f', "content=$readmeB64")
        if ($boot.code -ne 0) { throw "bootstrap failed: $($boot.text)" }
        Write-Host 'bootstrap done'
    }

    $lines = & git ls-tree -r HEAD
    $entries = New-Object System.Collections.ArrayList
    foreach ($line in $lines) {
        $match = [regex]::Match($line, '^(\d+)\s+blob\s+([0-9a-f]+)\t(.+)$')
        if (-not $match.Success) { continue }
        $mode = $match.Groups[1].Value
        $path = $match.Groups[3].Value
        $full = Join-Path $root ($path -replace '/', '\')
        $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($full))
        $blob = Invoke-Gh @('api', "repos/$owner/$repo/git/blobs", '-f', "content=$b64", '-f', 'encoding=base64')
        if ($blob.code -ne 0) { throw "blob failed for ${path}: $($blob.text)" }
        $obj = $blob.text | ConvertFrom-Json
        [void]$entries.Add([ordered]@{ path = $path; mode = $mode; type = 'blob'; sha = $obj.sha })
        Write-Host ('  blob ' + $obj.sha.Substring(0, 7) + '  ' + $path)
    }

    $treeFile = Join-Path $env:TEMP 'dsh-doctor-tree.json'
    Set-Content -LiteralPath $treeFile -Value (@{ tree = $entries.ToArray() } | ConvertTo-Json -Depth 6 -Compress) -Encoding ASCII
    $treeResult = Invoke-Gh @('api', "repos/$owner/$repo/git/trees", '--input', $treeFile)
    if ($treeResult.code -ne 0) { throw "tree failed: $($treeResult.text)" }
    $tree = $treeResult.text | ConvertFrom-Json
    Write-Host ('tree ' + $tree.sha)

    $message = (& git log -1 --pretty='%s')
    $commitFile = Join-Path $env:TEMP 'dsh-doctor-commit.json'
    Set-Content -LiteralPath $commitFile -Value (@{ message = $message; tree = $tree.sha } | ConvertTo-Json -Compress) -Encoding ASCII
    $commitResult = Invoke-Gh @('api', "repos/$owner/$repo/git/commits", '--input', $commitFile)
    if ($commitResult.code -ne 0) { throw "commit failed: $($commitResult.text)" }
    $commit = $commitResult.text | ConvertFrom-Json
    Write-Host ('commit ' + $commit.sha)

    $refFile = Join-Path $env:TEMP 'dsh-doctor-ref.json'
    Set-Content -LiteralPath $refFile -Value (@{ sha = $commit.sha; force = $true } | ConvertTo-Json -Compress) -Encoding ASCII
    $refResult = Invoke-Gh @('api', "repos/$owner/$repo/git/refs/heads/main", '-X', 'PATCH', '--input', $refFile)
    if ($refResult.code -ne 0) { throw "ref failed: $($refResult.text)" }
    $ref = $refResult.text | ConvertFrom-Json
    Write-Host ('ref ' + $ref.ref)
    Write-Host 'PUSH_VIA_API_OK'
} finally {
    Pop-Location
}
