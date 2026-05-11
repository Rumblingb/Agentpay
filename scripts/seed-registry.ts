/**
 * Seed the MCP server registry with all 36 Rumblingb servers.
 * Run once: npx ts-node scripts/seed-registry.ts
 * Requires SUPABASE_DIRECT_URL env var (postgres://... direct connection).
 */

import postgres from 'postgres';

const PUBLISHER_ID = process.env.RUMBLINGB_AGENT_ID ?? '';
if (!PUBLISHER_ID) throw new Error('Set RUMBLINGB_AGENT_ID env var to your AgentPay agent ID');

const sql = postgres(process.env.SUPABASE_DIRECT_URL ?? '');

const SERVERS = [
  { slug: 'search-proxy',       name: 'Web Search',            category: 'search',     endpoint_url: 'https://search-proxy-mcp.vishar-rumbling.workers.dev',    pricing_model: 'free',    free_tier_calls: 1000, description: 'Web search for AI agents via MCP. DuckDuckGo powered. Zero API keys.' },
  { slug: 'weather',            name: 'Weather',               category: 'data',       endpoint_url: 'https://weather-mcp.vishar-rumbling.workers.dev',          pricing_model: 'free',    free_tier_calls: 500,  description: 'Weather forecasts and conditions via MCP. 7-day forecasts.' },
  { slug: 'currency-exchange',  name: 'Currency Exchange',     category: 'finance',    endpoint_url: 'https://currency-exchange-mcp.vishar-rumbling.workers.dev', pricing_model: 'free',    free_tier_calls: 500,  description: 'Real-time exchange rates. 166 currencies. Zero API keys.' },
  { slug: 'crypto-market',      name: 'Crypto Market Data',    category: 'finance',    endpoint_url: 'https://crypto-market-mcp.vishar-rumbling.workers.dev',    pricing_model: 'free',    free_tier_calls: 500,  description: 'CoinGecko prices, trends, historical data. Free.' },
  { slug: 'sec-financial',      name: 'SEC EDGAR Financials',  category: 'finance',    endpoint_url: 'https://sec-financial-mcp.vishar-rumbling.workers.dev',    pricing_model: 'monthly', price_monthly_usd: 19, free_tier_calls: 50,   description: 'SEC EDGAR XBRL facts, GAAP metrics, filings.' },
  { slug: 'ip-geolocation',     name: 'IP Geolocation',        category: 'data',       endpoint_url: 'https://ip-geolocation-mcp.vishar-rumbling.workers.dev',   pricing_model: 'free',    free_tier_calls: 500,  description: 'IP geolocation: city, region, country, org, timezone.' },
  { slug: 'hackernews',         name: 'HackerNews',            category: 'data',       endpoint_url: 'https://hackernews-mcp.vishar-rumbling.workers.dev',       pricing_model: 'free',    free_tier_calls: 1000, description: 'HackerNews stories, comments, users.' },
  { slug: 'pdf-generator',      name: 'PDF Generator',         category: 'utilities',  endpoint_url: 'https://pdf-generator-mcp.vishar-rumbling.workers.dev',    pricing_model: 'monthly', price_monthly_usd: 19, free_tier_calls: 25,   description: 'HTML, text, URLs to PDF via MCP.' },
  { slug: 'qr-code',            name: 'QR Code Generator',     category: 'utilities',  endpoint_url: 'https://qr-code-mcp.vishar-rumbling.workers.dev',          pricing_model: 'free',    free_tier_calls: 200,  description: 'QR code generation and decoding. Logos supported.' },
  { slug: 'text-to-speech',     name: 'Text to Speech',        category: 'utilities',  endpoint_url: 'https://text-to-speech-mcp.vishar-rumbling.workers.dev',   pricing_model: 'monthly', price_monthly_usd: 19, free_tier_calls: 25,   description: '50+ voices, edge-tts. MP3/WAV output.' },
  { slug: 'screenshot',         name: 'Website Screenshots',   category: 'utilities',  endpoint_url: 'https://screenshot-mcp.vishar-rumbling.workers.dev',       pricing_model: 'monthly', price_monthly_usd: 19, free_tier_calls: 10,   description: 'Desktop, mobile, element capture screenshots.' },
  { slug: 'web-scraper',        name: 'Web Scraper',           category: 'utilities',  endpoint_url: 'https://web-scraper-mcp.vishar-rumbling.workers.dev',      pricing_model: 'free',    free_tier_calls: 200,  description: 'Extract text, links, images, emails from web pages.' },
  { slug: 'image-analyzer',     name: 'Image Analyzer',        category: 'utilities',  endpoint_url: 'https://image-analyzer-mcp.vishar-rumbling.workers.dev',   pricing_model: 'free',    free_tier_calls: 200,  description: 'Dimensions, EXIF, colors, format conversion.' },
  { slug: 'file-converter',     name: 'File Converter',        category: 'utilities',  endpoint_url: 'https://file-converter-mcp.vishar-rumbling.workers.dev',   pricing_model: 'free',    free_tier_calls: 200,  description: 'CSV, JSON, YAML, Markdown conversion.' },
  { slug: 'notification',       name: 'Notifications',         category: 'utilities',  endpoint_url: 'https://notification-mcp.vishar-rumbling.workers.dev',     pricing_model: 'monthly', price_monthly_usd: 19, free_tier_calls: 50,   description: 'Slack, Discord, Email, webhooks notifications.' },
  { slug: 'email-agent',        name: 'Email Agent',           category: 'utilities',  endpoint_url: 'https://email-agent-mcp.vishar-rumbling.workers.dev',      pricing_model: 'monthly', price_monthly_usd: 19, free_tier_calls: 25,   description: 'Search, read, send, draft emails. Gmail/Outlook/Yahoo.' },
  { slug: 'email-verify',       name: 'Email Verification',    category: 'utilities',  endpoint_url: 'https://email-verify-mcp.vishar-rumbling.workers.dev',     pricing_model: 'free',    free_tier_calls: 500,  description: 'Format check, MX records, disposable detection.' },
  { slug: 'dns-lookup',         name: 'DNS Lookup',            category: 'network',    endpoint_url: 'https://dns-lookup-mcp.vishar-rumbling.workers.dev',       pricing_model: 'free',    free_tier_calls: 500,  description: 'A/AAAA/MX/NS/CNAME/TXT DNS records.' },
  { slug: 'ssl-check',          name: 'SSL Certificate Check', category: 'network',    endpoint_url: 'https://ssl-check-mcp.vishar-rumbling.workers.dev',        pricing_model: 'free',    free_tier_calls: 200,  description: 'Issuer, expiry, SANs check.' },
  { slug: 'domain-intel',       name: 'Domain Intelligence',   category: 'network',    endpoint_url: 'https://domain-intel-mcp.vishar-rumbling.workers.dev',     pricing_model: 'free',    free_tier_calls: 200,  description: 'IP geo, SSL, DNS, health checks.' },
  { slug: 'seo-audit',          name: 'SEO Audit',             category: 'marketing',  endpoint_url: 'https://seo-audit-mcp.vishar-rumbling.workers.dev',        pricing_model: 'monthly', price_monthly_usd: 19, free_tier_calls: 25,   description: 'Title, meta, headings, OG tags, keyword scoring.' },
  { slug: 'secret-scanner',     name: 'Secret Scanner',        category: 'security',   endpoint_url: 'https://secret-scanner-mcp.vishar-rumbling.workers.dev',   pricing_model: 'monthly', price_monthly_usd: 19, free_tier_calls: 25,   description: 'Detect leaked API keys, tokens, passwords.' },
  { slug: 'contract-analyzer',  name: 'Contract Analyzer',     category: 'legal',      endpoint_url: 'https://contract-analyzer-mcp.vishar-rumbling.workers.dev', pricing_model: 'monthly', price_monthly_usd: 19, free_tier_calls: 10,  description: 'GDPR/CCPA compliance. Legal document analysis.' },
  { slug: 'court-records',      name: 'US Court Records',      category: 'legal',      endpoint_url: 'https://court-records-mcp.vishar-rumbling.workers.dev',    pricing_model: 'monthly', price_monthly_usd: 19, free_tier_calls: 25,   description: '5M+ US court opinions via MCP.' },
  { slug: 'patent-search',      name: 'Patent Search',         category: 'legal',      endpoint_url: 'https://patent-search-mcp.vishar-rumbling.workers.dev',    pricing_model: 'free',    free_tier_calls: 100,  description: 'Google Patents + USPTO search.' },
  { slug: 'database-mcp',       name: 'Database Query',        category: 'data',       endpoint_url: 'https://database-mcp.vishar-rumbling.workers.dev',         pricing_model: 'monthly', price_monthly_usd: 19, free_tier_calls: 100,  description: 'SQLite, PostgreSQL, MySQL via MCP.' },
  { slug: 'rental-agent',       name: 'Rental Intelligence',   category: 'real-estate', endpoint_url: 'https://rental-agent-mcp.vishar-rumbling.workers.dev',   pricing_model: 'free',    free_tier_calls: 200,  description: '8 tools for rental market intelligence. Zero API keys.' },
  { slug: 'agent-wallet',       name: 'Agent Wallet',          category: 'payments',   endpoint_url: 'https://agent-wallet-mcp.vishar-rumbling.workers.dev',     pricing_model: 'free',    free_tier_calls: 500,  description: 'Agent wallet and budget management. Transfers, invoices.' },
  { slug: 'agent-passport',     name: 'Agent Passport',        category: 'identity',   endpoint_url: 'https://agent-passport-mcp.vishar-rumbling.workers.dev',   pricing_model: 'free',    free_tier_calls: 500,  description: 'Agent identity and reputation. Passport, skills, ratings.' },
  { slug: 'agent-audit',        name: 'Agent Audit Trail',     category: 'compliance', endpoint_url: 'https://agent-audit-mcp.vishar-rumbling.workers.dev',      pricing_model: 'free',    free_tier_calls: 500,  description: 'Immutable SHA-256 hash chain audit trail for A2A.' },
  { slug: 'agent-messaging',    name: 'Agent Messaging',       category: 'agents',     endpoint_url: 'https://agent-messaging-mcp.vishar-rumbling.workers.dev',  pricing_model: 'free',    free_tier_calls: 500,  description: 'Agent messaging protocol. Send, reply, proposals.' },
  { slug: 'agent-team',         name: 'Agent Team Formation',  category: 'agents',     endpoint_url: 'https://agent-team-mcp.vishar-rumbling.workers.dev',       pricing_model: 'free',    free_tier_calls: 200,  description: 'Multi-agent team formation. Roles, tasks, dependencies.' },
  { slug: 'agent-hire',         name: 'Agent Hire Marketplace',category: 'agents',     endpoint_url: 'https://agent-hire-mcp.vishar-rumbling.workers.dev',       pricing_model: 'free',    free_tier_calls: 200,  description: 'Post tasks, bids, escrow, disputes.' },
  { slug: 'agent-contract',     name: 'Agent Contracts',       category: 'agents',     endpoint_url: 'https://agent-contract-mcp.vishar-rumbling.workers.dev',   pricing_model: 'free',    free_tier_calls: 200,  description: 'Smart contracts between agents. Deliverables, penalties.' },
  { slug: 'agent-proof',        name: 'Agent Proof of Work',   category: 'agents',     endpoint_url: 'https://agent-proof-mcp.vishar-rumbling.workers.dev',      pricing_model: 'free',    free_tier_calls: 500,  description: 'Cryptographic proof of agent work. Receipts, verification.' },
  { slug: 'mcp-health-monitor', name: 'MCP Health Monitor',    category: 'monitoring', endpoint_url: 'https://mcp-health-monitor.vishar-rumbling.workers.dev',   pricing_model: 'free',    free_tier_calls: 500,  description: 'Check MCP server uptime, response time, TLS timing.' },
  { slug: 'hallucination-guard',name: 'Hallucination Guard',   category: 'safety',     endpoint_url: 'https://hallucination-guard.vishar-rumbling.workers.dev',  pricing_model: 'monthly', price_monthly_usd: 99, free_tier_calls: 10,   description: 'Verify agent responses against source context.' },
];

async function main() {
  console.log(`Seeding ${SERVERS.length} MCP servers for publisher ${PUBLISHER_ID}...`);
  for (const s of SERVERS) {
    await sql`
      INSERT INTO mcp_servers
        (slug, name, description, category, endpoint_url, publisher_id,
         pricing_model, price_per_call_usd, price_monthly_usd, free_tier_calls,
         status, verified, featured, domain_verified)
      VALUES (
        ${s.slug}, ${s.name}, ${s.description ?? null}, ${s.category},
        ${s.endpoint_url}, ${PUBLISHER_ID},
        ${s.pricing_model},
        ${(s as Record<string, unknown>).price_per_call_usd ?? null},
        ${(s as Record<string, unknown>).price_monthly_usd ?? null},
        ${s.free_tier_calls},
        'active', true, false, true
      )
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        endpoint_url = EXCLUDED.endpoint_url,
        status = 'active',
        verified = true,
        domain_verified = true,
        updated_at = now()
    `;
    process.stdout.write('.');
  }
  console.log(`\nDone. ${SERVERS.length} servers seeded.`);
  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
