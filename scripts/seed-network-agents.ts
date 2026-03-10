/**
 * Seed script — register 16 network seed agents across 5 categories.
 *
 * These agents seed the trust graph with initial participants:
 *   - Data agents (4)
 *   - Analysis agents (4)
 *   - Code agents (3)
 *   - Verification agents (3)
 *   - Monitoring agents (2)
 *
 * Usage:
 *   npx tsx scripts/seed-network-agents.ts
 *
 * Safe to re-run: uses upsert with fixed IDs.
 *
 * Prerequisites:
 *   - DATABASE_URL set in .env
 *   - node scripts/migrate.js has been run
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

// Fixed UUIDs — never change in production once set.
const SEED_AGENTS = [
  // ── Data Agents ──────────────────────────────────────────────────────────
  {
    id: '00000000-da00-0000-0000-000000000001',
    displayName: 'DataFetchAgent',
    service: 'data-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/data-fetch`,
    pricingModel: { per_request: { amount: 0.10, currency: 'USD', description: 'Fetch and return structured data' } },
    rating: 4.8,
    trustScore: 75.0,
    description: 'Fetches and normalizes structured data from public sources',
  },
  {
    id: '00000000-da00-0000-0000-000000000002',
    displayName: 'DataPipelineAgent',
    service: 'data-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/data-pipeline`,
    pricingModel: { per_pipeline: { amount: 0.50, currency: 'USD', description: 'Run a data transformation pipeline' } },
    rating: 4.7,
    trustScore: 72.0,
    description: 'Transforms and routes data through multi-step pipelines',
  },
  {
    id: '00000000-da00-0000-0000-000000000003',
    displayName: 'DataIndexAgent',
    service: 'data-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/data-index`,
    pricingModel: { per_index: { amount: 0.25, currency: 'USD', description: 'Index documents for fast retrieval' } },
    rating: 4.6,
    trustScore: 70.0,
    description: 'Indexes and organizes documents for search and retrieval',
  },
  {
    id: '00000000-da00-0000-0000-000000000004',
    displayName: 'DataCleanAgent',
    service: 'data-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/data-clean`,
    pricingModel: { per_batch: { amount: 0.30, currency: 'USD', description: 'Clean and deduplicate a data batch' } },
    rating: 4.5,
    trustScore: 68.0,
    description: 'Cleans, deduplicates, and validates raw data batches',
  },

  // ── Analysis Agents ──────────────────────────────────────────────────────
  {
    id: '00000000-aa00-0000-0000-000000000001',
    displayName: 'SentimentAnalysisAgent',
    service: 'analysis-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/sentiment`,
    pricingModel: { per_document: { amount: 0.05, currency: 'USD', description: 'Sentiment analysis on text' } },
    rating: 4.9,
    trustScore: 80.0,
    description: 'Classifies sentiment and tone of text documents',
  },
  {
    id: '00000000-aa00-0000-0000-000000000002',
    displayName: 'SummaryAgent',
    service: 'analysis-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/summary`,
    pricingModel: { per_summary: { amount: 0.15, currency: 'USD', description: 'Summarize a document' } },
    rating: 4.8,
    trustScore: 77.0,
    description: 'Generates concise summaries of long-form documents',
  },
  {
    id: '00000000-aa00-0000-0000-000000000003',
    displayName: 'ClassifierAgent',
    service: 'analysis-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/classify`,
    pricingModel: { per_item: { amount: 0.03, currency: 'USD', description: 'Classify an item into a taxonomy' } },
    rating: 4.7,
    trustScore: 74.0,
    description: 'Classifies items into predefined taxonomies',
  },
  {
    id: '00000000-aa00-0000-0000-000000000004',
    displayName: 'AnomalyDetectorAgent',
    service: 'analysis-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/anomaly`,
    pricingModel: { per_scan: { amount: 0.20, currency: 'USD', description: 'Anomaly detection scan' } },
    rating: 4.6,
    trustScore: 71.0,
    description: 'Detects anomalies and outliers in structured data streams',
  },

  // ── Code Agents ──────────────────────────────────────────────────────────
  {
    id: '00000000-ca00-0000-0000-000000000001',
    displayName: 'CodeReviewAgent',
    service: 'code-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/code-review`,
    pricingModel: { per_review: { amount: 1.00, currency: 'USD', description: 'Review a code diff or file' } },
    rating: 4.9,
    trustScore: 82.0,
    description: 'Reviews code for quality, security, and correctness',
  },
  {
    id: '00000000-ca00-0000-0000-000000000002',
    displayName: 'CodeGenAgent',
    service: 'code-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/code-gen`,
    pricingModel: { per_task: { amount: 2.00, currency: 'USD', description: 'Generate code from a specification' } },
    rating: 4.7,
    trustScore: 76.0,
    description: 'Generates code from natural language specifications',
  },
  {
    id: '00000000-ca00-0000-0000-000000000003',
    displayName: 'TestGenAgent',
    service: 'code-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/test-gen`,
    pricingModel: { per_suite: { amount: 1.50, currency: 'USD', description: 'Generate unit tests for a module' } },
    rating: 4.6,
    trustScore: 73.0,
    description: 'Generates unit and integration tests for code modules',
  },

  // ── Verification Agents ───────────────────────────────────────────────────
  {
    id: '00000000-va00-0000-0000-000000000001',
    displayName: 'FactCheckAgent',
    service: 'verification-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/fact-check`,
    pricingModel: { per_claim: { amount: 0.25, currency: 'USD', description: 'Verify a factual claim' } },
    rating: 4.8,
    trustScore: 78.0,
    description: 'Verifies factual claims against authoritative sources',
  },
  {
    id: '00000000-va00-0000-0000-000000000002',
    displayName: 'SourceVerifierAgent',
    service: 'verification-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/source-verify`,
    pricingModel: { per_source: { amount: 0.10, currency: 'USD', description: 'Verify source credibility' } },
    rating: 4.7,
    trustScore: 75.0,
    description: 'Assesses the credibility and provenance of data sources',
  },
  {
    id: '00000000-va00-0000-0000-000000000003',
    displayName: 'SchemaValidatorAgent',
    service: 'verification-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/schema-validate`,
    pricingModel: { per_validation: { amount: 0.05, currency: 'USD', description: 'Validate data against a schema' } },
    rating: 4.9,
    trustScore: 79.0,
    description: 'Validates structured data against JSON Schema or OpenAPI specs',
  },

  // ── Monitoring Agents ─────────────────────────────────────────────────────
  {
    id: '00000000-ma00-0000-0000-000000000001',
    displayName: 'UptimeMonitorAgent',
    service: 'monitoring-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/uptime`,
    pricingModel: { per_check: { amount: 0.01, currency: 'USD', description: 'Health-check an endpoint' } },
    rating: 5.0,
    trustScore: 85.0,
    description: 'Monitors endpoint availability and reports uptime metrics',
  },
  {
    id: '00000000-ma00-0000-0000-000000000002',
    displayName: 'PerformanceProfilerAgent',
    service: 'monitoring-agent',
    endpointUrl: `${BASE_URL}/api/agents/seed/perf-profile`,
    pricingModel: { per_profile: { amount: 0.50, currency: 'USD', description: 'Profile response time and throughput' } },
    rating: 4.8,
    trustScore: 76.0,
    description: 'Profiles agent response times, throughput, and resource usage',
  },
] as const;

async function main() {
  console.log('[seed-network-agents] Starting — seeding 16 network agents across 5 categories...\n');

  const categories: Record<string, number> = {};

  for (const agent of SEED_AGENTS) {
    const { description, ...data } = agent;

    const result = await prisma.agent.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        displayName: data.displayName,
        service: data.service,
        endpointUrl: data.endpointUrl,
        pricingModel: data.pricingModel,
        rating: data.rating,
        operatorId: 'platform',
        trustScore: data.trustScore,
      },
      update: {
        displayName: data.displayName,
        service: data.service,
        endpointUrl: data.endpointUrl,
        pricingModel: data.pricingModel,
        rating: data.rating,
        operatorId: 'platform',
        trustScore: data.trustScore,
      },
    });

    categories[data.service] = (categories[data.service] ?? 0) + 1;
    console.log(`[✓] ${result.displayName} (${data.service})`);
    console.log(`    note: ${description}`);
    console.log();
  }

  console.log('[seed-network-agents] Done.\n');
  console.log('Agents seeded by category:');
  for (const [category, count] of Object.entries(categories)) {
    console.log(`  ${category}: ${count}`);
  }
  console.log(`\nTotal: ${SEED_AGENTS.length} agents`);
  console.log('\nNext steps:');
  console.log('  - View in registry:    GET /api/agents/discover');
  console.log('  - Leaderboard:         GET /api/agents/leaderboard');
  console.log('  - Also run:            npx tsx scripts/seed-foundation-agents.ts');
}

main()
  .catch((e) => {
    console.error('[seed-network-agents] Error:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
