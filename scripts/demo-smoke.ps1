param(
  [string] $BaseUrl = 'https://agentpay-api.apaybeta.workers.dev'
)

function Fail($msg) {
  Write-Host "ERROR: $msg" -ForegroundColor Red
  exit 1
}

function SafeJson($s) {
  try { return $s | ConvertFrom-Json -ErrorAction Stop } catch { return $null }
}

$ts = (Get-Date).ToString('yyyyMMddHHmmss')
$uniqueEmail = "demo+$ts@example.com"
$walletAddress = '9B5X2Fwc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8H'  # replace if desired

Write-Host "BASE: $BaseUrl"
Write-Host "Registering merchant with email: $uniqueEmail"

# Helper to perform HTTP and return parsed JSON + status
function Do-Request {
  param($method, $url, $headers, $body)
  try {
    $opts = @{ Uri = $url; Method = $method; Headers = $headers; ErrorAction = 'Stop' }
    if ($body) {
      $opts.Body = ($body | ConvertTo-Json -Depth 10)
      $opts.ContentType = 'application/json'
    }
    $resp = Invoke-WebRequest @opts
    $json = SafeJson $resp.Content
    return @{ status = $resp.StatusCode; content = $json; raw = $resp.Content }
  } catch {
    if ($_ -and $_.Exception.Response) {
      $r = $_.Exception.Response
      try { $body = (New-Object System.IO.StreamReader($r.GetResponseStream())).ReadToEnd() } catch { $body = $_.Exception.Message }
      return @{ status = ($r.StatusCode.value__ 2>&1); content = SafeJson $body; raw = $body; error = $_.Exception.Message }
    }
    return @{ status = 0; content = $null; raw = $_.Exception.Message; error = $_.Exception.Message }
  }
}

# Track failures
$global:CriticalFailed = $false

# Step 1: Health
$h = Do-Request 'GET' "$BaseUrl/health" @{} $null
if ($h.status -ne 200) { Fail "Health check failed ($($h.status)): $($h.raw)" }
Write-Host "Health OK: $($h.content.status) @ $($h.content.version)"

# Step 2: Register merchant
$regBody = @{ name = 'Demo Merchant'; email = $uniqueEmail; walletAddress = $walletAddress }
$reg = Do-Request 'POST' "$BaseUrl/api/merchants/register" @{} $regBody
if ($reg.status -ne 201) { Fail "Register failed ($($reg.status)): $($reg.raw)" }
if (-not $reg.content.apiKey -or -not $reg.content.merchantId) { Fail "Register response missing apiKey/merchantId: $($reg.raw)" }
$apiKey = $reg.content.apiKey
$merchantId = $reg.content.merchantId
Write-Host "Registered merchantId=$merchantId apiKeyLength=$($apiKey.Length)"

# Step 3: Profile check
$hdr = @{ Authorization = "Bearer $apiKey" }
$prof = Do-Request 'GET' "$BaseUrl/api/merchants/profile" $hdr $null
if ($prof.status -ne 200) { Fail "Profile check failed ($($prof.status)): $($prof.raw)" }
if (($prof.content.email).ToLower() -ne $uniqueEmail.ToLower()) { Fail "Profile email mismatch: got $($prof.content.email) expected $uniqueEmail" }
Write-Host "Profile verified, email matches."

# Step 4: Spawn demo agent (guaranteed demo-confirmed tx)
$spawn = Do-Request 'POST' "$BaseUrl/api/demo/spawn-agent" $hdr $null
if ($spawn.status -ge 400) { Fail "Spawn-agent failed ($($spawn.status)): $($spawn.raw)" }
if (-not $spawn.content.transactionId) { Fail "Spawn response missing transactionId: $($spawn.raw)" }
$demoTxId = $spawn.content.transactionId
Write-Host "Spawned demo transaction: $demoTxId"

# Step 5: Fetch transaction (spawned)
$tx = Do-Request 'GET' "$BaseUrl/api/merchants/payments/$demoTxId" $hdr $null
if ($tx.status -ne 200) { Fail "Fetch transaction failed ($($tx.status)): $($tx.raw)" }
Write-Host "Fetched transaction status: $($tx.content.status)"

# Step 6: List payments & activity
$payments = Do-Request 'GET' "$BaseUrl/api/merchants/payments" $hdr $null
$activity = Do-Request 'GET' "$BaseUrl/api/intents/activity" $hdr $null
if ($payments.status -ne 200) { Write-Host "Warning: payments list failed ($($payments.status)): $($payments.raw)" -ForegroundColor Yellow }
if ($activity.status -ne 200) { Write-Host "Warning: activity feed failed ($($activity.status)): $($activity.raw)" -ForegroundColor Yellow }
try { $paymentsCount = ($payments.content.transactions | Measure-Object).Count } catch { $paymentsCount = 0 }
try { $activityCount = ($activity.content.activity | Measure-Object).Count } catch { $activityCount = 0 }
Write-Host "Payments count: $paymentsCount ; Activity count: $activityCount"

# Step 7: Optional rotate key
$rotate = Do-Request 'POST' "$BaseUrl/api/merchants/rotate-key" $hdr $null
if ($rotate.status -eq 200 -and $rotate.content.apiKey) {
  $apiKey = $rotate.content.apiKey
  Write-Host "Rotated API key successfully; new key length: $($apiKey.Length)"
  # verify new key works
  $hdr = @{ Authorization = "Bearer $apiKey" }
  $prof2 = Do-Request 'GET' "$BaseUrl/api/merchants/profile" $hdr $null
  if ($prof2.status -ne 200) { Fail "Profile check after rotate failed ($($prof2.status)): $($prof2.raw)" }
  Write-Host "Profile verified with rotated key."
} else {
  Write-Host "Rotate-key not available or no key returned. Continuing without rotate."
}

Write-Host "`nDEMO SMOKE: PASS" -ForegroundColor Green
Write-Host "merchantId: $merchantId"
Write-Host "apiKey (masked): $($apiKey.Substring(0,8))... (length $($apiKey.Length))"
Write-Host "demoTxId: $demoTxId"
exit 0
