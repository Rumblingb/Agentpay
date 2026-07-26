# Founder Demo Inputs

These files are safe request bodies for the terminal-native founder proof demo.
They contain no credentials. AgentPay injects a vaulted provider credential only
at server-side execution time.

## Databento: flagship paid-data proof

Use this for the canonical connect, approve, resume, and reuse recording:

```powershell
npm run demo:founder-proof -- `
  --api-key $env:AGENTPAY_API_KEY `
  --principal-id $env:AGENTPAY_PRINCIPAL_ID `
  --provider databento `
  --workbench-id founder-proof-databento `
  --execute-path /timeseries/get_range `
  --execute-body-file ops/founder-demo/databento-get-range.example.json `
  --poll-seconds 120
```

Replace the dataset and symbol only with data covered by the connected
Databento account. The runner writes a sanitized transcript locally; it does
not write the API key or provider credential to the transcript.

## Firecrawl: general web-workflow proof

Use this as the second demo path after the Databento proof is green:

```powershell
npm run demo:founder-proof -- `
  --api-key $env:AGENTPAY_API_KEY `
  --principal-id $env:AGENTPAY_PRINCIPAL_ID `
  --provider firecrawl `
  --workbench-id founder-proof-firecrawl `
  --execute-path /v1/scrape `
  --execute-body-file ops/founder-demo/firecrawl-crawl.example.json `
  --poll-seconds 120
```

Use a public page you are allowed to retrieve. Do not use this demo to crawl
private, authenticated, or sensitive content.

