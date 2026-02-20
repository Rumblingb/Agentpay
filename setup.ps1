Write-Host "========== AgentPay Setup ==========" -ForegroundColor Green
Write-Host ""

if (-not (Test-Path "new")) {
    Write-Host "ERROR: new folder not found!" -ForegroundColor Red
    exit 1
}

Write-Host "Found new folder - organizing files..." -ForegroundColor Cyan
Write-Host ""

# Create folders
Write-Host "Creating folders..." -ForegroundColor Yellow
mkdir src/security -Force | Out-Null
mkdir src/db -Force | Out-Null
mkdir src/services -Force | Out-Null
mkdir src/middleware -Force | Out-Null
mkdir src/routes -Force | Out-Null
mkdir tests -Force | Out-Null
Write-Host "Folders created" -ForegroundColor Green
Write-Host ""

# Copy files
Write-Host "Copying files..." -ForegroundColor Yellow

Copy-Item "new/payment-verification.ts" "src/security/" -Force -ErrorAction SilentlyContinue
Copy-Item "new/init.ts" "src/db/" -Force -ErrorAction SilentlyContinue
Copy-Item "new/index.ts" "src/db/" -Force -ErrorAction SilentlyContinue
Copy-Item "new/merchants.ts" "src/services/" -Force -ErrorAction SilentlyContinue
Copy-Item "new/transactions.ts" "src/services/" -Force -ErrorAction SilentlyContinue
Copy-Item "new/auth.ts" "src/middleware/" -Force -ErrorAction SilentlyContinue
Copy-Item "new/server.ts" "src/" -Force -ErrorAction SilentlyContinue
Copy-Item "new/logger.ts" "src/" -Force -ErrorAction SilentlyContinue
Copy-Item "new/integration.test.ts" "tests/" -Force -ErrorAction SilentlyContinue
Copy-Item "new/security.test.ts" "tests/" -Force -ErrorAction SilentlyContinue
Copy-Item "new/setup.ts" "tests/" -Force -ErrorAction SilentlyContinue
Copy-Item "new/package.json" "." -Force -ErrorAction SilentlyContinue
Copy-Item "new/tsconfig.json" "." -Force -ErrorAction SilentlyContinue
Copy-Item "new/jest.config.js" "." -Force -ErrorAction SilentlyContinue
Copy-Item "new/_env.example" ".env" -Force -ErrorAction SilentlyContinue
Copy-Item "new/_gitignore" ".gitignore" -Force -ErrorAction SilentlyContinue

Get-ChildItem "new" -Filter "*.md" -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName "." -Force
}

Get-ChildItem "new" -Filter "*.txt" -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName "." -Force
}

Write-Host "Files copied" -ForegroundColor Green
Write-Host ""

# Verify
Write-Host "Verifying..." -ForegroundColor Yellow
Write-Host ""

$count = 0
if (Test-Path "src/security/payment-verification.ts") { Write-Host "OK: src/security/payment-verification.ts" -ForegroundColor Green; $count++ }
if (Test-Path "src/db/init.ts") { Write-Host "OK: src/db/init.ts" -ForegroundColor Green; $count++ }
if (Test-Path "src/db/index.ts") { Write-Host "OK: src/db/index.ts" -ForegroundColor Green; $count++ }
if (Test-Path "src/services/merchants.ts") { Write-Host "OK: src/services/merchants.ts" -ForegroundColor Green; $count++ }
if (Test-Path "src/services/transactions.ts") { Write-Host "OK: src/services/transactions.ts" -ForegroundColor Green; $count++ }
if (Test-Path "src/middleware/auth.ts") { Write-Host "OK: src/middleware/auth.ts" -ForegroundColor Green; $count++ }
if (Test-Path "src/server.ts") { Write-Host "OK: src/server.ts" -ForegroundColor Green; $count++ }
if (Test-Path "src/logger.ts") { Write-Host "OK: src/logger.ts" -ForegroundColor Green; $count++ }
if (Test-Path "tests/integration.test.ts") { Write-Host "OK: tests/integration.test.ts" -ForegroundColor Green; $count++ }
if (Test-Path "tests/security.test.ts") { Write-Host "OK: tests/security.test.ts" -ForegroundColor Green; $count++ }
if (Test-Path "tests/setup.ts") { Write-Host "OK: tests/setup.ts" -ForegroundColor Green; $count++ }
if (Test-Path "package.json") { Write-Host "OK: package.json" -ForegroundColor Green; $count++ }
if (Test-Path "tsconfig.json") { Write-Host "OK: tsconfig.json" -ForegroundColor Green; $count++ }
if (Test-Path "jest.config.js") { Write-Host "OK: jest.config.js" -ForegroundColor Green; $count++ }
if (Test-Path ".env") { Write-Host "OK: .env" -ForegroundColor Green; $count++ }
if (Test-Path ".gitignore") { Write-Host "OK: .gitignore" -ForegroundColor Green; $count++ }

Write-Host ""
Write-Host "Found: $count files" -ForegroundColor Green
Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  npm install" -ForegroundColor Cyan
Write-Host "  npm test" -ForegroundColor Cyan
Write-Host "  npm run dev" -ForegroundColor Cyan
Write-Host ""
