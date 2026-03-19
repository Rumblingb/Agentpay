/**
 * Skill registry — specialist agent skill files.
 *
 * Each skill defines a Claude tool: what the agent can do, what it needs,
 * and what it returns. Claude reads these and decides which to call.
 *
 * Adding a new specialist = adding a new SkillDefinition here.
 * No changes to the concierge route required.
 */

export interface SkillDefinition {
  /** Tool name for Claude (snake_case) */
  toolName: string;
  /** Agent category — used to find the right agent in the marketplace */
  category: string;
  /** Human-readable name */
  displayName: string;
  /** Description shown to Claude */
  description: string;
  /** JSON Schema for the tool's input */
  inputSchema: Record<string, unknown>;
  /** Markdown skill file — Claude reads this for full context */
  skillDoc: string;
  /** TravelProfile fields this agent is permitted to receive — minimum necessary only */
  requiredProfileFields: string[];
}

// ── Train booking ────────────────────────────────────────────────────────────

const trainSkill: SkillDefinition = {
  toolName: 'book_train',
  category: 'rail',
  displayName: 'TrainAgent',
  description: 'Search and book UK and European train journeys. Handles single tickets, returns, railcard discounts, and seat reservations.',
  requiredProfileFields: ['legalName', 'email', 'phone', 'seatPreference', 'classPreference', 'railcardNumber'],
  inputSchema: {
    type: 'object',
    required: ['origin', 'destination'],
    properties: {
      origin:          { type: 'string', description: 'Departure station or city (e.g. "Derby", "London St Pancras")' },
      destination:     { type: 'string', description: 'Arrival station or city' },
      date:            { type: 'string', description: 'Travel date — ISO (YYYY-MM-DD) or natural language ("tomorrow", "Thursday")' },
      time_preference: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'any'], description: 'Preferred departure time window' },
      class_pref:      { type: 'string', enum: ['standard', 'first'], description: 'Ticket class' },
      return_date:     { type: 'string', description: 'Return date for a return ticket — omit for single' },
    },
  },
  skillDoc: `# TrainAgent
Searches and books UK rail journeys including National Rail, Eurostar, and cross-border European services.

## Handles
- Single and return tickets
- Advance, Off-Peak, and Anytime fares
- Railcard discounts (automatically applied from passenger profile)
- Seat reservations where available
- Eurostar London–Paris/Brussels/Amsterdam

## Cannot handle
- Rail holidays or packages
- International rail beyond Europe
- Group bookings over 9 passengers
- Rail + hotel bundles (use TrainAgent + HotelAgent separately)

## Output
Returns booking reference, departure time, platform, operator, price, and confirmation email status.`,
};

// ── Hotel booking ────────────────────────────────────────────────────────────

const hotelSkill: SkillDefinition = {
  toolName: 'book_hotel',
  category: 'accommodation',
  displayName: 'HotelAgent',
  description: 'Find and book hotels, B&Bs, and serviced apartments. Covers UK, Europe, and major global cities.',
  requiredProfileFields: ['legalName', 'email', 'phone'],
  inputSchema: {
    type: 'object',
    required: ['location', 'check_in', 'check_out'],
    properties: {
      location:   { type: 'string', description: 'City, area, or address near the hotel' },
      check_in:   { type: 'string', description: 'Check-in date (ISO or natural language)' },
      check_out:  { type: 'string', description: 'Check-out date (ISO or natural language)' },
      budget_gbp: { type: 'number', description: 'Maximum budget per night in GBP' },
      guests:     { type: 'number', description: 'Number of guests (default 1)' },
      preference: { type: 'string', description: 'Preferences like "central", "near station", "quiet", "with breakfast"' },
    },
  },
  skillDoc: `# HotelAgent
Finds and books hotels, B&Bs, and serviced apartments worldwide.

## Handles
- Hotels, guesthouses, and serviced apartments
- Budget to luxury tiers
- UK, Europe, and major global cities
- Flexible and non-refundable rates

## Cannot handle
- Hostels or dormitory bookings
- Vacation rentals (Airbnb-style)
- Long-stay (30+ nights)
- Group blocks of 10+ rooms

## Output
Returns hotel name, address, booking reference, nightly rate, total cost, and check-in instructions.`,
};

// ── Taxi / ride booking ──────────────────────────────────────────────────────

