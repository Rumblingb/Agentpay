/**
 * metro.ts — India metro journey planner
 * Bengaluru (BMRCL) Purple & Green lines + Pune (PMRDA) Lines 1 & 2.
 * Offline Dijkstra routing, slab-based fares. Edge-compatible (no Node built-ins).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface StationNode {
  id:       string;
  name:     string;
  city:     'bengaluru' | 'pune';
  lines:    string[];
  aliases?: string[];
}

interface GraphEdge { a: string; b: string; minutes: number; line: string; }

export interface MetroLeg {
  lineName: string;
  from:     string;
  to:       string;
  stops:    number;
  minutes:  number;
}

export interface MetroResult {
  city:          string;
  origin:        string;
  destination:   string;
  found:         boolean;
  totalMinutes?: number;
  fare?:         number;
  stops?:        number;
  legs?:         MetroLeg[];
  error?:        string;
}

// ── Station data ──────────────────────────────────────────────────────────────

const STATIONS: StationNode[] = [
  // ── Bengaluru Green Line (North–South) ────────────────────────────────────
  { id: 'BG0',  name: 'Nagasandra',                 city: 'bengaluru', lines: ['G'] },
  { id: 'BG1',  name: 'Dasarahalli',                city: 'bengaluru', lines: ['G'] },
  { id: 'BG2',  name: 'Yeshwanthpur',               city: 'bengaluru', lines: ['G'], aliases: ['yeshwantpur', 'yeshwantapur'] },
  { id: 'BG3',  name: 'Mahalakshmi',                city: 'bengaluru', lines: ['G'] },
  { id: 'BG4',  name: 'Rajajinagar',                city: 'bengaluru', lines: ['G'] },
  { id: 'BG5',  name: 'Sampige Road',               city: 'bengaluru', lines: ['G'], aliases: ['mantri square', 'mantri square sampige road'] },
  { id: 'BX',   name: 'Kempegowda',                 city: 'bengaluru', lines: ['G', 'P'], aliases: ['majestic', 'ksr', 'kempegowda majestic'] }, // INTERCHANGE
  { id: 'BG6',  name: 'City Railway Station',       city: 'bengaluru', lines: ['G'], aliases: ['sbc', 'bangalore city', 'bangalore city railway station'] },
  { id: 'BG7',  name: 'KR Market',                  city: 'bengaluru', lines: ['G'], aliases: ['krishna rajendra market', 'k r market'] },
  { id: 'BG8',  name: 'National College',            city: 'bengaluru', lines: ['G'] },
  { id: 'BG9',  name: 'Lalbagh',                    city: 'bengaluru', lines: ['G'] },
  { id: 'BG10', name: 'Jayanagar',                  city: 'bengaluru', lines: ['G'] },
  { id: 'BG11', name: 'Yelachenahalli',             city: 'bengaluru', lines: ['G'], aliases: ['silk board'] },

  // ── Bengaluru Purple Line (West–East) ─────────────────────────────────────
  { id: 'BP0',  name: 'Mysore Road',                city: 'bengaluru', lines: ['P'] },
  { id: 'BP1',  name: 'Attiguppe',                  city: 'bengaluru', lines: ['P'] },
  { id: 'BP2',  name: 'Vijayanagar',                city: 'bengaluru', lines: ['P'] },
  // BX = Kempegowda (interchange, defined above)
  { id: 'BP3',  name: 'Cubbon Park',                city: 'bengaluru', lines: ['P'] },
  { id: 'BP4',  name: 'MG Road',                    city: 'bengaluru', lines: ['P'], aliases: ['mg road', 'brigade road area'] },
  { id: 'BP5',  name: 'Trinity',                    city: 'bengaluru', lines: ['P'] },
  { id: 'BP6',  name: 'Halasuru',                   city: 'bengaluru', lines: ['P'], aliases: ['ulsoor'] },
  { id: 'BP7',  name: 'Indiranagar',                city: 'bengaluru', lines: ['P'] },
  { id: 'BP8',  name: 'Baiyappanahalli',            city: 'bengaluru', lines: ['P'], aliases: ['bayappanahalli'] },
  { id: 'BP9',  name: 'Tin Factory',                city: 'bengaluru', lines: ['P'] },
  { id: 'BP10', name: 'Kundalahalli',               city: 'bengaluru', lines: ['P'] },
  { id: 'BP11', name: 'Whitefield',                 city: 'bengaluru', lines: ['P'], aliases: ['itpl', 'kadugodi', 'whitefield itpl'] },

  // ── Pune Line 1 (North–South: PCMC → Swargate) ───────────────────────────
  { id: 'PA0',  name: 'PCMC',                       city: 'pune', lines: ['1'], aliases: ['pimpri-chinchwad', 'pimpri', 'chinchwad'] },
  { id: 'PA1',  name: 'Bhosari',                    city: 'pune', lines: ['1'] },
  { id: 'PA2',  name: 'Dapodi',                     city: 'pune', lines: ['1'] },
  { id: 'PA3',  name: 'Bopodi',                     city: 'pune', lines: ['1'] },
  { id: 'PA4',  name: 'Khadki',                     city: 'pune', lines: ['1'] },
  { id: 'PX',   name: 'Shivajinagar',               city: 'pune', lines: ['1', '2'] }, // INTERCHANGE
  { id: 'PA5',  name: 'Civil Court',                city: 'pune', lines: ['1'] },
  { id: 'PA6',  name: 'Budhwar Peth',               city: 'pune', lines: ['1'] },
  { id: 'PA7',  name: 'Mandai',                     city: 'pune', lines: ['1'] },
  { id: 'PA8',  name: 'Swargate',                   city: 'pune', lines: ['1'] },

  // ── Pune Line 2 (West–East: Vanaz → Ramwadi) ─────────────────────────────
  { id: 'PB0',  name: 'Vanaz',                      city: 'pune', lines: ['2'] },
  { id: 'PB1',  name: 'Anand Nagar',                city: 'pune', lines: ['2'] },
  { id: 'PB2',  name: 'Nal Stop',                   city: 'pune', lines: ['2'] },
  { id: 'PB3',  name: 'Deccan Gymkhana',            city: 'pune', lines: ['2'], aliases: ['deccan', 'fc road', 'deccan circle'] },
  { id: 'PB4',  name: 'Chhatrapati Sambhaji Udyan', city: 'pune', lines: ['2'], aliases: ['sambhaji park', 'cso'] },
  // PX = Shivajinagar (interchange, defined above)
  { id: 'PB5',  name: 'Agriculture College',        city: 'pune', lines: ['2'] },
  { id: 'PB6',  name: 'Pune Station',               city: 'pune', lines: ['2'], aliases: ['pune junction', 'pune railway station', 'pune railway'] },
  { id: 'PB7',  name: 'Fatima Nagar',               city: 'pune', lines: ['2'] },
  { id: 'PB8',  name: 'Hadapsar',                   city: 'pune', lines: ['2'] },
  { id: 'PB9',  name: 'Magarpatta',                 city: 'pune', lines: ['2'] },
  { id: 'PB10', name: 'Kharadi',                    city: 'pune', lines: ['2'] },
  { id: 'PB11', name: 'Ramwadi',                    city: 'pune', lines: ['2'] },
];

const EDGES: GraphEdge[] = [
  // Bengaluru Green Line
  { a: 'BG0',  b: 'BG1',  minutes: 3, line: 'G' },
  { a: 'BG1',  b: 'BG2',  minutes: 3, line: 'G' },
  { a: 'BG2',  b: 'BG3',  minutes: 2, line: 'G' },
  { a: 'BG3',  b: 'BG4',  minutes: 2, line: 'G' },
  { a: 'BG4',  b: 'BG5',  minutes: 3, line: 'G' },
  { a: 'BG5',  b: 'BX',   minutes: 2, line: 'G' },
  { a: 'BX',   b: 'BG6',  minutes: 3, line: 'G' },
  { a: 'BG6',  b: 'BG7',  minutes: 3, line: 'G' },
  { a: 'BG7',  b: 'BG8',  minutes: 2, line: 'G' },
  { a: 'BG8',  b: 'BG9',  minutes: 2, line: 'G' },
  { a: 'BG9',  b: 'BG10', minutes: 3, line: 'G' },
  { a: 'BG10', b: 'BG11', minutes: 4, line: 'G' },

  // Bengaluru Purple Line
  { a: 'BP0',  b: 'BP1',  minutes: 3, line: 'P' },
  { a: 'BP1',  b: 'BP2',  minutes: 2, line: 'P' },
  { a: 'BP2',  b: 'BX',   minutes: 5, line: 'P' },
  { a: 'BX',   b: 'BP3',  minutes: 3, line: 'P' },
  { a: 'BP3',  b: 'BP4',  minutes: 2, line: 'P' },
  { a: 'BP4',  b: 'BP5',  minutes: 2, line: 'P' },
  { a: 'BP5',  b: 'BP6',  minutes: 2, line: 'P' },
  { a: 'BP6',  b: 'BP7',  minutes: 3, line: 'P' },
  { a: 'BP7',  b: 'BP8',  minutes: 5, line: 'P' },
  { a: 'BP8',  b: 'BP9',  minutes: 3, line: 'P' },
  { a: 'BP9',  b: 'BP10', minutes: 3, line: 'P' },
  { a: 'BP10', b: 'BP11', minutes: 8, line: 'P' },

  // Pune Line 1
  { a: 'PA0',  b: 'PA1',  minutes: 4, line: '1' },
  { a: 'PA1',  b: 'PA2',  minutes: 4, line: '1' },
  { a: 'PA2',  b: 'PA3',  minutes: 3, line: '1' },
  { a: 'PA3',  b: 'PA4',  minutes: 3, line: '1' },
  { a: 'PA4',  b: 'PX',   minutes: 4, line: '1' },
  { a: 'PX',   b: 'PA5',  minutes: 3, line: '1' },
  { a: 'PA5',  b: 'PA6',  minutes: 2, line: '1' },
  { a: 'PA6',  b: 'PA7',  minutes: 2, line: '1' },
  { a: 'PA7',  b: 'PA8',  minutes: 3, line: '1' },

  // Pune Line 2
  { a: 'PB0',  b: 'PB1',  minutes: 3, line: '2' },
  { a: 'PB1',  b: 'PB2',  minutes: 3, line: '2' },
  { a: 'PB2',  b: 'PB3',  minutes: 3, line: '2' },
  { a: 'PB3',  b: 'PB4',  minutes: 2, line: '2' },
  { a: 'PB4',  b: 'PX',   minutes: 2, line: '2' },
  { a: 'PX',   b: 'PB5',  minutes: 3, line: '2' },
  { a: 'PB5',  b: 'PB6',  minutes: 2, line: '2' },
  { a: 'PB6',  b: 'PB7',  minutes: 3, line: '2' },
  { a: 'PB7',  b: 'PB8',  minutes: 3, line: '2' },
  { a: 'PB8',  b: 'PB9',  minutes: 3, line: '2' },
  { a: 'PB9',  b: 'PB10', minutes: 4, line: '2' },
  { a: 'PB10', b: 'PB11', minutes: 5, line: '2' },
];

const LINE_NAMES: Record<string, string> = {
  G: 'Green Line', P: 'Purple Line', '1': 'Line 1', '2': 'Line 2',
};

const TRANSFER_MINUTES = 5; // interchange walk penalty

// ── Adjacency map (built once at module load) ─────────────────────────────────

const ADJ: Map<string, { to: string; minutes: number; line: string }[]> = new Map();
for (const s of STATIONS) ADJ.set(s.id, []);
for (const e of EDGES) {
  ADJ.get(e.a)!.push({ to: e.b, minutes: e.minutes, line: e.line });
  ADJ.get(e.b)!.push({ to: e.a, minutes: e.minutes, line: e.line });
}

// Edge time lookup for leg calculation
const EDGE_TIME: Map<string, number> = new Map();
for (const e of EDGES) {
  EDGE_TIME.set(`${e.a}:${e.b}`, e.minutes);
  EDGE_TIME.set(`${e.b}:${e.a}`, e.minutes);
}

// ── Routing ───────────────────────────────────────────────────────────────────

function dijkstra(
  fromId: string,
  toId: string,
): { path: string[]; linePerEdge: string[]; totalMinutes: number } | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, { id: string; line: string }>();
  const visited = new Set<string>();

  for (const s of STATIONS) dist.set(s.id, Infinity);
  dist.set(fromId, 0);

  while (true) {
    // Pick unvisited node with smallest distance
    let u: string | null = null;
    let uDist = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < uDist) { uDist = d; u = id; }
    }
    if (u === null || uDist === Infinity) break;
    if (u === toId) break;
    visited.add(u);

    const uLine = prev.get(u)?.line ?? null;
    for (const { to, minutes, line } of (ADJ.get(u) ?? [])) {
      if (visited.has(to)) continue;
      // Add transfer penalty when changing lines at an interchange
      const penalty = (uLine !== null && uLine !== line) ? TRANSFER_MINUTES : 0;
      const alt = uDist + minutes + penalty;
      if (alt < (dist.get(to) ?? Infinity)) {
        dist.set(to, alt);
        prev.set(to, { id: u, line });
      }
    }
  }

  const totalMinutes = dist.get(toId) ?? Infinity;
  if (totalMinutes === Infinity) return null;

  // Reconstruct path
  const path: string[] = [];
  const linePerEdge: string[] = [];
  let cur = toId;
  while (cur !== fromId) {
    const p = prev.get(cur);
    if (!p) return null;
    path.unshift(cur);
    linePerEdge.unshift(p.line);
    cur = p.id;
  }
  path.unshift(fromId);
  return { path, linePerEdge, totalMinutes };
}

function buildLegs(path: string[], linePerEdge: string[]): MetroLeg[] {
  if (path.length < 2) return [];
  const legs: MetroLeg[] = [];
  let legStart = 0;
  let legLine = linePerEdge[0];

  for (let i = 1; i <= linePerEdge.length; i++) {
    if (i === linePerEdge.length || linePerEdge[i] !== legLine) {
      let legMinutes = 0;
      for (let j = legStart; j < i; j++) {
        legMinutes += EDGE_TIME.get(`${path[j]}:${path[j + 1]}`) ?? 2;
      }
      const fromSt = STATIONS.find(s => s.id === path[legStart])!;
      const toSt   = STATIONS.find(s => s.id === path[i])!;
      legs.push({
        lineName: LINE_NAMES[legLine] ?? legLine,
        from:     fromSt.name,
        to:       toSt.name,
        stops:    i - legStart,
        minutes:  legMinutes,
      });
      legStart = i;
      if (i < linePerEdge.length) legLine = linePerEdge[i];
    }
  }
  return legs;
}

// ── Station matching ──────────────────────────────────────────────────────────

function matchStation(query: string, city: 'bengaluru' | 'pune'): StationNode | undefined {
  const q = query.toLowerCase().trim();
  const cs = STATIONS.filter(s => s.city === city);
  return (
    cs.find(s => s.name.toLowerCase() === q || s.aliases?.some(a => a === q)) ??
    cs.find(s =>
      s.name.toLowerCase().includes(q) ||
      q.includes(s.name.toLowerCase()) ||
      s.aliases?.some(a => a.includes(q) || q.includes(a)),
    )
  );
}

function detectCity(text: string): 'bengaluru' | 'pune' | null {
  const t = text.toLowerCase();
  const blr = ['bengaluru', 'bangalore', 'blr', 'indiranagar', 'whitefield', 'mg road',
    'majestic', 'jayanagar', 'yeshwanthpur', 'kempegowda', 'koramangala', 'rajajinagar',
    'lalbagh', 'vijayanagar', 'attiguppe', 'mysore road', 'halasuru', 'ulsoor'];
  const pne = ['pune', 'pne', 'shivajinagar', 'deccan', 'hadapsar', 'kharadi',
    'pcmc', 'pimpri', 'swargate', 'magarpatta', 'khadki', 'dapodi', 'vanaz', 'ramwadi'];
  if (blr.some(k => t.includes(k))) return 'bengaluru';
  if (pne.some(k => t.includes(k))) return 'pune';
  return null;
}

// ── Fare slabs ────────────────────────────────────────────────────────────────

function calcFare(city: 'bengaluru' | 'pune', stops: number): number {
  if (city === 'bengaluru') {
    // BMRCL slabs (2025)
    if (stops <= 2)  return 10;
    if (stops <= 5)  return 20;
    if (stops <= 8)  return 30;
    if (stops <= 11) return 40;
    if (stops <= 15) return 50;
    if (stops <= 20) return 60;
    return 70;
  }
  // PMRDA Pune slabs (2025)
  if (stops <= 2)  return 10;
  if (stops <= 5)  return 20;
  if (stops <= 9)  return 30;
  if (stops <= 13) return 40;
  return 50;
}

// ── Main exports ──────────────────────────────────────────────────────────────

export function planMetro(origin: string, destination: string): MetroResult {
  const city = detectCity(`${origin} ${destination}`);
  if (!city) {
    return {
      city: 'unknown', origin, destination, found: false,
      error: 'Metro routing available for Bengaluru and Pune only.',
    };
  }

  const fromStation = matchStation(origin, city);
  const toStation   = matchStation(destination, city);

  if (!fromStation) {
    return { city, origin, destination, found: false, error: `Station not found: "${origin}". Try a nearby station name.` };
  }
  if (!toStation) {
    return { city, origin, destination, found: false, error: `Station not found: "${destination}". Try a nearby station name.` };
  }
  if (fromStation.id === toStation.id) {
    return { city, origin, destination, found: false, error: 'Origin and destination are the same station.' };
  }

  const result = dijkstra(fromStation.id, toStation.id);
  if (!result) {
    return { city, origin, destination, found: false, error: 'No metro route found between these stations.' };
  }

  const { path, linePerEdge, totalMinutes } = result;
  const stops = path.length - 1;
  const legs  = buildLegs(path, linePerEdge);
  const fare  = calcFare(city, stops);

  return {
    city:        city === 'bengaluru' ? 'Bengaluru' : 'Pune',
    origin:      fromStation.name,
    destination: toStation.name,
    found:       true,
    totalMinutes,
    fare,
    stops,
    legs,
  };
}

export function formatMetroForClaude(result: MetroResult): string {
  if (!result.found || !result.legs) {
    return `Metro: ${result.error ?? 'Route not found.'}`;
  }

  const legDescriptions = result.legs.map((leg, i) => {
    const transfer = i < result.legs!.length - 1 ? ' (change here)' : '';
    return `${leg.lineName}: ${leg.from} → ${leg.to}, ${leg.stops} stops, ${leg.minutes} min${transfer}`;
  });

  const transferCount = result.legs.length - 1;
  const transferNote  = transferCount > 0 ? ` Interchange at ${result.legs[0].to}.` : '';

  return [
    `${result.city} Metro: ${result.origin} → ${result.destination}`,
    legDescriptions.join(' | '),
    `Total: ${result.totalMinutes} min (incl. ${transferCount > 0 ? `${TRANSFER_MINUTES}min transfer` : 'no transfers'}). Fare: ₹${result.fare}.${transferNote}`,
    `Frequency: every 5–10 min (peak), 10–15 min (off-peak). No booking needed — turn up and go.`,
  ].join('\n');
}
