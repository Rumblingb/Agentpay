const { execSync } = require('child_process');

console.log('🚀 AgentPay Diagnostic Tool: Filtering Failures...\n');

try {
  // Run tests and capture everything
  const output = execSync('npm test', { encoding: 'utf8', stdio: 'pipe' });
  console.log("✅ All tests passed!");
} catch (error) {
  const raw = error.stdout + error.stderr;

  console.log('📊 Analysis of Failures:\n');

  // 1. Check for the AggregateError / Connection issue
  if (raw.includes('AggregateError')) {
    console.log('❌ DATABASE CONNECTION ERROR');
    console.log('   👉 The app cannot connect to Postgres.');
    console.log('   👉 Fix: Ensure Postgres is running on localhost:5432 and check your DATABASE_URL.\n');
  }

  // 2. Check for the missing bots table
  if (raw.includes('relation "bots" does not exist')) {
    console.log('❌ MISSING TABLE ERROR');
    console.log('   👉 The "bots" table is missing from your database.');
    console.log('   👉 Fix: Run your migration scripts or create the table manually.\n');
  }

  // 3. Check for the 401 Unauthorized chain reaction
  if (raw.includes('Received: 401')) {
    console.log('❌ AUTHENTICATION ERROR (401)');
    console.log('   👉 API calls are being rejected because the API Key is missing or invalid.');
    console.log('   👉 Note: This usually happens because Merchant Registration failed first.\n');
  }

  // 4. Show the first few actual error lines for context
  console.log('🔍 First few lines of the raw error for detail:');
  const lines = raw.split('\n');
  const errorLines = lines.filter(l => l.includes('Error') || l.includes('FAIL')).slice(0, 10);
  errorLines.forEach(l => console.log(`   ${l.trim()}`));
}