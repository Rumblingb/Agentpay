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
  description: 'Search and book UK, European, and major global train journeys. Handles single tickets, returns, railcard discounts, first class, business class, and seat reservations. Covers National Rail, Eurostar, TGV, ICE, Frecciarossa, AVE, Amtrak, VIA Rail, Shinkansen, KTX, and other major intercity corridors.',
  requiredProfileFields: ['legalName', 'email', 'phone', 'seatPreference', 'classPreference', 'railcardType'],
  inputSchema: {
    type: 'object',
    required: ['origin', 'destination'],
    properties: {
      origin:             { type: 'string', description: 'Departure station or city (e.g. "Derby", "London St Pancras", "Paris", "Amsterdam")' },
      destination:        { type: 'string', description: 'Arrival station or city (e.g. "London King\'s Cross", "Paris Gare du Nord", "Rome")' },
      date:               { type: 'string', description: 'Travel date — ISO (YYYY-MM-DD) or natural language ("tomorrow", "Thursday")' },
      time_preference:    { type: 'string', enum: ['morning', 'afternoon', 'evening', 'any'], description: 'Preferred departure time window' },
      class_pref:         { type: 'string', enum: ['standard', 'first', 'business', 'luxury'], description: 'Ticket class. standard = economy. first = first class. business = business premier (Eurostar) / executive (AVE/Frecciarossa). luxury = private cabin / luxury rail product (Orient Express etc) — use book_luxury_rail instead if confirmed luxury rail.' },
      return_date:        { type: 'string', description: 'Return date for a return ticket — omit for single' },
      railcard_type:      { type: 'string', description: 'UK railcard type from profile (e.g. "16-25", "senior", "network") — include when present so the operations team applies the correct discount on Trainline' },
      final_destination:  { type: 'string', description: 'Where the user is actually going after the mainline terminus — London postcode, area, or address (e.g. "Shoreditch", "WC2N 5DU", "The Shard"). Only set when user mentions a specific London end-point beyond the station.' },
    },
  },
  skillDoc: `# TrainAgent
Searches and books UK, European, and major global rail journeys.

## Coverage
- **UK**: All National Rail services (live via Darwin). 200+ stations.
- **Eurostar**: London ↔ Paris / Brussels / Amsterdam (direct, no change).
- **France (TGV Inouï)**: Paris ↔ Lyon / Marseille / Bordeaux / Nice / Barcelona / Strasbourg / Lille.
- **Netherlands / Belgium**: Amsterdam ↔ Brussels ↔ Paris (Eurostar / Thalys). Rotterdam, Utrecht, Ghent, Bruges, Antwerp.
- **Germany (ICE)**: Frankfurt ↔ Berlin / Munich / Hamburg / Cologne. Berlin ↔ Hamburg / Munich. Cross-border: Amsterdam–Cologne–Frankfurt, Brussels–Frankfurt, Vienna–Munich.
- **Italy (Frecciarossa / Italo)**: Rome ↔ Milan ↔ Florence ↔ Naples. Milan ↔ Venice / Turin / Bologna.
- **Spain (AVE / Renfe)**: Madrid ↔ Barcelona / Seville / Valencia / Malaga / Bilbao / Zaragoza.
- **Austria (Railjet / ÖBB)**: Vienna ↔ Salzburg / Munich / Prague.
- **Switzerland (SBB)**: Zurich ↔ Geneva / Basel / Bern / Milan / Munich.
- **Czech Republic**: Prague ↔ Vienna / Berlin.
- **Scandinavia**: Stockholm ↔ Gothenburg / Copenhagen / Oslo.
- **North America**: New York ↔ Boston / Washington / Philadelphia, Toronto ↔ Montreal, Vancouver ↔ Seattle.
- **Asia**: Tokyo ↔ Kyoto / Osaka / Nagoya, Seoul ↔ Busan, Bangkok ↔ Chiang Mai, Singapore ↔ Kuala Lumpur.

## Class tiers
- **standard** — economy / 2nd class. Default.
- **first** — first class: UK first, Eurostar Standard Premier, TGV 1ère, ICE 1. Quieter, wider seats, meals on long-distance.
- **business** — Eurostar Business Premier, AVE Preferente, Frecciarossa Executive. Lounge access, meal service, flexible booking.
- **luxury** — see book_luxury_rail for Orient Express, Belmond, sleeper suites.

## Handles
- Single and return tickets
- Advance, Off-Peak, and Anytime fares
- Railcard discounts (UK — applied by ops team on Trainline)
- Seat reservations where available
- Cross-border European itineraries

## Cannot handle
- Rail holidays or packages
- Group bookings over 9 passengers
- Rail + hotel bundles (use TrainAgent + HotelAgent separately)
- Luxury sleeper trains (use book_luxury_rail)

## User input edge cases — handle all of these gracefully

**No time given** ("book a train to Manchester"):
→ Query with time_preference="any", return up to 3 options with times + fares, ask which one.
  Example: "Three today — 14:05 £21, 15:30 £28, 17:45 £19. Which one?"
  For EU: "Three trains — 08:22 →11:47 Eurostar €79, 12:34 →15:47 €89, 16:31 →19:47 €69. Which?"

**Ambiguous station** ("London" → could be Euston, Paddington, King's Cross, Victoria, etc.):
→ Ask: "London which terminus — King's Cross, Euston, Paddington, or Victoria?"

**"Paris"** → always Paris Gare du Nord for Eurostar / international arrivals.

**Station misspelling** ("Manchestr", "Birmingam", "Marseil"):
→ Infer the closest match and confirm.

**"Next train"** with no other info:
→ Query for next departure from now, present it immediately.

**"Cheapest"** with no time constraint:
→ Query time_preference="any", pick the lowest fare option and present it.

**"First class"** or "business class" request:
→ Set class_pref accordingly. For EU, note if business includes lounge access or meal.

**Elite / PRO subscriber** (from subscriptionTier in profile):
→ Proactively offer first or business class. Don't make them ask.

**Return ticket** but no return date:
→ Ask: "When are you coming back?"

**Route better by Eurostar than flight** (London–Paris, London–Brussels, Paris–Amsterdam):
→ Confirm this is a train booking, mention approximate journey time.

**Strike action / engineering works**:
→ Inform clearly. Suggest alternative route if possible.

**Time already passed today**:
→ Treat as tomorrow. "That time's passed today — booking for tomorrow instead. OK?"

**User changes their mind**:
→ Abandon current plan, start fresh with the new request.

## Output
Returns booking reference, departure time, platform (if known), operator, price (£ UK/global, € EU), and confirmation email status.
For EU routes: mention that booking is via Rail Europe / Trainline partner and will be confirmed by email.
For global routes outside Europe: mention that schedules may be partner-fed and ticketing may be confirmed by email.`,
};

