$u = 'http://localhost:3000/network'
try {
  $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
  $out = Join-Path (Resolve-Path .).Path 'tmp_network.html'
  $r.Content | Out-File $out -Encoding utf8
  Write-Host "Saved: $out"
} catch {
  Write-Host "ERROR: $($_.Exception.Message)"
}