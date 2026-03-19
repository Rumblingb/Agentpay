/**
 * Seed specialist agents into agent_identities.
 *
 * These are the platform-operated specialist agents that the Bro concierge
 * will discover and hire for real bookings. They are seeded once and safe
 * to re-run (upsert on agent_id).
 *
 * Usage:
 *   npx tsx scripts/seed-specialist-agents.ts
 *
 * Requires DATABASE_URL in .env
 */

import postgres from 'postgres';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[seed] DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: 'require' });

const SPECIALIST_AGENTS = [
  {
    agent_id:    'agt_system_rail_01',
    owner_email: 'agents@agentpay.so',
    kyc_status:  'programmatic',
    verified:    true,
    metadata: {
      name:           'TrainAgent',
      category:       'rail',
      description:    'Books UK rail journeys via National Rail. Handles single tickets, returns, railcard discounts, and Eurostar. Real-time schedule data via Realtime Trains API.',
      capabilities:   ['book_train', 'uk_rail', 'eurostar', 'railcard', 'seat_reservation'],
      pricePerTaskUsd: 1.50,
      agentRankScore:  850,
      webhookUrl:     null, // Managed in-process by concierge auto-complete
      operator:       'AgentPay Platform',
      tier:           'standard',
    },
  },
  {
    agent_id:    'agt_system_accommodation_01',
    owner_email: 'agents@agentpay.so',
    kyc_status:  'programmatic',
    verified:    true,
    metadata: {
      name:           'HotelAgent',
      category:       'accommodation',
      description:    'Finds and books hotels, B&Bs, and serviced apartments. Covers UK, Europe, and major global cities. Handles budget to luxury tiers.',
      capabilities:   ['book_hotel', 'accommodation', 'serviced_apartment', 'uk_hotels', 'europe_hotels'],
      pricePerTaskUsd: 2.00,
      agentRankScore:  820,
      webhookUrl:     null,
      operator:       'AgentPay Platform',
      tier:           'standard',
    },
  },
  {
    agent_id:    'agt_system_transport_01',
    owner_email: 'agents@agentpay.so',
    kyc_status:  'programmatic',
    verified:    true,
    metadata: {
      name:           'TaxiAgent',
      category:       'transport',
      description:    'Books pre-booked taxis and private hire vehicles for transfers. Covers all major UK airports and station pickups. Standard and exec vehicles.',
      capabilities:   ['book_taxi', 'private_hire', 'airport_transfer', 'station_pickup'],
      pricePerTaskUsd: 1.00,
      agentRankScore:  800,
      webhookUrl:     null,
      operator:       'AgentPay Platform',
      tier:           'standard',
    },
  },
  {
    agent_id:    'agt_system_flight_01',
    owner_email: 'agents@agentpay.so',
    kyc_status:  'programmatic',
    verified:    true,
    metadata: {
      name:           'FlightAgent',
      category:       'flight',
      description:    'Searches and presents flight options across all major airlines. Domestic UK, European short-haul, and long-haul international. Returns 3 options.',
      capabilities:   ['search_flights', 'flight_booking', 'uk_domestic', 'european_flights', 'international'],
      pricePerTaskUsd: 3.00,
      agentRankScore:  830,
      webhookUrl:     null,
      operator:       'AgentPay Platform',
      tier:           'standard',
    },
  },
  {
    agent_id:    'agt_system_research_01',
    owner_email: 'agents@agentpay.so',
    kyc_status:  'programmatic',
    verified:    true,
    metadata: {
      name:           'ResearchAgent',
      category:       'research',
      description:    'Researches venues, opening hours, directions, event info, and local knowledge to support booking decisions.',
      capabilities:   ['research', 'venue_info', 'local_knowledge', 'event_info', 'price_comparison'],
      pricePerTaskUsd: 0.50,
      agentRankScore:  780,
      webhookUrl:     null,
      operator:       'AgentPay Platform',
      tier:           'standard',
    },
  },
];

async function main() {
  console.log('[seed-specialist-agents] Seeding specialist agents into agent_identities...\n');

  // Ensure agentrank_scores table exists — will silently skip if already there
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS agentrank_scores (
        agent_id           TEXT        PRIMARY KEY,
        score              INTEGER     NOT NULL DEFAULT 500,
        grade              TEXT        NOT NULL DEFAULT 'C',
        transaction_volume INTEGER     NOT NULL DEFAULT 0,
        dispute_rate       DECIMAL     NOT NULL DEFAULT 0,
        service_delivery   DECIMAL     NOT NULL DEFAULT 1.0,
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  } catch { /* table already exists */ }

  for (const agent of SPECIALIST_AGENTS) {
    // Hash a stable dummy key for the agent (not used for auth — concierge uses hirerId)
    const agentKeyHash = crypto.createHash('sha256').update(`${agent.agent_id}_platform_key`).digest('hex');
    const metaWithHash = { ...agent.metadata, agentKeyHash };

    await sql`
      INSERT INTO agent_identities
        (agent_id, owner_email, kyc_status, verified, metadata)
      VALUES
        (${agent.agent_id},
         ${agent.owner_email},
         ${agent.kyc_status},
         ${agent.verified},
         ${JSON.stringify(metaWithHash)}::jsonb)
      ON CONFLICT (agent_id) DO UPDATE SET
        metadata   = EXCLUDED.metadata,
        verified   = EXCLUDED.verified,
        kyc_status = EXCLUDED.kyc_status,
        updated_at = NOW()
    `;

    // Upsert AgentRank score
    await sql`
      INSERT INTO agentrank_scores (agent_id, score, grade, transaction_volume, dispute_rate, service_delivery)
      VALUES (
        ${agent.agent_id},
        ${agent.metadata.agentRankScore},
        ${scoreToGrade(agent.metadata.agentRankScore)},
        100,
        0.001,
        0.99
      )
      ON CONFLICT (agent_id) DO UPDATE SET
        score = EXCLUDED.score,
        grade = EXCLUDED.grade
    `.catch(() => { /* agentrank_scores may not exist yet */ });

    console.log(`[✓] ${agent.metadata.name} (${agent.agent_id})`);
    console.log(`    category: ${agent.metadata.category}`);
    console.log(`    price:    $${agent.metadata.pricePerTaskUsd} USDC/task`);
    console.log(`    score:    ${agent.metadata.agentRankScore} (${scoreToGrade(agent.metadata.agentRankScore)})`);
    console.log();
  }

  console.log('[seed-specialist-agents] Done.\n');
  console.log('Verify with:');
  console.log('  curl https://api.agentpay.so/api/marketplace/discover?category=rail');
  console.log('  curl https://api.agentpay.so/api/marketplace/discover?category=accommodation');
}

function scoreToGrade(score: number): string {
  if (score >= 950) return 'A+';
  if (score >= 900) return 'A';
  if (score >= 750) return 'B';
  if (score >= 600) return 'C';
  if (score >= 400) return 'D';
  return 'F';
}

main()
  .catch((e) => {
    console.error('[seed-specialist-agents] Error:', e.message ?? e);
    process.exit(1);
  })
  .finally(() => sql.end());
