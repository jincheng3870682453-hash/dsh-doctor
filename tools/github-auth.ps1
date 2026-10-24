# Initiate GitHub device-flow authorization and store the resulting token in gh.
# Prints the one-time code, then polls until the user approves it in a browser.
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$clientId = 'Iv1.b507a08c87ecfe98'
$headers = @{ accept = 'application/json'; 'user-agent' = 'dsh-doctor' }

try {
    $device = Invoke-RestMethod -Method Post -Uri 'https://github.com/login/device/code' `
        -Headers $headers -Body @{ client_id = $clientId; scope = 'repo' } -TimeoutSec 30
} catch {
    "DEVICE_CODE_FAILED: $($_.Exception.Message)"
    exit 1
}

"CODE=$($device.user_code)"
"URL=$($device.verification_uri)"
"EXPIRES_IN=$($device.expires_in)"
Set-Content -LiteralPath (Join-Path $env:TEMP 'dsh-gh-device.txt') `
    -Value ("$($device.user_code) $($device.verification_uri)") -Encoding ASCII

$interval = [int]$device.interval
if ($interval -lt 5) { $interval = 5 }
$deadline = (Get-Date).AddSeconds([int]$device.expires_in)

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds $interval
    $payload = @{
        client_id   = $clientId
        device_code = $device.device_code
        grant_type  = 'urn:ietf:params:oauth:grant-type:device_code'
    }
    try {
        $result = Invoke-RestMethod -Method Post -Uri 'https://github.com/login/oauth/access_token' `
            -Headers $headers -Body $payload -TimeoutSec 30
    } catch {
        "POLL_ERROR: $($_.Exception.Message)"
        continue
    }
    if ($result.access_token) {
        $result.access_token | gh auth login --with-token 2>&1 | Out-String
        gh auth setup-git 2>&1 | Out-String
        "AUTH_DONE"
        gh auth status 2>&1 | Out-String
        exit 0
    }
    switch ([string]$result.error) {
        'authorization_pending' { "status: waiting for approval" }
        'slow_down' { $interval += 5; "status: slow_down" }
        'expired_token' { "ERROR: code expired, run again"; exit 1 }
        'access_denied' { "ERROR: user denied the authorization"; exit 1 }
        default { "status: $($result.error) $($result.error_description)" }
    }
}
"ERROR: timed out waiting for approval"
exit 1
