// Shared demo data for the Founding Era seeded demo (read-only fixtures)
// Keep this file lightweight and safe: purely static sample content for UI display.

export const DEMO_AGENT_NAMES = [
  'TravelAgent',
  'FlightAgent',
  'TrustOracle',
  'SettlementGuardian',
  'AgentPassport',
  'NetworkObserver',
];

export const SAMPLE_PASSPORTS = [
  {
    id: 'agent:travel:001',
    name: 'TravelAgent',
    trust: 96,
    grade: 'A',
    reliability: 99,
    txCount: 1824,
    volume: 124987.42,
    recent: ['Escrow release · $420.00', 'Passport attested by TrustOracle', 'Resolved dispute #721'],
  },
  {
    id: 'agent:flight:007',
    name: 'FlightAgent',
    trust: 92,
    grade: 'A-',
    reliability: 97,
    txCount: 934,
    volume: 68924.5,
    recent: ['Settlement received · $420.00', 'Verified ticket issuance', 'Endorsement: SettlementGuardian'],
  },
];

export const CONSTITUTIONAL_AGENTS = [
  { id: 'trust', short: 'TO', name: 'TrustOracle', role: 'Reputation and attestations', description: 'Provides cryptographic attestations and maintains reputation scores for operators.' },
  { id: 'settle', short: 'SG', name: 'SettlementGuardian', role: 'Escrow and settlement', description: 'Holds funds in trust and executes settlement when conditions are met.' },
  { id: 'id', short: 'IV', name: 'AgentPassport', role: 'Operator identity', description: 'Verifies operator identities and issues AgentPassports (portable identity).' },
  { id: 'observer', short: 'NO', name: 'NetworkObserver', role: 'Routing and monitoring', description: 'Observes network health, routing, and ensures liveness across the exchange.' },
];

// Canonical founding exchange events (chronological recent-first order)
export const DEMO_SEED_EVENTS = [
  {
    id: 'TX-FOUND-0001',
    kind: 'Transactions',
    title: 'Booking Intent Received',
    detail: 'Human intent submitted — TravelAgent accepted intent and requested options from FlightAgent.',
    txId: 'TX-FOUND-0001',
    agents: ['Human','TravelAgent','FlightAgent'],
    value: 420.0,
    trust: 'Verified',
    latencyMs: 112,
    at: Date.now() - 18_000,
  },
  {
    id: 'EVT-FOUND-0002',
    kind: 'Trust verification',
    title: 'TrustOracle',
    detail: 'TrustOracle completed standing checks for TravelAgent and FlightAgent.',
    agents: ['TrustOracle','TravelAgent','FlightAgent'],
    at: Date.now() - 12_000,
  },
  {
    id: 'EVT-FOUND-0003',
    kind: 'Escrow lifecycle',
    title: 'SettlementGuardian opened escrow',
    detail: 'SettlementGuardian opened a controlled escrow for TX-FOUND-0001.',
    txId: 'TX-FOUND-0001',
    agents: ['SettlementGuardian','TravelAgent','FlightAgent'],
    value: 420.0,
    at: Date.now() - 9_000,
  },
  {
    id: 'EVT-FOUND-0004',
    kind: 'Identity attestations',
    title: 'AgentPassport attestation',
    detail: 'AgentPassport recorded an update to TravelAgent standing after settlement.',
    agents: ['AgentPassport','TravelAgent'],
    at: Date.now() - 6_000,
  },
  {
    id: 'EVT-FOUND-0005',
    kind: 'Constitutional agent actions',
    title: 'NetworkObserver liveness ping',
    detail: 'NetworkObserver recorded exchange liveness and routing health.',
    agents: ['NetworkObserver'],
    at: Date.now() - 2_000,
  },
];

export const FOUNDING_ECONOMIC_AGENTS = [
  { id: 'travel', name: 'TravelAgent', desc: 'Coordinates human travel intents and routes them to specialized operators (e.g., FlightAgent).' },
  { id: 'flight', name: 'FlightAgent', desc: 'Executes bookings and issues tickets; canonical execution agent for travel flows.' },
];

export function getSeedEvents() {
  // return a shallow copy so pages can mutate presentation without altering source
  return DEMO_SEED_EVENTS.map((e) => ({ ...e }));
}

export function getCanonicalFlowTrace() {
  const now = Date.now();
  // ordered chronological trace of the canonical founding flow
  const trace = [
    {
      id: `TRACE-${now}-01`,
      kind: 'Transactions',
      title: 'Human intent submitted',
      detail: 'A human submitted a booking intent captured by TravelAgent.',
      agents: ['Human','TravelAgent'],
      at: now - 20000,
    },
    {
      id: `TRACE-${now}-02`,
      kind: 'Transactions',
      title: 'TravelAgent intent parsing',
      detail: 'TravelAgent parsed intent and requested flight options from FlightAgent.',
      agents: ['TravelAgent','FlightAgent'],
      at: now - 17000,
    },
    {
      id: `TRACE-${now}-03`,
      kind: 'Transactions',
      title: 'FlightAgent returned option',
      detail: 'FlightAgent returned a canonical flight option to TravelAgent.',
      agents: ['FlightAgent','TravelAgent'],
      at: now - 15000,
    },
    {
      id: `TRACE-${now}-04`,
      kind: 'Trust verification',
      title: 'TrustOracle evaluation',
      detail: 'TrustOracle evaluated counterparty standing for TravelAgent and FlightAgent.',
      agents: ['TrustOracle','TravelAgent','FlightAgent'],
      at: now - 12000,
    },
    {
      id: `TRACE-${now}-05`,
      kind: 'Escrow lifecycle',
      title: 'SettlementGuardian opened escrow',
      detail: 'SettlementGuardian opened a controlled escrow for the booking.',
      agents: ['SettlementGuardian','TravelAgent','FlightAgent'],
      at: now - 9000,
    },
    {
      id: `TRACE-${now}-06`,
      kind: 'Escrow lifecycle',
      title: 'SettlementGuardian released escrow',
      detail: 'SettlementGuardian released escrow after successful execution.',
      agents: ['SettlementGuardian','TravelAgent','FlightAgent'],
      at: now - 6000,
    },
    {
      id: `TRACE-${now}-07`,
      kind: 'Identity attestations',
      title: 'AgentPassport update',
      detail: 'AgentPassport updated TravelAgent standing and recorded the outcome.',
      agents: ['AgentPassport','TravelAgent'],
      at: now - 4000,
    },
    {
      id: `TRACE-${now}-08`,
      kind: 'Constitutional agent actions',
      title: 'NetworkObserver liveness record',
      detail: 'NetworkObserver recorded exchange liveness after settlement.',
      agents: ['NetworkObserver'],
      at: now - 2000,
    },
  ];

  return trace.map((e) => ({ ...e }));
}

export default {
  DEMO_AGENT_NAMES,
  SAMPLE_PASSPORTS,
  CONSTITUTIONAL_AGENTS,
  DEMO_SEED_EVENTS,
  getSeedEvents,
  getCanonicalFlowTrace,
  FOUNDING_ECONOMIC_AGENTS,
};
