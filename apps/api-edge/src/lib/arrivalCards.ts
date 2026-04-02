/**
 * arrivalCards.ts — Proactive cards shown when user is ~30-60 min from destination
 *
 * Returns contextual ProactiveCard[] based on journey details.
 * No external API calls — pure logic, edge-compatible.
 */

import type { ProactiveCard } from '../../../../packages/bro-trip/index';

export interface ArrivalContext {
  destination: string;
  destinationLat?: number;
  destinationLon?: number;
  arrivalTime?: string;   // HH:MM
  departureDatetime?: string; // ISO
  operator?: string;
  country?: string;
}

// Operator-specific boarding tips for UK rail
const OPERATOR_BOARDING_TIPS: Record<string, string> = {
  'Avanti West Coast': 'Quiet coach is Coach D. Bike storage at the rear of the train.',
  'Avanti':            'Quiet coach is Coach D. Bike storage at the rear of the train.',
  'LNER':              'Quiet coach is Coach H. First class at the front.',
  'GWR':               'Standard carriages are mid-train. Catering in Coach C.',
  'Great Western':     'Standard carriages are mid-train. Catering in Coach C.',
  'Thameslink':        'Short stop — doors open for about 30 seconds. Stand ready.',
  'Southern':          'Stand clear of the yellow line. Doors open on both sides at some stations.',
  'CrossCountry':      'CrossCountry: quiet coach is usually Coach A. Bikes in Coach D.',
  'TransPennine':      'TransPennine: standard class in the middle. First class at front.',
  'Chiltern':          'Chiltern: standard at rear. First class at front. Quiet coach in first class.',
  'c2c':               'c2c: short platform stops — be ready before the train arrives.',
  'Southeastern':      'Southeastern: standard class mid-train. Quiet zone in rear coach.',
  'East Midlands':     'East Midlands: first class at front. Quiet coach adjacent to first class.',
};

// Major UK termini with platform exit tips
const STATION_EXIT_TIPS: Record<string, string> = {
  'London Euston':        'Euston: main exit is via the concourse north end. Taxi rank outside.',
  'London Kings Cross':   "King's Cross: Tube is underground — follow signs to St Pancras/King's Cross.",
  'London St Pancras':    'St Pancras: Eurostar arrivals on upper level. Tube and Thameslink below.',
  'London Paddington':    'Paddington: Elizabeth line and Bakerloo direct from the station.',
  'London Victoria':      'Victoria: buses and coach station directly outside. Gatwick Express from here.',
  'London Waterloo':      'Waterloo: main exit faces the South Bank. Jubilee, Bakerloo, Northern lines below.',
  'Manchester Piccadilly': 'Piccadilly: tram stop (Metrolink) on platform level. Taxi rank outside.',
  'Edinburgh Waverley':   'Waverley: exit to Princes Street (north) or Royal Mile (south).',
  'Glasgow Central':      'Central: taxis on Union Street. Subway entrance on St Enoch Square.',
  'Birmingham New Street': 'New Street: Grand Central shopping centre is above the station.',
  'Bristol Temple Meads': 'Temple Meads: taxi rank outside. City centre is a 10-min walk.',
  'Leeds':                'Leeds: bus station is a 5-min walk. Taxi rank on New Station Street.',
  'Liverpool Lime Street': 'Lime Street: city centre is right outside. Moorfields for Tube connections.',
  'Newcastle':            'Newcastle: Metro (underground) accessible from the concourse.',
  'Sheffield':            'Sheffield: tram stop on Sheaf Square, directly outside.',
};

// Cities where hotel check-in reminder is relevant
const HOTEL_CITIES = new Set([
  'london', 'manchester', 'edinburgh', 'glasgow', 'birmingham',
  'bristol', 'leeds', 'liverpool', 'newcastle', 'sheffield',
  'paris', 'amsterdam', 'berlin', 'rome', 'barcelona', 'madrid',
  'new york', 'los angeles', 'chicago', 'toronto', 'sydney',
  'dubai', 'singapore', 'tokyo', 'bangkok', 'mumbai', 'delhi',
]);

function normaliseDest(dest: string): string {
  return dest.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
}

export function buildArrivalCards(ctx: ArrivalContext): ProactiveCard[] {
  const cards: ProactiveCard[] = [];
  const { destination, arrivalTime, operator, country } = ctx;
  const destNorm = normaliseDest(destination);

  // ── Arrival time card ────────────────────────────────────────────────────
  if (arrivalTime) {
    const exitTip = STATION_EXIT_TIPS[destination];
    cards.push({
      id:       'arrival-time',
      kind:     'arrival_tip',
      title:    `Arriving at ${arrivalTime}`,
      body:     exitTip ?? `Arriving at ${destination} at ${arrivalTime}. Ask Ace what to do next.`,
      severity: 'info',
      ctaLabel: 'Ask Ace',
    });
  } else {
    // Fallback if no arrival time known
    const exitTip = STATION_EXIT_TIPS[destination];
    if (exitTip) {
      cards.push({
        id:       'station-exit',
        kind:     'arrival_tip',
        title:    `${destination} — exit tips`,
        body:     exitTip,
        severity: 'info',
      });
    }
  }

  // ── Operator boarding tip ────────────────────────────────────────────────
  if (operator && (country === 'uk' || !country)) {
    // Try exact match first, then partial
    const operatorKey = Object.keys(OPERATOR_BOARDING_TIPS).find(
      (k) => operator.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(operator.toLowerCase()),
    );
    if (operatorKey) {
      cards.push({
        id:       'operator-tip',
        kind:     'boarding_tip',
        title:    `${operatorKey} tip`,
        body:     OPERATOR_BOARDING_TIPS[operatorKey],
        severity: 'info',
      });
    }
  }

  // ── Hotel check-in reminder for city destinations ────────────────────────
  const isHotelCity = [...HOTEL_CITIES].some(
    (city) => destNorm.includes(city) || city.includes(destNorm),
  );
  if (isHotelCity) {
    cards.push({
      id:       'hotel-checkin',
      kind:     'check_in',
      title:    'Hotel check-in reminder',
      body:     'Most hotels accept bags from 10:00. Standard check-in is 15:00 — early check-in usually free if a room is ready.',
      severity: 'info',
      ctaLabel: 'Find my hotel',
    });
  }

  // ── Generic "ask Ace" discovery card ─────────────────────────────────────
  // Only add if we have fewer than 2 cards already (avoid noise)
  if (cards.length < 2) {
    cards.push({
      id:       'discover-destination',
      kind:     'destination_suggestion',
      title:    `What's near ${destination}?`,
      body:     `Ask Ace for coffee, food, transport, or anything else when you arrive.`,
      severity: 'info',
      ctaLabel: 'Ask Ace',
    });
  }

  return cards;
}