// ── Luxury rail booking ───────────────────────────────────────────────────────

const luxuryRailSkill: SkillDefinition = {
  toolName: 'book_luxury_rail',
  category: 'rail_luxury',
  displayName: 'LuxuryRailAgent',
  description: 'Book premium and luxury rail experiences: Venice Simplon-Orient-Express, Belmond Royal Scotsman, Caledonian Sleeper private cabins, Glacier Express, Rocky Mountaineer, El Transcantábrico, and other luxury trains. Requires Elite subscription or explicit luxury request.',
  requiredProfileFields: ['legalName', 'email', 'phone'],
  inputSchema: {
    type: 'object',
    required: ['product'],
    properties: {
      product:       { type: 'string', description: 'Luxury train product (e.g. "Venice Simplon-Orient-Express", "Royal Scotsman", "Caledonian Sleeper", "Glacier Express", "Rocky Mountaineer", "El Transcantábrico", "The Ghan", "Indian Pacific", "Pride of Africa")' },
      origin:        { type: 'string', description: 'Departure city or station' },
      destination:   { type: 'string', description: 'Arrival city or station' },
      date:          { type: 'string', description: 'Preferred travel date — ISO or natural language' },
      cabin_type:    { type: 'string', enum: ['cabin', 'suite', 'grand_suite', 'heritage_suite'], description: 'Cabin/suite tier — grand_suite or heritage_suite for top tier. Defaults to cabin.' },
      passengers:    { type: 'number', description: 'Number of passengers (default 1, max 2 per cabin)' },
      nights:        { type: 'number', description: 'Number of nights (for multi-day journeys)' },
    },
  },
  skillDoc: `# LuxuryRailAgent
Books luxury and premium sleeper rail experiences.

## Products available

### Europe
- **Venice Simplon-Orient-Express** (Belmond) — London / Paris → Venice / Rome / Istanbul. Cabins from ~£2,000pp. Grand Suites from ~£8,000pp.
- **Belmond British Pullman** — UK day excursions from London Victoria. From ~£350pp.
- **Belmond Royal Scotsman** — 2–7 night Scottish Highlands loop from Edinburgh. From ~£1,800pp/night.
- **Glacier Express** (Zermatt → St Moritz, Switzerland, 8hr scenic) — First class from ~CHF 200pp. Includes meal.
- **El Transcantábrico Gran Lujo** (Spain, Basque–Galicia, 7 nights) — all-inclusive from ~€5,000pp.
- **The Train des Lumières** (France, scenic Alps) — day journeys from ~€80pp.

### UK Sleepers
- **Caledonian Sleeper** (London Euston → Edinburgh / Glasgow / Fort William / Inverness / Aberdeen) — Club Rooms (en-suite cabin with double bed) from ~£100-200 each way. Accessible and double rooms available.
- **Night Riviera** (GWR, London Paddington → Penzance) — sleeper berths from ~£60.

### Americas
- **Rocky Mountaineer** (Vancouver → Banff, 2 days) — GoldLeaf from ~CAD 1,600pp.
- **Amtrak Coast Starlight / California Zephyr / Empire Builder** — Roomette from ~USD 200, Bedroom Suite ~USD 600.

### Africa / Australia
- **Pride of Africa** (Rovos Rail, Cape Town → Pretoria/Dar es Salaam, 2-15 nights) — from ~USD 3,000pp.
- **The Ghan** (Adelaide → Darwin, 54hr) — Platinum from ~AUD 2,500pp.
- **Indian Pacific** (Sydney → Perth, 65hr) — Platinum from ~AUD 2,500pp.

### Asia / Middle East
- **Maharajas' Express** (India, 7 nights) — from ~USD 4,000pp.
- **Eastern & Oriental Express** (SE Asia) — from ~SGD 4,000pp.

## Booking model
All luxury rail bookings are handled by the ops team with specialist concierge support.
Full details sent by email within 2 hours. Deposit may be required.

## User input edge cases

**"Orient Express"** → Venice Simplon-Orient-Express by Belmond (not a generic term).

**No dates** → Ask: "Any flexibility on dates? Departures are seasonal and sell out months ahead."

**"Cheap luxury train"** → Caledonian Sleeper Club Room or Night Riviera are the best value entry points (~£100-200).

**"Sleeper to Scotland"** → Caledonian Sleeper; ask which Scottish city.

**"Something special for anniversary / honeymoon"** → Suggest VSOE Grand Suite or Royal Scotsman Suite; include a note in the booking.

**Sold out** → "That departure is likely fully booked. Let me check next available dates."

## Output
Returns luxury rail product, route, date, cabin type, estimated price per person, and ops team follow-up timeline.`,
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
      class_pref:      { type: 'string', enum: ['SL', '2S', '3A', '2A', '1A', 'CC', 'EC'], description: 'IRCTC class code — derived from user class tier + journey duration. Budget short=2S, budget long=SL. Standard short=CC, standard long=3A. Premium short=EC, premium long=2A. Default: 3A.' },
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

const busSkill: SkillDefinition = {
  toolName: 'book_bus',
  category: 'bus',
  displayName: 'BusAgent',
  description: 'Search and book intercity buses and coaches worldwide. UK: National Express and Megabus between 25+ cities (London, Manchester, Birmingham, Bristol, Edinburgh, Glasgow, Cardiff, Leeds, York, Oxford, Cambridge, Brighton, Bath, Sheffield, Liverpool, Newcastle, Exeter, etc.). EU: FlixBus across all major corridors. USA/Canada: Greyhound, FlixBus USA, Northeast corridor. SE Asia: Bangkok–Chiang Mai/Phuket, Singapore–KL/Penang, Ho Chi Minh–Hanoi, Jakarta–Bali/Yogya. Cheaper than rail on many routes — always check when user asks for budget options.',
  requiredProfileFields: ['legalName', 'email', 'phone'],
  inputSchema: {
    type: 'object',
    required: ['origin', 'destination'],
    properties: {
      origin:          { type: 'string', description: 'Departure city or coach station' },
      destination:     { type: 'string', description: 'Arrival city or coach station' },
      date:            { type: 'string', description: 'Travel date - ISO or natural language' },
      time_preference: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'any'], description: 'Preferred departure window' },
      comfort:         { type: 'string', enum: ['standard', 'premium', 'sleeper'], description: 'Coach comfort preference' },
    },
  },
  skillDoc: `# BusAgent
Searches and books intercity buses and coaches worldwide.

## Coverage

### UK (National Express / Megabus / FlixBus UK)
London Victoria ↔ Manchester, Birmingham, Bristol, Edinburgh, Glasgow, Cardiff, Leeds, York, Oxford, Cambridge, Brighton, Bath, Sheffield, Liverpool, Newcastle, Exeter, Nottingham, Coventry, Portsmouth, Southampton, and more.
Fares from £3 advance (London–Oxford, London–Brighton). Typical London–Manchester: £8–15. London–Edinburgh: £18–30.

### EU (FlixBus / BlaBlaCar Bus / Eurolines)
Paris–Amsterdam, Paris–Berlin, Paris–Brussels, Frankfurt–Berlin, Munich–Vienna, Prague–Berlin/Vienna, Rome–Milan, Barcelona–Madrid, London–Paris/Amsterdam (via ferry + coach).

### USA / Canada (Greyhound / FlixBus USA / Trailways)
New York–Boston, New York–Washington DC, New York–Philadelphia, Los Angeles–San Francisco, LA–Las Vegas, Seattle–Portland. Toronto–Montreal, Vancouver–Seattle.

### SE Asia (regional operators)
Bangkok–Chiang Mai (10h, ฿300), Bangkok–Phuket (12h, ฿700), Singapore–KL (6h, S$25), Ho Chi Minh–Hanoi (overnight, ₫350k), Jakarta–Yogyakarta (8h, Rp150k), Jakarta–Bali (via ferry, Rp200k).

## Operators
UK: National Express, Megabus, FlixBus UK
EU: FlixBus (dominant), BlaBlaCar Bus, Eurolines
USA: Greyhound, FlixBus USA, Megabus USA
SE Asia: Nakhon Chai Air (Thailand), Transnational (Malaysia/SG), Sinh Tourist (Vietnam), PO Rosalia Indah (Indonesia)

## When to use buses over trains
- Budget queries ("cheapest way", "how cheap can I get")
- UK routes under 4h where train would be 3–5× more
- SE Asia where rail is slower or limited
- Overnight routes where sleeper coach saves hotel cost

## Cannot handle
- Local city buses (use navigate or metro instead)
- Charter coach hire
- Tour buses

## Edge cases

**"Cheapest way from X to Y"**
→ Always check bus before flights. Present fare comparison: "Train £28, Bus £8 (3h longer)."

**No time given**
→ Return up to 4 departures spread through the day, ask which one.

**Short local bus request**
→ Do not use this tool. Use navigate or metro instead.

**Overnight journey**
→ Mention sleep opportunity: "Overnight coach — arrives 06:30, saves a night's hotel."

## Output
Returns operator, departure time, arrival time, journey duration, coach amenities (WiFi/USB/AC), and fare in local currency.`,
};

