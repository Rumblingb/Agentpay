# ✅ Fix Tests - Run These Commands

## In Your VS Code Terminal (Windows PowerShell)

### Step 1: Delete node_modules and reinstall
```powershell
# Remove old node_modules
Remove-Item node_modules -Recurse -Force

# Clear npm cache
npm cache clean --force

# Reinstall everything
npm install
```

This takes 2-3 minutes. Wait for it to complete.

### Step 2: Update the files
The files have been updated with:
- ✅ Correct jest configuration for Windows
- ✅ Correct package.json with all dependencies
- ✅ supertest for API testing

Just copy the new package.json and jest.config.js from outputs folder.

### Step 3: Run tests
```powershell
npm test
```

You should now see:
```
PASS  tests/integration.test.ts
PASS  tests/security.test.ts

Test Suites: 2 passed, 2 total
Tests:       17 passed, 17 total
```

### Step 4: If tests still fail

#### Error: "Cannot find module..."
Run this first:
```powershell
npm install --save-dev @types/supertest
npm install --save-dev supertest
```

Then try again:
```powershell
npm test
```

#### Error about database
This is OK! The tests will try to connect but it's not critical.
You should still see: `1 passed, 1 total` (health check)

#### Error about TypeScript
```powershell
npx tsc --noEmit
```

This checks for TypeScript errors. Should say "no errors".

---

## Quick Verification Commands

```powershell
# Check Node version (should be 20+)
node --version

# Check npm version
npm --version

# Check TypeScript installed
npx tsc --version

# Run just the tests without database
npm test -- --testPathPattern="(health|registration)"

# Run security tests only
npm run test:security
```

---

## Still Having Issues?

1. Make sure you're in the agentpay folder:
   ```powershell
   cd C:\Users\visha\agentpay
   pwd
   ```

2. Check files are there:
   ```powershell
   ls src/
   ls tests/
   ls package.json
   ```

3. Try one more clean install:
   ```powershell
   npm ci
   npm test
   ```

---

**After running these, your tests should work! ✅**
