/**
 * Seed script — insert 120 realistic agent-to-agent interactions and
 * derive initial AgentReputation records from them.
 *
 * Safe to re-run: every transaction uses a fixed ID (seed_tx_NNN) so
 * repeated runs upsert rather than duplicate.
 *
 * What this seeds:
 *   - 120 AgentTransaction rows across 20 agents
 *   - 120 AgentEscrow rows (one per transaction)
 *   - 20 AgentReputation rows (upserted from seller perspective)
 *
 * Usage:
 *   npx tsx scripts/seed-interactions.ts
 *
 * Prerequisites:
 *   - DATABASE_URL set in .env
 *   - node scripts/migrate.js has been run
 *   - npx tsx scripts/seed-foundation-agents.ts  (or seed:foundation-agents)
 *   - npx tsx scripts/seed-network-agents.ts     (or seed:network-agents)
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// ─── Agent ID registry ────────────────────────────────────────────────────────
// Mirrors the fixed IDs in seed-foundation-agents.ts and seed-network-agents.ts.

const FA = {
  identity:    '00000000-fa00-0000-0000-000000000001',
  reputation:  '00000000-fa00-0000-0000-000000000002',
  dispute:     '00000000-fa00-0000-0000-000000000003',
  intent:      '00000000-fa00-0000-0000-000000000004',
} as const;

const NA = {
  dataFetch:   '00000000-da00-0000-0000-000000000001',
  dataPipeline:'00000000-da00-0000-0000-000000000002',
  dataIndex:   '00000000-da00-0000-0000-000000000003',
  dataClean:   '00000000-da00-0000-0000-000000000004',
  sentiment:   '00000000-aa00-0000-0000-000000000001',
  summary:     '00000000-aa00-0000-0000-000000000002',
  classifier:  '00000000-aa00-0000-0000-000000000003',
  anomaly:     '00000000-aa00-0000-0000-000000000004',
  codeReview:  '00000000-ca00-0000-0000-000000000001',
  codeGen:     '00000000-ca00-0000-0000-000000000002',
  testGen:     '00000000-ca00-0000-0000-000000000003',
  factCheck:   '00000000-va00-0000-0000-000000000001',
  sourceVerify:'00000000-va00-0000-0000-000000000002',
  schemaValid: '00000000-va00-0000-0000-000000000003',
  uptime:      '00000000-ma00-0000-0000-000000000001',
  perf:        '00000000-ma00-0000-0000-000000000002',
} as const;

// ─── Interaction templates ────────────────────────────────────────────────────
// Each template expands into `count` transactions spread across `daysBack` days.
// status distribution: ~94% completed, ~4% failed, ~2% disputed (realistic).

interface Template {
  buyer: string;
  seller: string;
  amount: number;
  tasks: Array<{ description: string; params: Record<string, unknown>; output: Record<string, unknown> }>;
  status?: 'completed' | 'failed' | 'disputed';
}

// prettier-ignore
const TEMPLATES: Template[] = [
  // ── DataFetchAgent → DataPipelineAgent ─────────────────────────────────
  { buyer: NA.dataFetch, seller: NA.dataPipeline, amount: 0.50,
    tasks: [
      { description: 'Run ETL pipeline on news-feed dataset',
        params: { source: 'news-feed', format: 'json', records: 5000 },
        output: { records_processed: 5000, duration_ms: 1240, errors: 0 } },
      { description: 'Transform product-catalogue CSV to normalised JSON',
        params: { source: 'product-catalogue', format: 'csv', records: 12000 },
        output: { records_processed: 12000, duration_ms: 2810, errors: 3 } },
      { description: 'Pipeline: aggregate hourly sensor readings',
        params: { source: 'sensor-log', window: '1h', aggregation: 'avg' },
        output: { buckets: 24, duration_ms: 680, warnings: 0 } },
      { description: 'Pipeline: merge user-events from two streams',
        params: { streams: ['stream-a', 'stream-b'], dedup: true },
        output: { merged_records: 8500, duplicates_removed: 210, duration_ms: 1920 } },
      { description: 'Run financial-transactions ETL for report',
        params: { source: 'transactions-db', date_range: '7d' },
        output: { records_processed: 31200, duration_ms: 4400, errors: 0 } },
      { description: 'Pipeline: enrich webhook payloads with metadata',
        params: { source: 'webhook-queue', enrich_fields: ['geo', 'device'] },
        output: { enriched: 780, skipped: 12, duration_ms: 920 } },
      { description: 'Batch transform log-lines to structured events',
        params: { source: 'app-logs', format: 'syslog', records: 200000 },
        output: { records_processed: 200000, duration_ms: 8100, parse_errors: 22 } },
      { description: 'Pipeline: denormalise relational tables to flat JSON',
        params: { tables: ['orders', 'line_items', 'products'] },
        output: { rows_produced: 45000, duration_ms: 3300, errors: 0 } },
      { description: 'Real-time pipeline: streaming social mentions',
        params: { source: 'twitter-stream', filter: '#agentpay' },
        output: { events_ingested: 1430, dropped: 5, duration_ms: 60000 } },
      { description: 'Transform inventory snapshot to warehouse format',
        params: { source: 'inventory-api', warehouse: 'bigquery' },
        output: { rows_written: 9800, duration_ms: 2100, errors: 0 } },
      { description: 'Rebuild daily aggregation cube from raw events',
        params: { date: '2026-03-01', granularity: 'hour' },
        output: { cells_written: 288, duration_ms: 1700, errors: 0 } },
      { description: 'Sync CRM contacts to analytics warehouse',
        params: { source: 'crm', target: 'warehouse', incremental: true },
        output: { new_records: 340, updated: 88, duration_ms: 950 } },
    ],
  },
  // ── DataFetchAgent → SentimentAnalysisAgent ────────────────────────────
  { buyer: NA.dataFetch, seller: NA.sentiment, amount: 0.05,
    tasks: [
      { description: 'Sentiment analysis on product reviews batch',
        params: { documents: 200, language: 'en' },
        output: { positive: 142, neutral: 38, negative: 20, confidence_avg: 0.87 } },
      { description: 'Classify tone of support tickets',
        params: { documents: 150, categories: ['frustrated', 'neutral', 'satisfied'] },
        output: { frustrated: 31, neutral: 64, satisfied: 55, confidence_avg: 0.82 } },
      { description: 'Sentiment sweep on news articles about AgentPay',
        params: { documents: 45, source: 'news-api' },
        output: { positive: 28, neutral: 12, negative: 5, confidence_avg: 0.91 } },
      { description: 'Tone detection for customer email campaign',
        params: { documents: 500, granularity: 'sentence' },
        output: { positive: 312, neutral: 140, negative: 48, confidence_avg: 0.84 } },
      { description: 'Sentiment analysis on job-description corpus',
        params: { documents: 80, language: 'en' },
        output: { positive: 55, neutral: 22, negative: 3, confidence_avg: 0.89 } },
      { description: 'Analyse sentiment trends across 30-day tweet archive',
        params: { documents: 3200, window: '1d' },
        output: { trend: 'upward', peak_positive_day: '2026-02-18', confidence_avg: 0.79 } },
      { description: 'Sentiment tagging of user forum posts',
        params: { documents: 620, language: 'en' },
        output: { positive: 280, neutral: 245, negative: 95, confidence_avg: 0.81 } },
      { description: 'Multi-lingual sentiment on localised survey responses',
        params: { documents: 300, languages: ['en', 'es', 'de'] },
        output: { positive: 190, neutral: 75, negative: 35, confidence_avg: 0.77 } },
    ],
  },
  // ── DataPipelineAgent → ClassifierAgent ───────────────────────────────
  { buyer: NA.dataPipeline, seller: NA.classifier, amount: 0.03,
    tasks: [
      { description: 'Classify support tickets into product areas',
        params: { items: 800, taxonomy: 'product-areas' },
        output: { classified: 800, unclassified: 0, top_category: 'billing' } },
      { description: 'Label e-commerce transactions by category',
        params: { items: 5000, taxonomy: 'merchant-types' },
        output: { classified: 4988, unclassified: 12, top_category: 'saas' } },
      { description: 'Tag news articles by topic',
        params: { items: 400, taxonomy: 'news-topics' },
        output: { classified: 400, unclassified: 0, top_category: 'technology' } },
      { description: 'Classify agent service requests by intent',
        params: { items: 1200, taxonomy: 'intent-types' },
        output: { classified: 1195, unclassified: 5, top_category: 'data-fetch' } },
      { description: 'Label dataset rows with data-quality tier',
        params: { items: 10000, tiers: ['clean', 'noisy', 'corrupt'] },
        output: { clean: 8200, noisy: 1600, corrupt: 200 } },
      { description: 'Classify incoming webhook events by severity',
        params: { items: 2200, taxonomy: 'alert-severity' },
        output: { classified: 2198, unclassified: 2, top_category: 'low' } },
      { description: 'Tag user sessions by funnel stage',
        params: { items: 3400, taxonomy: 'funnel-stages' },
        output: { classified: 3400, unclassified: 0, top_category: 'activation' } },
      { description: 'Multi-label classification of research abstracts',
        params: { items: 180, taxonomy: 'research-domains', multi_label: true },
        output: { classified: 178, avg_labels_per_item: 2.3, unclassified: 2 } },
      { description: 'Classify contract clauses by type',
        params: { items: 650, taxonomy: 'legal-clause-types' },
        output: { classified: 648, unclassified: 2, top_category: 'liability' } },
      { description: 'Severity-label incident reports for triage',
        params: { items: 320, taxonomy: 'incident-severity' },
        output: { classified: 320, unclassified: 0, top_category: 'medium' } },
    ],
  },
  // ── DataFetchAgent → FactCheckAgent ───────────────────────────────────
  { buyer: NA.dataFetch, seller: NA.factCheck, amount: 0.25,
    tasks: [
      { description: 'Verify claims in market-research whitepaper',
        params: { claims: 12, source: 'whitepaper-q1-2026.pdf' },
        output: { verified: 10, unverified: 1, disputed: 1, verdict: 'mostly_accurate' } },
      { description: 'Fact-check product specification sheet',
        params: { claims: 8, source: 'product-spec-v2.doc' },
        output: { verified: 8, unverified: 0, disputed: 0, verdict: 'accurate' } },
      { description: 'Cross-check financial claims in investor deck',
        params: { claims: 20, source: 'investor-deck.pptx' },
        output: { verified: 17, unverified: 2, disputed: 1, verdict: 'mostly_accurate' } },
      { description: 'Verify quoted statistics in blog post',
        params: { claims: 6, source: 'blog-post-url' },
        output: { verified: 5, unverified: 1, disputed: 0, verdict: 'mostly_accurate' } },
      { description: 'Validate protocol description in technical doc',
        params: { claims: 15, source: 'protocol-spec-v3.md' },
        output: { verified: 15, unverified: 0, disputed: 0, verdict: 'accurate' } },
      { description: 'Check regulatory claims in compliance report',
        params: { claims: 9, source: 'compliance-report.pdf' },
        output: { verified: 8, unverified: 0, disputed: 1, verdict: 'mostly_accurate' } },
      { description: 'Fact-check competitor comparison matrix',
        params: { claims: 24, source: 'battlecard-2026.xlsx' },
        output: { verified: 19, unverified: 4, disputed: 1, verdict: 'partially_accurate' } },
      { description: 'Verify attribution claims in academic paper',
        params: { claims: 30, source: 'arxiv-paper.pdf' },
        output: { verified: 29, unverified: 1, disputed: 0, verdict: 'accurate' } },
    ],
  },
  // ── DataPipelineAgent → SchemaValidatorAgent ──────────────────────────
  { buyer: NA.dataPipeline, seller: NA.schemaValid, amount: 0.05,
    tasks: [
      { description: 'Validate API response payloads against OpenAPI spec',
        params: { payloads: 500, spec: 'openapi.yaml', strict: true },
        output: { valid: 497, invalid: 3, error_types: ['missing_field', 'type_mismatch'] } },
      { description: 'Schema-validate inbound webhook events',
        params: { payloads: 2400, schema: 'webhook-event-v2.json' },
        output: { valid: 2398, invalid: 2, error_types: ['extra_field'] } },
      { description: 'Check DB export against canonical data model',
        params: { rows: 15000, schema: 'data-model-v4.json' },
        output: { valid: 14990, invalid: 10, error_types: ['null_required_field'] } },
      { description: 'Validate ML feature vector schema before training',
        params: { rows: 80000, schema: 'feature-schema.json' },
        output: { valid: 80000, invalid: 0, error_types: [] } },
      { description: 'Assert GraphQL mutation payloads match schema',
        params: { payloads: 340, schema: 'schema.graphql' },
        output: { valid: 338, invalid: 2, error_types: ['enum_violation'] } },
      { description: 'Validate data-lake Parquet partitions',
        params: { partitions: 72, schema: 'parquet-schema.json' },
        output: { valid: 72, invalid: 0, error_types: [] } },
      { description: 'Verify SDK event schema in runtime telemetry',
        params: { events: 12000, schema: 'sdk-telemetry-v1.json' },
        output: { valid: 11994, invalid: 6, error_types: ['missing_field', 'type_mismatch'] } },
      { description: 'JSON-schema check on config file before deploy',
        params: { configs: 4, schema: 'deploy-config-schema.json' },
        output: { valid: 4, invalid: 0, error_types: [] } },
    ],
  },
  // ── CodeGenAgent → CodeReviewAgent ────────────────────────────────────
  { buyer: NA.codeGen, seller: NA.codeReview, amount: 1.00,
    tasks: [
      { description: 'Review generated payment-routing module',
        params: { files: 3, language: 'typescript', lines: 420 },
        output: { issues_critical: 0, issues_high: 1, issues_low: 4, approved: true } },
      { description: 'Review AI-generated CRUD endpoints',
        params: { files: 5, language: 'typescript', lines: 680 },
        output: { issues_critical: 0, issues_high: 0, issues_low: 7, approved: true } },
      { description: 'Review auto-generated Prisma migrations',
        params: { files: 2, language: 'sql', lines: 90 },
        output: { issues_critical: 0, issues_high: 1, issues_low: 2, approved: false,
                  comment: 'Missing index on foreign key' } },
      { description: 'Security audit on generated auth middleware',
        params: { files: 1, language: 'typescript', lines: 180, focus: 'security' },
        output: { issues_critical: 1, issues_high: 2, issues_low: 1, approved: false,
                  comment: 'JWT secret leaked to logs' } },
      { description: 'Review generated Solana program helpers',
        params: { files: 4, language: 'rust', lines: 560 },
        output: { issues_critical: 0, issues_high: 1, issues_low: 3, approved: true } },
      { description: 'Review code-gen output for escrow service',
        params: { files: 2, language: 'typescript', lines: 310 },
        output: { issues_critical: 0, issues_high: 0, issues_low: 2, approved: true } },
      { description: 'Review generated SDK client for REST API',
        params: { files: 8, language: 'typescript', lines: 1200 },
        output: { issues_critical: 0, issues_high: 3, issues_low: 8, approved: false,
                  comment: 'Error handling incomplete in 3 methods' } },
      { description: 'Review generated database access layer',
        params: { files: 6, language: 'typescript', lines: 750 },
        output: { issues_critical: 0, issues_high: 0, issues_low: 5, approved: true } },
      { description: 'Review generated event-dispatcher module',
        params: { files: 3, language: 'typescript', lines: 280 },
        output: { issues_critical: 0, issues_high: 1, issues_low: 1, approved: true } },
      { description: 'Review CLI scaffolding generated by CodeGenAgent',
        params: { files: 7, language: 'typescript', lines: 920 },
        output: { issues_critical: 0, issues_high: 0, issues_low: 6, approved: true } },
      { description: 'Review generated agent-capability declarations',
        params: { files: 2, language: 'typescript', lines: 160 },
        output: { issues_critical: 0, issues_high: 0, issues_low: 1, approved: true } },
      { description: 'Full codebase review after code-gen refactor',
        params: { files: 22, language: 'typescript', lines: 3100, scope: 'full' },
        output: { issues_critical: 1, issues_high: 4, issues_low: 12, approved: false,
                  comment: 'Architecture review required before merge' } },
    ],
  },
  // ── CodeGenAgent → TestGenAgent ───────────────────────────────────────
  { buyer: NA.codeGen, seller: NA.testGen, amount: 1.50,
    tasks: [
      { description: 'Generate unit tests for payment routing module',
        params: { module: 'payment-routing', coverage_target: 0.85 },
        output: { tests_generated: 32, coverage_achieved: 0.87, passing: 32 } },
      { description: 'Generate integration tests for escrow API',
        params: { module: 'escrow-api', coverage_target: 0.80 },
        output: { tests_generated: 18, coverage_achieved: 0.83, passing: 18 } },
      { description: 'Generate tests for generated auth middleware',
        params: { module: 'auth-middleware', coverage_target: 0.90 },
        output: { tests_generated: 24, coverage_achieved: 0.92, passing: 23, failing: 1 } },
      { description: 'Generate regression tests from bug-report suite',
        params: { module: 'agent-hire-flow', bugs: 8 },
        output: { tests_generated: 8, coverage_achieved: 0.76, passing: 8 } },
      { description: 'Generate property-based tests for data pipeline',
        params: { module: 'data-pipeline', style: 'property-based' },
        output: { tests_generated: 15, edge_cases: 60, passing: 15 } },
      { description: 'Generate E2E tests for agent discovery flow',
        params: { module: 'discovery-flow', style: 'e2e' },
        output: { tests_generated: 10, coverage_achieved: 0.72, passing: 10 } },
      { description: 'Generate snapshot tests for API response shapes',
        params: { module: 'agents-routes', endpoints: 6, style: 'snapshot' },
        output: { snapshots_created: 6, passing: 6 } },
      { description: 'Generate mutation tests for fee calculation',
        params: { module: 'fee-service', style: 'mutation' },
        output: { tests_generated: 12, mutation_score: 0.88, passing: 12 } },
      { description: 'Generate load tests for leaderboard endpoint',
        params: { module: 'leaderboard', rps: 100, style: 'load' },
        output: { tests_generated: 5, p99_ms: 120, errors_at_100rps: 0 } },
      { description: 'Generate contract tests for foundation-agent APIs',
        params: { module: 'foundation-agents', style: 'contract' },
        output: { contracts: 4, passing: 4 } },
    ],
  },
  // ── SentimentAnalysisAgent → SummaryAgent ─────────────────────────────
  { buyer: NA.sentiment, seller: NA.summary, amount: 0.15,
    tasks: [
      { description: 'Summarise sentiment analysis run on product reviews',
        params: { documents: 200, format: 'executive_brief' },
        output: { summary_words: 320, key_themes: ['reliability', 'pricing', 'support'], sentiment_trend: 'positive' } },
      { description: 'Executive summary of support-ticket sentiment sweep',
        params: { documents: 150, format: 'bullet_points' },
        output: { summary_words: 180, key_themes: ['wait_times', 'resolution_quality'], recommendations: 2 } },
      { description: 'Monthly sentiment digest for stakeholder report',
        params: { documents: 3200, format: 'monthly_digest' },
        output: { summary_words: 650, charts_described: 3, period: '2026-02' } },
      { description: 'Summarise multi-lingual survey sentiment results',
        params: { documents: 300, format: 'comparative_brief' },
        output: { summary_words: 420, languages_covered: 3, top_insight: 'German users most satisfied' } },
      { description: 'Condense forum-post sentiment into weekly digest',
        params: { documents: 620, format: 'weekly_digest' },
        output: { summary_words: 280, key_threads: 5, sentiment_swing: '+4% positive' } },
      { description: 'Abstract sentiment findings from news monitoring',
        params: { documents: 45, format: 'press_summary' },
        output: { summary_words: 200, coverage_sentiment: 'mostly_positive', notable_negatives: 1 } },
      { description: 'Summarise tone analysis of email campaign',
        params: { documents: 500, format: 'campaign_brief' },
        output: { summary_words: 360, open_rate_correlation: 0.72, recommended_tone: 'warm' } },
      { description: 'Write high-level NPS commentary from raw sentiment scores',
        params: { documents: 80, format: 'nps_commentary' },
        output: { summary_words: 240, nps_implied: 42, detractor_themes: ['onboarding', 'docs'] } },
    ],
  },
  // ── DataFetchAgent → SourceVerifierAgent ──────────────────────────────
  { buyer: NA.dataFetch, seller: NA.sourceVerify, amount: 0.10,
    tasks: [
      { description: 'Verify credibility of 20 news sources',
        params: { sources: 20, depth: 'standard' },
        output: { credible: 18, questionable: 2, blocked: 0, avg_credibility_score: 0.84 } },
      { description: 'Assess data provenance of third-party research feeds',
        params: { sources: 8, depth: 'deep' },
        output: { credible: 7, questionable: 1, blocked: 0, avg_credibility_score: 0.91 } },
      { description: 'Check attribution chain for financial data sources',
        params: { sources: 12, depth: 'standard' },
        output: { credible: 11, questionable: 0, blocked: 1, avg_credibility_score: 0.88 } },
      { description: 'Verify API source reliability for pipeline inputs',
        params: { sources: 6, checks: ['uptime', 'schema_stability', 'licensing'] },
        output: { credible: 6, questionable: 0, blocked: 0, avg_credibility_score: 0.95 } },
      { description: 'Vet social-media data sources for brand monitoring',
        params: { sources: 30, depth: 'standard' },
        output: { credible: 24, questionable: 5, blocked: 1, avg_credibility_score: 0.76 } },
      { description: 'Verify academic citation sources in research brief',
        params: { sources: 15, depth: 'deep' },
        output: { credible: 15, questionable: 0, blocked: 0, avg_credibility_score: 0.97 } },
      { description: 'Check regulatory data sources for compliance pipeline',
        params: { sources: 5, depth: 'deep' },
        output: { credible: 5, questionable: 0, blocked: 0, avg_credibility_score: 0.99 } },
      { description: 'Assess market-data vendor credibility',
        params: { sources: 10, depth: 'standard', criteria: ['accuracy', 'latency', 'coverage'] },
        output: { credible: 9, questionable: 1, blocked: 0, avg_credibility_score: 0.89 } },
    ],
  },
  // ── AnomalyDetectorAgent → UptimeMonitorAgent ─────────────────────────
  { buyer: NA.anomaly, seller: NA.uptime, amount: 0.01,
    tasks: [
      { description: 'Continuous uptime check on data-ingest endpoints',
        params: { endpoints: 8, interval_s: 60 },
        output: { checks_performed: 1440, uptime_pct: 99.9, incidents: 1 } },
      { description: 'Health-check all anomaly-detector dependencies',
        params: { endpoints: 5, interval_s: 30 },
        output: { checks_performed: 2880, uptime_pct: 100.0, incidents: 0 } },
      { description: 'Monitor alert-sink endpoints during anomaly surge',
        params: { endpoints: 3, interval_s: 10 },
        output: { checks_performed: 8640, uptime_pct: 99.7, incidents: 2 } },
      { description: 'End-of-day availability report for pipeline dependencies',
        params: { endpoints: 6, report_period: '24h' },
        output: { avg_uptime_pct: 99.8, slowest_endpoint: 'sink-b', p95_ms: 240 } },
      { description: 'Alert-channel endpoint health verification',
        params: { endpoints: 4, interval_s: 60 },
        output: { checks_performed: 1440, uptime_pct: 98.6, incidents: 3 } },
      { description: 'Uptime baseline for new anomaly-detection deployment',
        params: { endpoints: 7, interval_s: 60, baseline_period: '48h' },
        output: { checks_performed: 20160, uptime_pct: 99.95, incidents: 0 } },
    ],
  },
  // ── Various → PerformanceProfilerAgent ───────────────────────────────
  { buyer: NA.dataPipeline, seller: NA.perf, amount: 0.50,
    tasks: [
      { description: 'Profile pipeline throughput under 10× load',
        params: { target: 'data-pipeline', rps: 1000, duration_s: 60 },
        output: { avg_rps: 987, p99_ms: 340, cpu_pct: 72, mem_mb: 1200 } },
      { description: 'Measure cold-start latency for DataPipelineAgent',
        params: { target: 'data-pipeline', runs: 50, type: 'cold_start' },
        output: { avg_ms: 820, p95_ms: 1100, p99_ms: 1380 } },
    ] },
  { buyer: NA.codeReview, seller: NA.perf, amount: 0.50,
    tasks: [
      { description: 'Profile CodeReviewAgent response time on large diffs',
        params: { target: 'code-review', diff_lines: 5000, runs: 20 },
        output: { avg_ms: 2800, p95_ms: 3900, p99_ms: 4500, throughput_per_min: 12 } },
    ] },
  { buyer: NA.sentiment, seller: NA.perf, amount: 0.50,
    tasks: [
      { description: 'Throughput test — batch sentiment at 500 docs/request',
        params: { target: 'sentiment', batch_size: 500, runs: 10 },
        output: { avg_ms: 1450, p99_ms: 2100, docs_per_sec: 344 } },
      { description: 'Latency profile for single-document sentiment endpoint',
        params: { target: 'sentiment', runs: 100, doc_length: 'short' },
        output: { avg_ms: 80, p99_ms: 140, throughput_per_min: 700 } },
    ] },
  { buyer: NA.dataFetch, seller: NA.perf, amount: 0.50,
    tasks: [
      { description: 'Profile DataFetchAgent under parallel request load',
        params: { target: 'data-fetch', concurrency: 50, duration_s: 30 },
        output: { avg_rps: 48, p99_ms: 190, error_rate: 0.001 } },
      { description: 'Measure DataFetchAgent memory footprint on 100 MB payload',
        params: { target: 'data-fetch', payload_mb: 100, runs: 5 },
        output: { peak_mem_mb: 480, avg_processing_ms: 1900, gc_pauses: 2 } },
    ] },
  // ── Various → ReputationOracleAgent ──────────────────────────────────
  { buyer: NA.codeReview, seller: FA.reputation, amount: 3.00,
    tasks: [
      { description: 'Standard reputation query before accepting hire',
        params: { queried_agent: NA.codeGen, depth: 'standard' },
        output: { trust_score: 76, risk_level: 'LOW', success_rate: 0.97 } },
      { description: 'Batch reputation lookup for 5 candidate agents',
        params: { queried_agents: 5, depth: 'standard' },
        output: { avg_trust_score: 74, all_low_risk: true } },
    ] },
  { buyer: NA.factCheck, seller: FA.reputation, amount: 3.00,
    tasks: [
      { description: 'Reputation check on DataFetchAgent before workflow',
        params: { queried_agent: NA.dataFetch, depth: 'standard' },
        output: { trust_score: 75, risk_level: 'LOW', success_rate: 0.96 } },
      { description: 'Comprehensive reputation report on SentimentAnalysisAgent',
        params: { queried_agent: NA.sentiment, depth: 'comprehensive' },
        output: { trust_score: 80, risk_level: 'LOW', dispute_rate: 0.01, tasks_completed: 450 } },
    ] },
  { buyer: NA.dataPipeline, seller: FA.reputation, amount: 1.00,
    tasks: [
      { description: 'Basic trust score check before hiring ClassifierAgent',
        params: { queried_agent: NA.classifier, depth: 'basic' },
        output: { trust_score: 74, risk_level: 'LOW' } },
      { description: 'Trust check on new CodeGenAgent candidate',
        params: { queried_agent: NA.codeGen, depth: 'basic' },
        output: { trust_score: 76, risk_level: 'LOW' } },
      { description: 'Pre-hire reputation check on DataCleanAgent',
        params: { queried_agent: NA.dataClean, depth: 'basic' },
        output: { trust_score: 68, risk_level: 'LOW' } },
      { description: 'Standard query on SchemaValidatorAgent',
        params: { queried_agent: NA.schemaValid, depth: 'standard' },
        output: { trust_score: 79, risk_level: 'LOW', success_rate: 0.98 } },
    ] },
  { buyer: NA.anomaly, seller: FA.reputation, amount: 1.00,
    tasks: [
      { description: 'Trust lookup on UptimeMonitorAgent for SLA review',
        params: { queried_agent: NA.uptime, depth: 'basic' },
        output: { trust_score: 85, risk_level: 'LOW' } },
      { description: 'Batch reputation check on monitoring tier agents',
        params: { queried_agents: 2, depth: 'standard' },
        output: { avg_trust_score: 80, all_low_risk: true } },
    ] },
  // ── Various → IdentityVerifierAgent ──────────────────────────────────
  { buyer: NA.codeGen, seller: FA.identity, amount: 10.00,
    tasks: [
      { description: 'Identity verification before first deployment',
        params: { environment: 'production', depth: 'basic' },
        output: { verified: true, trust_level: 'operator', credential_id: 'cred_cg_001' } },
      { description: 'Cross-platform identity link for SDK publishing',
        params: { platforms: ['github', 'npm'], depth: 'advanced_linking' },
        output: { verified: true, links_created: 2, credential_id: 'cred_cg_002' } },
    ] },
  { buyer: NA.dataFetch, seller: FA.identity, amount: 10.00,
    tasks: [
      { description: 'Verify DataFetchAgent ownership before network listing',
        params: { environment: 'production', depth: 'basic' },
        output: { verified: true, trust_level: 'operator', credential_id: 'cred_df_001' } },
      { description: 'Re-verify identity after endpoint change',
        params: { environment: 'production', reason: 'endpoint_migration' },
        output: { verified: true, trust_level: 'operator', credential_id: 'cred_df_002' } },
    ] },
  // ── Various → IntentCoordinatorAgent ─────────────────────────────────
  { buyer: NA.dataFetch, seller: FA.intent, amount: 1.00,
    tasks: [
      { description: 'Route payment to DataPipelineAgent via Stripe',
        params: { amount: 0.50, currency: 'USD', protocol: 'stripe' },
        output: { routed: true, protocol_used: 'stripe', tx_id: 'seed_coordinated_001' } },
      { description: 'Route USDC payment to SentimentAnalysisAgent',
        params: { amount: 0.05, currency: 'USDC', protocol: 'x402' },
        output: { routed: true, protocol_used: 'x402', tx_id: 'seed_coordinated_002' } },
    ] },
  { buyer: NA.codeGen, seller: FA.intent, amount: 1.00,
    tasks: [
      { description: 'Coordinate payment split between CodeReview + TestGen',
        params: { amount: 2.50, split: [{ agent: NA.codeReview, pct: 0.4 }, { agent: NA.testGen, pct: 0.6 }] },
        output: { routed: true, splits_executed: 2, protocol_used: 'stripe' } },
      { description: 'Route milestone payment on code-delivery completion',
        params: { amount: 2.00, currency: 'USDC', protocol: 'x402', milestone: 'code_delivered' },
        output: { routed: true, protocol_used: 'x402', tx_id: 'seed_coordinated_003' } },
    ] },
];

// ─── Status overrides (a handful of realistic non-happy-path entries) ─────────
// Index positions within the flattened transaction list to mark as failed/disputed.
// We set 5 failed + 2 disputed from the 120 total (~5.8% failure rate).
const FAILED_INDICES  = new Set([7, 22, 55, 78, 103]);
const DISPUTED_INDICES = new Set([14, 67]);

// ─── Build flat transaction list ──────────────────────────────────────────────

interface TxRecord {
  id: string;
  buyerAgentId: string;
  sellerAgentId: string;
  task: object;
  amount: number;
  status: string;
  output: object | null;
  daysAgo: number;
}

function buildTransactions(): TxRecord[] {
  const txs: TxRecord[] = [];
  let idx = 0;

  for (const tpl of TEMPLATES) {
    for (const taskDef of tpl.tasks) {
      idx += 1;
      const statusOverride =
        FAILED_INDICES.has(idx)   ? 'failed'   :
        DISPUTED_INDICES.has(idx) ? 'disputed' :
        'completed';

      // Spread creation times over the past 30 days, oldest first.
      // All timestamps are at least 1 day in the past.
      const daysAgo = Math.round(30 - ((idx - 1) / 119) * 29) + 1;

      txs.push({
        id: `seed_tx_${String(idx).padStart(3, '0')}`,
        buyerAgentId: tpl.buyer,
        sellerAgentId: tpl.seller,
        task: { description: taskDef.description, params: taskDef.params },
        amount: tpl.amount,
        status: statusOverride,
        output: statusOverride === 'completed' ? taskDef.output : null,
        daysAgo,
      });
    }
  }

  return txs;
}

// ─── Reputation aggregation ───────────────────────────────────────────────────

interface RepStats {
  total: number;
  completed: number;
  disputed: number;
  totalAmount: number;
  avgResponseMs: number;
}

function buildReputationMap(txs: TxRecord[]): Map<string, RepStats> {
  const map = new Map<string, RepStats>();

  for (const tx of txs) {
    const sid = tx.sellerAgentId;
    if (!map.has(sid)) {
      map.set(sid, { total: 0, completed: 0, disputed: 0, totalAmount: 0, avgResponseMs: 0 });
    }
    const s = map.get(sid)!;
    s.total += 1;
    if (tx.status === 'completed') s.completed += 1;
    if (tx.status === 'disputed')  s.disputed  += 1;
    s.totalAmount += tx.amount;
    // Realistic response-time estimate based on amount tier.
    s.avgResponseMs += tx.amount < 0.10 ? 120 :
                       tx.amount < 0.50 ? 450 :
                       tx.amount < 1.00 ? 900 : 2200;
  }

  for (const s of map.values()) {
    s.avgResponseMs = Math.round(s.avgResponseMs / s.total);
  }

  return map;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const txs = buildTransactions();
  console.log(`[seed-interactions] Starting — ${txs.length} transactions to seed...\n`);

  let created = 0;
  let updated = 0;

  for (const tx of txs) {
    const createdAt = new Date(Date.now() - tx.daysAgo * 24 * 60 * 60 * 1000);

    // Upsert the transaction.
    const result = await (prisma as any).agentTransaction.upsert({
      where: { id: tx.id },
      create: {
        id: tx.id,
        buyerAgentId: tx.buyerAgentId,
        sellerAgentId: tx.sellerAgentId,
        task: tx.task,
        amount: tx.amount,
        status: tx.status,
        output: tx.output,
        escrowId: `seed_escrow_${tx.id.slice(8)}`,
        createdAt,
      },
      update: {
        status: tx.status,
        output: tx.output,
      },
    });

    // Upsert the escrow record.
    await (prisma as any).agentEscrow.upsert({
      where: { id: `seed_escrow_${tx.id.slice(8)}` },
      create: {
        id: `seed_escrow_${tx.id.slice(8)}`,
        transactionId: tx.id,
        amount: tx.amount,
        status: tx.status === 'completed' ? 'released' :
                tx.status === 'failed'    ? 'refunded' :
                'disputed',
        createdAt,
      },
      update: {
        status: tx.status === 'completed' ? 'released' :
                tx.status === 'failed'    ? 'refunded' :
                'disputed',
      },
    });

    const isNew = result.createdAt.getTime() === createdAt.getTime();
    if (isNew) created++; else updated++;
  }

  console.log(`[✓] Transactions: ${created} created, ${updated} updated\n`);

  // ── Upsert reputation records ──────────────────────────────────────────
  const repMap = buildReputationMap(txs);
  let repUpserted = 0;

  for (const [agentId, stats] of repMap) {
    const successRate = stats.total > 0 ? stats.completed / stats.total : 1.0;
    const disputeRate = stats.total > 0 ? stats.disputed / stats.total  : 0.0;
    // Rating: baseline 5.0 adjusted down by dispute/failure pressure.
    const rating = Math.max(1.0, Math.min(5.0,
      5.0 - disputeRate * 2.0 - (1.0 - successRate) * 1.5,
    ));

    await (prisma as any).agentReputation.upsert({
      where: { agentId },
      create: {
        agentId,
        successRate,
        disputeRate,
        avgResponseTime: stats.avgResponseMs,
        rating: parseFloat(rating.toFixed(2)),
        totalTx: stats.total,
      },
      update: {
        successRate,
        disputeRate,
        avgResponseTime: stats.avgResponseMs,
        rating: parseFloat(rating.toFixed(2)),
        totalTx: stats.total,
      },
    });

    repUpserted += 1;
  }

  console.log(`[✓] AgentReputation records: ${repUpserted} upserted\n`);

  // ── Summary ───────────────────────────────────────────────────────────
  const statusCounts = txs.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log('[seed-interactions] Done.\n');
  console.log('Transaction status breakdown:');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`\nTotal: ${txs.length} transactions across ${repMap.size} seller agents`);
  console.log('\nNext steps:');
  console.log('  - Activity feed:   GET /api/agents/feed');
  console.log('  - Leaderboard:     GET /api/agents/leaderboard');
  console.log('  - Discovery:       GET /api/agents/discover');
}

main()
  .catch((e) => {
    console.error('[seed-interactions] Error:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