const flightSkill: SkillDefinition = {
  toolName: 'search_flights',
  category: 'flight',
  displayName: 'FlightAgent',
  description: 'Search and book flights across 350+ airlines worldwide via Duffel. Handles one-way, return, economy, premium economy, and business class. Returns top 3 options (cheapest, fastest, best airline) with price and duration.',
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

// ── Metro planning ────────────────────────────────────────────────────────────

const metroSkill: SkillDefinition = {
  toolName: 'plan_metro',
  category: 'metro',
  displayName: 'MetroAgent',
  description: 'Plan metro journeys in Bengaluru (Purple Line + Green Line) and Pune (Line 1 + Line 2). Returns route, interchange info, journey time, and fare in INR. No booking needed — metro is turn-up-and-go.',
  requiredProfileFields: [],
  inputSchema: {
    type: 'object',
    required: ['origin', 'destination'],
    properties: {
      origin:      { type: 'string', description: 'Metro origin — station name or area (e.g. "Indiranagar", "MG Road", "PCMC", "Deccan")' },
      destination: { type: 'string', description: 'Metro destination — station name or area (e.g. "Whitefield", "Jayanagar", "Swargate", "Kharadi")' },
    },
  },
  skillDoc: `# MetroAgent
Plans metro journeys in Bengaluru and Pune.

## Coverage
- **Bengaluru (BMRCL)**: Purple Line (East–West: Mysore Road ↔ Whitefield) + Green Line (North–South: Nagasandra ↔ Yelachenahalli). Interchange at Kempegowda/Majestic.
- **Pune (PMRDA)**: Line 1 (PCMC → Swargate) + Line 2 (Vanaz → Ramwadi). Interchange at Shivajinagar.

## Key Bengaluru stations
- Purple Line: Mysore Road, Vijayanagar, **Kempegowda** (interchange), Cubbon Park, MG Road, Trinity, Halasuru, Indiranagar, Baiyappanahalli, Tin Factory, Whitefield
- Green Line: Nagasandra, Yeshwanthpur, Rajajinagar, **Kempegowda** (interchange), City Railway Station, KR Market, Lalbagh, Jayanagar, Yelachenahalli

## Key Pune stations
- Line 1: PCMC, Bhosari, Dapodi, Khadki, **Shivajinagar** (interchange), Civil Court, Budhwar Peth, Swargate
- Line 2: Vanaz, Nal Stop, Deccan Gymkhana, **Shivajinagar** (interchange), Pune Station, Hadapsar, Magarpatta, Kharadi, Ramwadi

## Fare slabs (2025)
- Bengaluru: ₹10 (1-2 stops) → ₹20 → ₹30 → ₹40 → ₹50 → ₹60 → ₹70 (21+ stops)
- Pune: ₹10 → ₹20 → ₹30 → ₹40 → ₹50 (14+ stops)

## Edge cases
- User says "Majestic" → Kempegowda interchange
- User says "ITPL" or "Kadugodi" → Whitefield
- Interchange routes: add ~5 min transfer time at interchange station
- No booking, no ticket reservation. Just quote route + time + fare.

## Output
Route with line(s), stops, journey time, fare in INR. For Bro's narration: keep it to one sentence — "Green Line to Kempegowda, switch to Purple, 8 stops to Indiranagar — 22 min, ₹30."`,
};

// ── Event discovery ───────────────────────────────────────────────────────────

const discoverEventsSkill: SkillDefinition = {
  toolName: 'discover_events',
  category: 'events',
  displayName: 'EventsAgent',
  description: 'Discover live events, concerts, sports, and shows at a destination on a given date. Uses Ticketmaster Discovery API. Info-only — no payment required.',
  requiredProfileFields: [],
  inputSchema: {
    type: 'object',
    required: ['destination', 'date'],
    properties: {
      destination: { type: 'string', description: 'City or destination (e.g. "Paris", "London", "New York")' },
      date:        { type: 'string', description: 'Date to search — ISO YYYY-MM-DD or natural language ("Friday", "next Saturday")' },
      genre:       { type: 'string', description: 'Optional genre filter (e.g. "music", "sports", "comedy", "theatre")' },
    },
  },
  skillDoc: `# EventsAgent
Discovers events at a destination using Ticketmaster Discovery API.

## Handles
- Concerts and music festivals
- Sports events (football, tennis, F1, etc.)
- Theatre, comedy, and performing arts
- Exhibitions and pop culture events

## Use proactively
After a train or flight is confirmed 2+ days ahead, immediately check for events at the destination on the travel date.
Present as: "Coldplay at Accor Arena that night — €95. Add it?"

## Output
Returns event name, venue, time, genre, price range, and ticket URL.`,
};

// ── Nearby discovery ──────────────────────────────────────────────────────────

const discoverNearbySkill: SkillDefinition = {
  toolName: 'discover_nearby',
  category: 'discovery',
  displayName: 'NearbyAgent',
  description: 'Find nearby places — cafés, restaurants, attractions, parks, pharmacies — using Google Places. Pass GPS coords when available for accurate results. Info-only — no payment required.',
  requiredProfileFields: [],
  inputSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query:         { type: 'string', description: 'What to find (e.g. "quiet café", "Italian restaurant", "pharmacy", "ATM")' },
      location:      { type: 'string', description: 'Location context if no GPS (e.g. "near Covent Garden", "in Marais, Paris")' },
      lat:           { type: 'number', description: 'GPS latitude — pass when available for precision' },
      lon:           { type: 'number', description: 'GPS longitude — pass when available for precision' },
      type:          { type: 'string', description: 'Place type filter (e.g. "cafe", "restaurant", "pharmacy", "atm", "park")' },
      radius_meters: { type: 'number', description: 'Search radius in metres (default 1500)' },
    },
  },
  skillDoc: `# NearbyAgent
Finds nearby places using Google Places API and GPS location.

## Handles
- Food and drink: cafés, restaurants, bars, bakeries
- Essentials: pharmacies, ATMs, supermarkets, convenience stores
- Transport: bus stops, tube stations, taxi ranks
- Tourism: museums, parks, attractions, viewpoints

## GPS priority
When travelProfile.currentLat/currentLon are available, always pass them as lat/lon for precise results.
If GPS unavailable and location ambiguous, ask once: "Where are you now?"

## Output
Returns up to 5 nearby places with name, rating, price level, and address.`,
};