const taxiSkill: SkillDefinition = {
  toolName: 'book_taxi',
  category: 'transport',
  displayName: 'TaxiAgent',
  description: 'Book taxis, Ubers, and pre-booked private hire vehicles for airport transfers and point-to-point journeys.',
  requiredProfileFields: ['legalName', 'phone'],
  inputSchema: {
    type: 'object',
    required: ['pickup', 'dropoff'],
    properties: {
      pickup:      { type: 'string', description: 'Pickup location — address, station, or airport code' },
      dropoff:     { type: 'string', description: 'Drop-off location' },
      pickup_time: { type: 'string', description: 'Pickup date and time (ISO or natural language)' },
      vehicle:     { type: 'string', enum: ['standard', 'exec', 'mpv', 'any'], description: 'Vehicle type preference' },
    },
  },
  skillDoc: `# TaxiAgent
Books pre-booked taxis and private hire vehicles for transfers and journeys.

## Handles
- Pre-booked taxis and minicabs
- Airport transfers (all major UK airports)
- Station pickups
- Executive and MPV vehicles

## Cannot handle
- On-demand rides without advance notice
- Courier or delivery services
- Coach or minibus hire

## Output
Returns vehicle type, driver details (on day of travel), pickup time confirmed, estimated journey time, and total price.`,
};

// ── Flight search ────────────────────────────────────────────────────────────

const flightSkill: SkillDefinition = {
  toolName: 'search_flights',
  category: 'flight',
  displayName: 'FlightAgent',
  description: 'Search flights and present options. Returns best available fares for the user to confirm.',
  requiredProfileFields: ['legalName', 'email', 'phone', 'dateOfBirth', 'nationality', 'documentType', 'documentNumber', 'documentExpiry'],
  inputSchema: {
    type: 'object',
    required: ['origin', 'destination', 'date'],
    properties: {
      origin:       { type: 'string', description: 'Departure airport or city (IATA code or name)' },
      destination:  { type: 'string', description: 'Arrival airport or city' },
      date:         { type: 'string', description: 'Outbound date' },
      return_date:  { type: 'string', description: 'Return date for round trip — omit for one-way' },
      class_pref:   { type: 'string', enum: ['economy', 'premium_economy', 'business'], description: 'Cabin class' },
      passengers:   { type: 'number', description: 'Number of passengers (default 1)' },
    },
  },
  skillDoc: `# FlightAgent
Searches and presents flight options across major airlines and routes.

## Handles
- Domestic UK flights
- European short-haul
- Long-haul international
- One-way and return trips

## Cannot handle
- Private charter flights
- Cargo or freight
- Unaccompanied minor bookings

## Output
Returns 3 options (best price, best time, best airline) with prices, airlines, and layover details.`,
};

// ── Research ─────────────────────────────────────────────────────────────────

const researchSkill: SkillDefinition = {
  toolName: 'research',
  category: 'research',
  displayName: 'ResearchAgent',
  description: 'Research and summarise information — venue details, opening hours, directions, local knowledge, event information.',
  requiredProfileFields: [],
  inputSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query:    { type: 'string', description: 'What to research' },
      location: { type: 'string', description: 'Geographic context if relevant' },
      format:   { type: 'string', enum: ['brief', 'detailed'], description: 'Response length' },
    },
  },
  skillDoc: `# ResearchAgent
Researches and summarises information to support booking decisions.

## Handles
- Venue details and opening hours
- Local transport and directions
- Event information and schedules
- Restaurant and attraction research
- Price comparisons

## Cannot handle
- Real-time flight or train availability (use FlightAgent/TrainAgent)
- Legal or financial advice
- Personal data lookup

## Output
Returns a concise summary with key facts, relevant links, and recommendations.`,
};

// ── Registry export ──────────────────────────────────────────────────────────

export const SKILLS: SkillDefinition[] = [
  trainSkill,
  hotelSkill,
  taxiSkill,
  flightSkill,
  researchSkill,
];

export const SKILL_MAP = Object.fromEntries(
  SKILLS.map(s => [s.toolName, s]),
) as Record<string, SkillDefinition>;

/** Convert skill definitions to Anthropic tool format */
export function skillsToAnthropicTools() {
  return SKILLS.map(skill => ({
    name: skill.toolName,
    description: `${skill.description}\n\nSkill doc:\n${skill.skillDoc}`,
    input_schema: skill.inputSchema,
  }));
}
