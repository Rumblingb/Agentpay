/**
 * Seed the MCP server registry with all 36 Rumblingb servers.
 *
 * All 36 are stdio Python servers (cloned + run locally or via Smithery).
 * They go active immediately — no domain verification needed for stdio.
 *
 * Usage:
 *   RUMBLINGB_AGENT_ID=<your-agent-id> SUPABASE_DIRECT_URL=<postgres://...> \
 *   npx ts-node scripts/seed-registry.ts
 *
 * Get your agent ID from: POST /api/v1/agents/register (agentpay_register_agent tool)
 */

import postgres from 'postgres';

const PUBLISHER_ID = process.env.RUMBLINGB_AGENT_ID ?? '';
if (!PUBLISHER_ID) throw new Error('Set RUMBLINGB_AGENT_ID env var (your AgentPay agent ID)');

const sql = postgres(process.env.SUPABASE_DIRECT_URL ?? '');

type ServerSeed = {
  slug: string; name: string; description: string; category: string;
  transport: 'stdio'; github_url: string; command: string; command_args: string[];
  command_env?: Record<string, string>; metadata?: Record<string, unknown>;
  pricing_model: 'free' | 'monthly'; price_monthly_usd?: number; free_tier_calls: number;
  featured?: boolean;
};

const SERVERS: ServerSeed[] = [
  { slug: 'search-proxy',       name: 'Web Search',            category: 'search',     transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/search-proxy-mcp',       pricing_model: 'free',    free_tier_calls: 1000, featured: true,  description: 'Web search for AI agents via DuckDuckGo. Zero API keys required.' },
  { slug: 'weather',            name: 'Weather',               category: 'data',       transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/weather-mcp',             pricing_model: 'free',    free_tier_calls: 500,  featured: true,  description: 'Weather forecasts and conditions. 7-day forecasts, hourly data.' },
  { slug: 'currency-exchange',  name: 'Currency Exchange',     category: 'finance',    transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/currency-exchange-mcp',   pricing_model: 'free',    free_tier_calls: 500,  featured: true,  description: 'Real-time exchange rates. 166 currencies. Zero API keys.' },
  { slug: 'crypto-market',      name: 'Crypto Market Data',    category: 'finance',    transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/crypto-market-mcp',       pricing_model: 'free',    free_tier_calls: 500,  description: 'CoinGecko prices, trends, historical data.' },
  { slug: 'sec-financial',      name: 'SEC EDGAR Financials',  category: 'finance',    transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/sec-financial-mcp',       pricing_model: 'monthly', free_tier_calls: 50,   price_monthly_usd: 19, description: 'SEC EDGAR XBRL facts, GAAP metrics, company filings.' },
  { slug: 'ip-geolocation',     name: 'IP Geolocation',        category: 'data',       transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/ip-geolocation-mcp',      pricing_model: 'free',    free_tier_calls: 500,  description: 'IP to city, region, country, org, timezone. Zero API keys.' },
  { slug: 'hackernews',         name: 'HackerNews',            category: 'data',       transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/hackernews-mcp',          pricing_model: 'free',    free_tier_calls: 1000, description: 'HackerNews top stories, comments, user profiles.' },
  { slug: 'pdf-generator',      name: 'PDF Generator',         category: 'utilities',  transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/pdf-generator-mcp',       pricing_model: 'monthly', free_tier_calls: 25,   price_monthly_usd: 19, description: 'Generate PDFs from HTML, text, or URLs.' },
  { slug: 'qr-code',            name: 'QR Code Generator',     category: 'utilities',  transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/qr-code-mcp',             pricing_model: 'free',    free_tier_calls: 200,  description: 'Generate and decode QR codes. Logo support.' },
  { slug: 'text-to-speech',     name: 'Text to Speech',        category: 'utilities',  transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/text-to-speech-mcp',      pricing_model: 'monthly', free_tier_calls: 25,   price_monthly_usd: 19, description: '50+ voices via edge-tts. MP3/WAV output.' },
  { slug: 'screenshot',         name: 'Website Screenshots',   category: 'utilities',  transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/screenshot-mcp',          pricing_model: 'monthly', free_tier_calls: 10,   price_monthly_usd: 19, description: 'Desktop, mobile, element-level screenshots.' },
  { slug: 'web-scraper',        name: 'Web Scraper',           category: 'utilities',  transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/web-scraper-mcp',         pricing_model: 'free',    free_tier_calls: 200,  featured: true,  description: 'Extract text, links, images, emails from any web page.' },
  { slug: 'image-analyzer',     name: 'Image Analyzer',        category: 'utilities',  transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/image-analyzer-mcp',      pricing_model: 'free',    free_tier_calls: 200,  description: 'Dimensions, EXIF data, color extraction, format conversion.' },
  { slug: 'file-converter',     name: 'File Converter',        category: 'utilities',  transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/file-converter-mcp',      pricing_model: 'free',    free_tier_calls: 200,  description: 'CSV, JSON, YAML, Markdown format conversion.' },
  { slug: 'notification',       name: 'Notifications',         category: 'utilities',  transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/notification-mcp',        pricing_model: 'monthly', free_tier_calls: 50,   price_monthly_usd: 19, description: 'Send to Slack, Discord, Email, webhooks.' },
  { slug: 'email-agent',        name: 'Email Agent',           category: 'utilities',  transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/email-agent-mcp',         pricing_model: 'monthly', free_tier_calls: 25,   price_monthly_usd: 19, description: 'Search, read, send, draft emails. Gmail/Outlook/Yahoo.' },
  { slug: 'email-finder',       name: 'Email Finder',          category: 'marketing',  transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/email-finder-mcp',        pricing_model: 'monthly', free_tier_calls: 50,   price_monthly_usd: 9,  description: 'Find and verify email addresses for prospects and business contacts.' },
  { slug: 'email-verify',       name: 'Email Verification',    category: 'utilities',  transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/email-verify-mcp',        pricing_model: 'free',    free_tier_calls: 500,  description: 'Format check, MX record validation, disposable detection.' },
  { slug: 'dns-lookup',         name: 'DNS Lookup',            category: 'network',    transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/dns-lookup-mcp',          pricing_model: 'free',    free_tier_calls: 500,  description: 'A/AAAA/MX/NS/CNAME/TXT DNS records.' },
  { slug: 'ssl-check',          name: 'SSL Certificate Check', category: 'network',    transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/ssl-check-mcp',           pricing_model: 'free',    free_tier_calls: 200,  description: 'Certificate issuer, expiry, SANs, chain check.' },
  { slug: 'domain-intel',       name: 'Domain Intelligence',   category: 'network',    transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/domain-intel-mcp',        pricing_model: 'free',    free_tier_calls: 200,  description: 'IP geo, SSL, DNS, health checks for any domain.' },
  { slug: 'seo-audit',          name: 'SEO Audit',             category: 'marketing',  transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/seo-audit-mcp',           pricing_model: 'monthly', free_tier_calls: 25,   price_monthly_usd: 19, description: 'Title, meta, headings, OG tags, keyword scoring.' },
  { slug: 'content-toolkit',     name: 'Content Toolkit',       category: 'marketing',  transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/content-toolkit-mcp',      pricing_model: 'free',    free_tier_calls: 500,  description: 'Text processing tools for agents: diff, stats, case conversion, regex, JSON formatting, URLs, and tables.' },
  { slug: 'content-moderation',  name: 'Content Moderation',    category: 'safety',     transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/content-moderation-mcp', pricing_model: 'monthly', free_tier_calls: 100,  price_monthly_usd: 19, description: 'Moderate content for spam, toxicity, PII, profanity, and unsafe material.' },
  { slug: 'secret-scanner',     name: 'Secret Scanner',        category: 'security',   transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/secret-scanner-mcp',      pricing_model: 'monthly', free_tier_calls: 25,   price_monthly_usd: 19, description: 'Detect leaked API keys, tokens, passwords in code/text.' },
  { slug: 'contract-analyzer',  name: 'Contract Analyzer',     category: 'legal',      transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/contract-analyzer-mcp',   pricing_model: 'monthly', free_tier_calls: 10,   price_monthly_usd: 19, description: 'GDPR/CCPA compliance. Legal document analysis and risk scoring.' },
  { slug: 'agent-legal-counsel',name: 'Agent Legal Counsel',   category: 'legal',      transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/agent-legal-counsel-mcp',pricing_model: 'monthly', free_tier_calls: 10,   price_monthly_usd: 19, description: 'Generate and review legal contract drafts for agent workflows. Requires human review before use.' },
  { slug: 'court-records',      name: 'US Court Records',      category: 'legal',      transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/court-records-mcp',       pricing_model: 'monthly', free_tier_calls: 25,   price_monthly_usd: 19, description: '5M+ US court opinions search.' },
  { slug: 'patent-search',      name: 'Patent Search',         category: 'legal',      transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/patent-search-mcp',       pricing_model: 'free',    free_tier_calls: 100,  description: 'Google Patents + USPTO search.' },
  { slug: 'sec-edgar',          name: 'SEC EDGAR Search',      category: 'finance',    transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/sec-edgar-mcp',          pricing_model: 'monthly', free_tier_calls: 50,   price_monthly_usd: 19, description: 'Search SEC EDGAR filings and financial disclosures for public company research.' },
  { slug: 'company-intel',      name: 'Company Intelligence',  category: 'finance',    transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/company-intel-mcp',      pricing_model: 'monthly', free_tier_calls: 20,   price_monthly_usd: 29, description: 'Company intelligence combining SEC filings, patents, domain, WHOIS, and SSL data.' },
  { slug: 'database-mcp',       name: 'Database Query',        category: 'data',       transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/database-mcp',            pricing_model: 'monthly', free_tier_calls: 100,  price_monthly_usd: 19, description: 'SQLite, PostgreSQL, MySQL via MCP. Zero-config.' },
  { slug: 'wikipedia',          name: 'Wikipedia',             category: 'data',       transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/wikipedia-mcp',          pricing_model: 'free',    free_tier_calls: 1000, description: 'Search, read, and explore Wikipedia articles with zero API keys.' },
  { slug: 'rental-agent',       name: 'Rental Intelligence',   category: 'real-estate',transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/rental-agent-mcp',        pricing_model: 'free',    free_tier_calls: 200,  description: '8 tools for rental market intelligence. Zero API keys.' },
  { slug: 'agent-wallet',       name: 'Agent Wallet',          category: 'payments',   transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/agent-wallet-mcp',        pricing_model: 'free',    free_tier_calls: 500,  featured: true,  description: 'Agent wallet management, budget tracking, invoices.' },
  { slug: 'agent-passport',     name: 'Agent Passport',        category: 'identity',   transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/agent-passport-mcp',      pricing_model: 'free',    free_tier_calls: 500,  featured: true,  description: 'Agent identity and reputation system. Passport, skills, ratings.' },
  { slug: 'agent-audit',        name: 'Agent Audit Trail',     category: 'compliance', transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/agent-audit-mcp',         pricing_model: 'free',    free_tier_calls: 500,  description: 'Immutable SHA-256 hash chain audit trail for agent actions.' },
  { slug: 'agent-messaging',    name: 'Agent Messaging',       category: 'agents',     transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/agent-messaging-mcp',     pricing_model: 'free',    free_tier_calls: 500,  featured: true,  description: 'Agent-to-agent messaging protocol. Send, reply, proposals.' },
  { slug: 'agent-team',         name: 'Agent Team Formation',  category: 'agents',     transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/agent-team-mcp',          pricing_model: 'free',    free_tier_calls: 200,  description: 'Multi-agent team formation. Roles, tasks, dependencies.' },
  { slug: 'agent-hire',         name: 'Agent Hire Marketplace',category: 'agents',     transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/agent-hire-mcp',          pricing_model: 'free',    free_tier_calls: 200,  description: 'Post tasks, receive bids, escrow, dispute resolution.' },
  { slug: 'agent-contract',     name: 'Agent Contracts',       category: 'agents',     transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/agent-contract-mcp',      pricing_model: 'free',    free_tier_calls: 200,  description: 'Smart contracts between agents. Deliverables, penalties, dispute.' },
  { slug: 'agent-proof',        name: 'Agent Proof of Work',   category: 'agents',     transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/agent-proof-mcp',         pricing_model: 'free',    free_tier_calls: 500,  description: 'Cryptographic proof of agent work. SHA-256 receipts, verification.' },
  { slug: 'agent-memory',       name: 'Agent Memory',          category: 'agents',     transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/agent-memory-mcp',        pricing_model: 'free',    free_tier_calls: 500,  description: 'Persistent key-value memory for AI agents with TTL and search.' },
  { slug: 'agent-cost-tracker', name: 'Agent Cost Tracker',    category: 'agents',     transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/agent-cost-tracker-mcp',  pricing_model: 'free',    free_tier_calls: 500,  description: 'Track AI agent token usage, API costs, budget alerts, and cost reporting.' },
  { slug: 'agent-readme-generator', name: 'Agent README Generator', category: 'developer', transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/agent-readme-generator-mcp', pricing_model: 'monthly', free_tier_calls: 50, price_monthly_usd: 9, description: 'Generate, validate, and badge professional README files for agent and developer projects.' },
  { slug: 'pickaxe-agent-admin', name: 'Pickaxe Agent Admin',   category: 'agents',     transport: 'stdio', command: 'npx',     command_args: ['-y', 'mcp-pickaxe'], github_url: 'https://github.com/aplaceforallmystuff/mcp-pickaxe', pricing_model: 'free', free_tier_calls: 200, description: 'Manage Pickaxe agents, knowledge bases, users, analytics, products, and studio configuration via MCP.', command_env: { PICKAXE_STUDIO_MAIN: 'vault:pickaxe_studio_api_key' }, metadata: { provider: 'pickaxe', requires_human_credential_connect: true, required_credentials: ['Pickaxe Studio API key'], source: 'mcpservers.org/aplaceforallmystuff/mcp-pickaxe' } },
  { slug: 'mcp-health-monitor', name: 'MCP Health Monitor',    category: 'monitoring', transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/mcp-health-monitor',      pricing_model: 'free',    free_tier_calls: 500,  description: 'Check MCP server uptime, response time, TLS expiry.' },
  { slug: 'agentpay-sentinel',  name: 'AgentPay Sentinel',     category: 'safety',     transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/agentpay-sentinel-mcp',   pricing_model: 'monthly', free_tier_calls: 100,  price_monthly_usd: 19, description: 'Agent safety monitor for policy violations, rate limits, and anomalous agent behaviour.' },
  { slug: 'hallucination-guard',name: 'Hallucination Guard',   category: 'safety',     transport: 'stdio', command: 'python3', command_args: ['server.py'], github_url: 'https://github.com/Rumblingb/hallucination-guard',     pricing_model: 'monthly', free_tier_calls: 10,   price_monthly_usd: 99, description: 'Verify agent responses against source context. Confidence scoring.' },
];

async function main() {
  console.log(`Seeding ${SERVERS.length} MCP servers for publisher ${PUBLISHER_ID}...`);
  let ok = 0, skip = 0;
  for (const s of SERVERS) {
    try {
      await sql`
        INSERT INTO mcp_servers
          (slug, name, description, category, endpoint_url, publisher_id, transport,
           command, command_args, command_env, github_url, metadata,
           pricing_model, price_monthly_usd, free_tier_calls,
           status, verified, featured, domain_verified)
        VALUES (
          ${s.slug}, ${s.name}, ${s.description}, ${s.category},
          ${s.github_url}, ${PUBLISHER_ID}, ${s.transport},
          ${s.command}, ${JSON.stringify(s.command_args)}::jsonb, ${JSON.stringify(s.command_env ?? {})}::jsonb,
          ${s.github_url}, ${JSON.stringify(s.metadata ?? {})}::jsonb,
          ${s.pricing_model}, ${s.price_monthly_usd ?? null}, ${s.free_tier_calls},
          'active', true, ${s.featured ?? false}, true
        )
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          github_url = EXCLUDED.github_url,
          command = EXCLUDED.command,
          command_args = EXCLUDED.command_args,
          command_env = EXCLUDED.command_env,
          metadata = EXCLUDED.metadata,
          transport = EXCLUDED.transport,
          status = 'active', verified = true, domain_verified = true,
          updated_at = now()
      `;
      process.stdout.write('.');
      ok++;
    } catch (e) {
      console.error(`\nFailed: ${s.slug}`, (e as Error).message);
      skip++;
    }
  }
  console.log(`\nDone. ${ok} seeded, ${skip} failed.`);
  await sql.end();
}

main().catch(err => { console.error(err); process.exit(1); });