// ── Navigation ────────────────────────────────────────────────────────────────

const navigateSkill: SkillDefinition = {
  toolName: 'navigate',
  category: 'navigation',
  displayName: 'NavigateAgent',
  description: 'Get walking, cycling, or transit directions to a destination using Google Routes API. Returns step-by-step directions and encoded polyline for map display. Info-only — no payment required.',
  requiredProfileFields: [],
  inputSchema: {
    type: 'object',
    required: ['destination'],
    properties: {
      destination: { type: 'string', description: 'Where the user wants to go (e.g. "the Colosseum", "Gare du Nord", "St Paul\'s Cathedral")' },
      origin_lat:  { type: 'number', description: 'Current GPS latitude — required for accurate route' },
      origin_lon:  { type: 'number', description: 'Current GPS longitude — required for accurate route' },
      travel_mode: { type: 'string', enum: ['WALK', 'BICYCLE', 'TRANSIT', 'DRIVE'], description: 'How to get there (default: WALK)' },
    },
  },
  skillDoc: `# NavigateAgent
Provides walking and transit directions using Google Routes API.

## Handles
- Walking directions with turn-by-turn steps
- Cycling routes
- Transit routing (where available)
- Encoded polyline for Meridian map screen

## Darwin/TfL priority
For London journeys to/from National Rail termini, use plan_metro or the Darwin final-leg flow instead.
This agent handles non-London and non-UK-transit navigation.

## Flow
1. User: "Navigate to the Colosseum"
2. Bro: "Walking to the Colosseum — 12 min (900 m). Ready?"
3. On confirm: return full step-by-step for map screen

## Output
Returns step-by-step instructions, total duration, total distance, and encoded polyline for the Meridian map screen.`,
};

