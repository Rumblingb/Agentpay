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

## User input edge cases — handle all of these gracefully

**No time given** ("book a train to Manchester"):
→ Query with time_preference="any", return up to 3 options with times + fares, ask which one.
  Example: "Three today — 14:05 £21, 15:30 £28, 17:45 £19. Which one?"

**Ambiguous station** ("London" → could be Euston, Paddington, King's Cross, Victoria, etc.):
→ Ask: "London which terminus — King's Cross, Euston, Paddington, or Victoria?"

**Station misspelling** ("Manchestr", "Birmingam"):
→ Infer the closest match and confirm: "Manchester Piccadilly — is that right?"

**"Next train"** with no other info:
→ Query for next departure from now, present it immediately.

**"Cheapest"** with no time constraint:
→ Query time_preference="any", pick the lowest fare option and present it.

**"First class"** request:
→ Use class_pref="first". If unavailable, say so and offer standard.

**Return ticket** but no return date:
→ Ask: "When are you coming back?"

**Route doesn't exist / no trains** (e.g. a route not served by rail):
→ "No direct trains on that route. Could a coach or connecting service work?"

**Strike action / engineering works**:
→ Inform clearly. Suggest rail replacement bus or alternative route if possible.

**Time already passed today**:
→ Treat as tomorrow. "That time's passed today — booking for tomorrow instead. OK?"

**User changes their mind** ("actually make it first class" / "cancel that, book the 17:45"):
→ Abandon current plan, start fresh with the new request.

**Duplicate request** (user asks again immediately):
→ Don't book twice. Say: "Already on it — one booking."

## Output
Returns booking reference, departure time, platform, operator, price, and confirmation email status.`,
};

// ── India train booking ──────────────────────────────────────────────────────

const trainIndiaSkill: SkillDefinition = {
  toolName: 'book_train_india',
  category: 'rail_india',
  displayName: 'IndiaRailAgent',
  description: 'Search and book Indian Railways (IRCTC) train journeys across India. Handles all classes from Sleeper to 1st AC, Rajdhani, Shatabdi, and all express trains.',
  requiredProfileFields: ['legalName', 'email', 'phone', 'nationality'],
  inputSchema: {
    type: 'object',
    required: ['origin', 'destination'],
    properties: {
      origin:          { type: 'string', description: 'Departure station or Indian city (e.g. "New Delhi", "Mumbai", "Bangalore")' },
      destination:     { type: 'string', description: 'Arrival station or Indian city' },
      date:            { type: 'string', description: 'Travel date — ISO (YYYY-MM-DD) or natural language ("tomorrow", "Thursday")' },
      class_pref:      { type: 'string', enum: ['SL', '3A', '2A', '1A', 'CC', 'EC'], description: 'Booking class: SL=Sleeper, 3A=3-tier AC (most popular), 2A=2-tier AC, 1A=First AC, CC=Chair Car (day trains), EC=Executive Chair' },
      time_preference: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'any'], description: 'Preferred departure window' },
      quota:           { type: 'string', enum: ['GENERAL', 'TATKAL'], description: 'Booking quota — TATKAL for last-minute (costs more)' },
    },
  },
  skillDoc: `# IndiaRailAgent
Searches and books Indian Railways (IRCTC) train journeys across India.

## Handles
- All IRCTC train categories: Rajdhani, Shatabdi, Duronto, Express, Mail
- All booking classes: SL (Sleeper), 3A, 2A, 1A, CC, EC
- General and TATKAL quota
- Pan-India routes — all major stations

## Class guide
- SL (Sleeper): Basic non-AC, most affordable. ~₹300–800 for medium routes.
- 3A (3-tier AC): Most popular AC class. ~₹800–2500.
- 2A (2-tier AC): More comfortable, wider berths. ~₹1200–4000.
- 1A (First AC): Premium, private cabins. ~₹2500–8000.
- CC (Chair Car): Day trains like Shatabdi. ~₹400–1200.
- EC (Executive Chair): Shatabdi executive, wider seats. ~₹800–2000.

## Cannot handle
- Foreign tourist quota (FTSR) — requires separate process
- Group bookings over 6 passengers
- Season tickets or monthly passes

## User input edge cases — handle all of these gracefully

**No time given** ("book a train to Mumbai"):
→ Query with time_preference="any", return up to 3 trains with departure times + fares, ask which.
  Example: "Three trains — Rajdhani 16:55 ₹1,450, Duronto 23:00 ₹1,200, Express 06:30 ₹680. Which?"

**No class given**:
→ Default to 3A (most popular). Mention it: "Booking 3A — comfortable AC. OK?"

**User says "AC"** without specifying tier:
→ Ask: "3A or 2A? 3A is ₹800–2500, 2A is a bit more space at ₹1200–4000."

**Train fully booked / waitlisted**:
→ "That train is fully booked. TATKAL opens earlier — want that at a premium, or try another train?"

**TATKAL needed but not requested** (last-minute, within 1-2 days):
→ Proactively mention: "This is last minute — TATKAL quota costs more but guarantees a seat. Want it?"

**Station abbreviation or local name** (NDLS=New Delhi, CSTM=Mumbai CST, SBC=Bangalore, MAS=Chennai):
→ Resolve silently and use correct station name.

**City with multiple stations** ("Mumbai" → CSTM, LTT, BCT, Dadar):
→ Ask: "Mumbai which station — CST, Lokmanya Tilak, or Bandra?"

**Station misspelling** ("Bangalur", "Dellhi"):
→ Infer the closest match and confirm before proceeding.

**"Tatkal"** mentioned by user:
→ Always use quota="TATKAL". Warn that it costs 30–50% more.

**No trains on that date** (route not available / holiday disruption):
→ "No trains found for that date. Want the day before or after?"

**User gives train number** ("Book me 12951"):
→ Use that specific train. Look it up, confirm route + time + class.

**"Sleeper"** mentioned without context:
→ Use class_pref="SL". If overnight route, perfect. If short day route, suggest CC instead.

**User changes their mind**:
→ Abandon current plan, start fresh. Don't double-book.

## Output
Returns train number, train name, departure/arrival time, journey duration, class, fare in INR, and booking PNR.`,
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

## User input edge cases — handle all of these gracefully

**No check-out date** ("hotel in Manchester tonight"):
→ Ask: "How many nights?"

**No budget given**:
→ Search mid-range (£80–150/night UK, ₹3000–8000 India). Present best option with price.

**"Cheap" / "cheapest"**:
→ Find lowest available, present it with name and price. Flag if it's far from centre.

**"Nice" / "good" / "decent"**:
→ 4-star or equivalent. Present the best-rated mid-range option.

**Location too broad** ("London"):
→ Ask: "Central, near a specific station, or near somewhere in particular?"

**No availability**:
→ "Nothing available those dates. Want me to check nearby areas or different dates?"

**User wants breakfast included**:
→ Add "with breakfast" to preference. If unavailable, flag it.

**User doesn't specify guests**:
→ Default to 1 guest.

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

## User input edge cases — handle all of these gracefully

**No pickup time** ("taxi from the station"):
→ Ask: "What time do you need picking up?"

**Vague pickup** ("the station"):
→ Ask which station, or infer from earlier context in the conversation.

**Airport with no terminal** ("Heathrow"):
→ Ask: "Which terminal?" — it affects pickup point significantly.

**"Now"** or very soon (within 30 mins):
→ "Pre-booked taxis need a bit of notice. Earliest I can get is [time] — want that?"

**User has luggage / big group**:
→ Suggest MPV if 3+ passengers or "lot of bags" mentioned.

**No drop-off given**:
→ Ask: "Where to?"

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

## User input edge cases — handle all of these gracefully

**No date given**:
→ Ask: "When are you flying?"

**City with multiple airports** ("London" → LHR/LGW/STN/LTN/LCY):
→ Ask: "Any preference on airport — Heathrow, Gatwick, or doesn't matter?"

**Route better served by train** (London–Paris, London–Brussels, under 3h):
→ Mention it: "Eurostar is often faster and cheaper for that route — want me to check that instead?"

**No passport / document in profile for international**:
→ "I'll need your passport details to book. Add them in Settings → Profile."

**One-way stated but return likely** ("flying to Barcelona"):
→ Ask: "Just one-way, or do you need a return?"

**"Cheap" flights**:
→ Search economy, sort by price, present cheapest 2 options with layover info.

**Flight not available**:
→ "Nothing direct on that date. Want the nearest available, or a connecting flight?"

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
  trainIndiaSkill,
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
