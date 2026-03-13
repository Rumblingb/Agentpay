$base = 'http://localhost:3000'
$paths = @('/','/network','/registry','/trust','/build')
$tokens = @('heading-xl','text-body','panel-glass','btn-primary','content-wrap','live-dot')

foreach ($p in $paths) {
  $u = $base + $p
  try {
    $resp = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    $html = $resp.Content
    $hdrCount = ([regex]::Matches($html, '<header\b')).Count
    $founding = ([regex]::Matches($html, 'Founding Era Beta')).Count
    $missing = @()
    foreach ($t in $tokens) { if (-not $html.Contains($t)) { $missing += $t } }
    if ($missing.Count -eq 0) { $miss = 'none' } else { $miss = $missing -join ',' }
    Write-Host "PATH:$p STATUS:OK headerTags=$hdrCount foundingBadge=$found missTokens=$miss"
  } catch {
    Write-Host "PATH:$p ERROR: $($_.Exception.Message)"
  }
}