// ── Restaurant booking ────────────────────────────────────────────────────────

const bookRestaurantSkill: SkillDefinition = {
  toolName: 'book_restaurant',
  category: 'dining',
  displayName: 'DiningAgent',
  description: 'Find and suggest restaurants near a location. Searches Google Places for nearby dining. Info-only for discovery; ops team handles reservations for venues that require them.',
  requiredProfileFields: ['legalName', 'email', 'phone'],
  inputSchema: {
    type: 'object',
    required: ['location'],
    properties: {
      location:   { type: 'string', description: 'City or area to search (e.g. "Marais, Paris", "Soho, London")' },
      date:       { type: 'string', description: 'Date of dining — ISO or natural language' },
      time:       { type: 'string', description: 'Preferred dining time (e.g. "19:00", "evening")' },
      party_size: { type: 'number', description: 'Number of diners (default 2)' },
      cuisine:    { type: 'string', description: 'Cuisine preference (e.g. "Italian", "sushi", "French bistro")' },
      budget:     { type: 'string', enum: ['cheap', 'moderate', 'expensive', 'luxury'], description: 'Budget level' },
    },
  },
  skillDoc: `# DiningAgent
Finds restaurants near a location using Google Places.

## Handles
- Any cuisine type
- Price level filtering
- Proactive suggestions after event booking

## Use proactively
After booking an event, suggest: "Table near [venue] at 19:00 for 2? I see a good Italian around the corner."

## Output
Returns top 3–5 restaurants with name, cuisine, rating, price level, and address.
For reservations: ops team follows up by email if needed.`,
};

// ── Registry export ──────────────────────────────────────────────────────────

// Taxi not yet active — waiting on API integration.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _COMING_SOON = [taxiSkill];

export const SKILLS: SkillDefinition[] = [
  trainSkill,           // UK + EU rail (Darwin live + EU Rail Europe/Trainline/mock)
  luxuryRailSkill,      // Orient Express, Royal Scotsman, Caledonian Sleeper, etc.
  trainIndiaSkill,      // Indian Railways IRCTC
  busSkill,             // Intercity coaches and buses
  flightSkill,          // Flights — Duffel 350+ airlines
  metroSkill,           // Bengaluru + Pune metro
  hotelSkill,           // Hotels — manual fulfillment via ops team
  discoverEventsSkill,  // Ticketmaster event discovery
  discoverNearbySkill,  // Google Places nearby discovery
  navigateSkill,        // Google Routes walking/transit navigation
  bookRestaurantSkill,  // Restaurant discovery + dining
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
