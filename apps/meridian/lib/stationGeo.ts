/**
 * stationGeo.ts — UK station lat/lon database for nearest-station detection
 *
 * Covers ~80 major UK stations. Used client-side — no server call needed.
 * Coordinates sourced from National Rail / OS data (±100m accuracy is fine).
 */

export interface StationGeo {
  name: string;  // Display name
  crs:  string;  // 3-letter CRS code
  lat:  number;
  lon:  number;
}

export const UK_STATIONS: StationGeo[] = [
  // London terminals
  { name: 'London St Pancras',      crs: 'STP', lat: 51.5309, lon: -0.1233 },
  { name: 'London Euston',          crs: 'EUS', lat: 51.5282, lon: -0.1337 },
  { name: "London King's Cross",    crs: 'KGX', lat: 51.5308, lon: -0.1238 },
  { name: 'London Paddington',      crs: 'PAD', lat: 51.5154, lon: -0.1755 },
  { name: 'London Waterloo',        crs: 'WAT', lat: 51.5036, lon: -0.1136 },
  { name: 'London Victoria',        crs: 'VIC', lat: 51.4952, lon: -0.1441 },
  { name: 'London Bridge',          crs: 'LBG', lat: 51.5053, lon: -0.0864 },
  { name: 'London Liverpool Street',crs: 'LST', lat: 51.5178, lon: -0.0823 },
  { name: 'London Marylebone',      crs: 'MYB', lat: 51.5224, lon: -0.1631 },
  { name: 'London Cannon Street',   crs: 'CST', lat: 51.5113, lon: -0.0904 },
  { name: 'London Charing Cross',   crs: 'CHX', lat: 51.5077, lon: -0.1243 },
  { name: 'London Blackfriars',     crs: 'BFR', lat: 51.5119, lon: -0.1039 },
  { name: 'London Fenchurch Street',crs: 'FST', lat: 51.5121, lon: -0.0780 },
  { name: 'Stratford',              crs: 'SRA', lat: 51.5415, lon: -0.0036 },

  // South East
  { name: 'Brighton',               crs: 'BTN', lat: 50.8290, lon: -0.1411 },
  { name: 'Gatwick Airport',        crs: 'GTW', lat: 51.1564, lon: -0.1614 },
  { name: 'Guildford',              crs: 'GLD', lat: 51.2361, lon: -0.5804 },
  { name: 'Reading',                crs: 'RDG', lat: 51.4585, lon: -0.9710 },
  { name: 'Oxford',                 crs: 'OXF', lat: 51.7535, lon: -1.2696 },
  { name: 'Cambridge',              crs: 'CBG', lat: 52.1947, lon: 0.1376  },
  { name: 'Ipswich',                crs: 'IPS', lat: 52.0508, lon: 1.1436  },
  { name: 'Norwich',                crs: 'NRW', lat: 52.6265, lon: 1.3068  },
  { name: 'Southend Central',       crs: 'SOC', lat: 51.5366, lon: 0.7094  },
  { name: 'Folkestone Central',     crs: 'FKC', lat: 51.0806, lon: 1.1741  },
  { name: 'Dover Priory',           crs: 'DVP', lat: 51.1232, lon: 1.3106  },
  { name: 'Hastings',               crs: 'HGS', lat: 50.8581, lon: 0.5760  },
  { name: 'Eastbourne',             crs: 'EBN', lat: 50.7704, lon: 0.2757  },
  { name: 'Worthing',               crs: 'WRH', lat: 50.8145, lon: -0.3713 },
  { name: 'Portsmouth Harbour',     crs: 'PMH', lat: 50.7982, lon: -1.1077 },
  { name: 'Southampton Central',    crs: 'SOU', lat: 50.9098, lon: -1.4135 },
  { name: 'Basingstoke',            crs: 'BSK', lat: 51.2664, lon: -1.0868 },
  { name: 'Woking',                 crs: 'WOK', lat: 51.3196, lon: -0.5576 },

  // South West
  { name: 'Bath Spa',               crs: 'BTH', lat: 51.3780, lon: -2.3590 },
  { name: 'Bristol Temple Meads',   crs: 'BRI', lat: 51.4491, lon: -2.5813 },
  { name: 'Bristol Parkway',        crs: 'BPW', lat: 51.5085, lon: -2.5427 },
  { name: 'Swindon',                crs: 'SWI', lat: 51.5635, lon: -1.7845 },
  { name: 'Exeter St Davids',       crs: 'EXD', lat: 50.7247, lon: -3.5352 },
  { name: 'Plymouth',               crs: 'PLY', lat: 50.3782, lon: -4.1428 },
  { name: 'Truro',                  crs: 'TRU', lat: 50.2602, lon: -5.0519 },
  { name: 'Bournemouth',            crs: 'BMH', lat: 50.7251, lon: -1.8636 },
  { name: 'Salisbury',              crs: 'SAL', lat: 51.0678, lon: -1.7980 },

  // Midlands
  { name: 'Birmingham New Street',  crs: 'BHM', lat: 52.4775, lon: -1.9001 },
  { name: 'Birmingham Moor Street', crs: 'BMO', lat: 52.4785, lon: -1.8941 },
  { name: 'Birmingham International',crs:'BHI', lat: 52.4508, lon: -1.7270 },
  { name: 'Coventry',               crs: 'COV', lat: 52.4003, lon: -1.5129 },
  { name: 'Wolverhampton',          crs: 'WVH', lat: 52.5890, lon: -2.1258 },
  { name: 'Derby',                  crs: 'DBY', lat: 52.9152, lon: -1.4655 },
  { name: 'Nottingham',             crs: 'NOT', lat: 52.9474, lon: -1.1459 },
  { name: 'Leicester',              crs: 'LEI', lat: 52.6330, lon: -1.1267 },
  { name: 'Northampton',            crs: 'NMP', lat: 52.2339, lon: -0.8981 },
  { name: 'Milton Keynes Central',  crs: 'MKC', lat: 52.0327, lon: -0.7683 },
  { name: 'Shrewsbury',             crs: 'SHR', lat: 52.7120, lon: -2.7516 },
  { name: 'Stoke-on-Trent',        crs: 'SOT', lat: 53.0017, lon: -2.1775 },

  // North West
  { name: 'Manchester Piccadilly',  crs: 'MAN', lat: 53.4773, lon: -2.2309 },
  { name: 'Manchester Victoria',    crs: 'MCV', lat: 53.4871, lon: -2.2424 },
  { name: 'Manchester Airport',     crs: 'MIA', lat: 53.3655, lon: -2.2731 },
  { name: 'Liverpool Lime Street',  crs: 'LIV', lat: 53.4072, lon: -2.9775 },
  { name: 'Preston',                crs: 'PRE', lat: 53.7575, lon: -2.7094 },
  { name: 'Blackpool North',        crs: 'BPN', lat: 53.8209, lon: -3.0555 },
  { name: 'Chester',                crs: 'CTR', lat: 53.1919, lon: -2.8799 },
  { name: 'Wigan North Western',    crs: 'WGN', lat: 53.5460, lon: -2.6353 },
  { name: 'Bolton',                 crs: 'BON', lat: 53.5782, lon: -2.4291 },

  // Yorkshire & Humber
  { name: 'Leeds',                  crs: 'LDS', lat: 53.7952, lon: -1.5477 },
  { name: 'Sheffield',              crs: 'SHF', lat: 53.3779, lon: -1.4624 },
  { name: 'York',                   crs: 'YRK', lat: 53.9580, lon: -1.0933 },
  { name: 'Bradford Forster Square',crs: 'BDQ', lat: 53.7950, lon: -1.7496 },
  { name: 'Hull',                   crs: 'HUL', lat: 53.7442, lon: -0.3469 },
  { name: 'Doncaster',              crs: 'DON', lat: 53.5206, lon: -1.1410 },
  { name: 'Wakefield Westgate',     crs: 'WKF', lat: 53.6819, lon: -1.5011 },

  // North East
  { name: 'Newcastle',              crs: 'NCL', lat: 54.9683, lon: -1.6178 },
  { name: 'Sunderland',             crs: 'SUN', lat: 54.9071, lon: -1.3800 },
  { name: 'Durham',                 crs: 'DHM', lat: 54.7779, lon: -1.5771 },
  { name: 'Middlesbrough',          crs: 'MBR', lat: 54.5762, lon: -1.2364 },
  { name: 'Darlington',             crs: 'DAR', lat: 54.5240, lon: -1.5554 },

  // Scotland
  { name: 'Edinburgh Waverley',     crs: 'EDB', lat: 55.9521, lon: -3.1896 },
  { name: 'Edinburgh Haymarket',    crs: 'EHM', lat: 55.9458, lon: -3.2186 },
  { name: 'Glasgow Central',        crs: 'GLC', lat: 55.8584, lon: -4.2568 },
  { name: 'Glasgow Queen Street',   crs: 'GLQ', lat: 55.8634, lon: -4.2509 },
  { name: 'Aberdeen',               crs: 'ABD', lat: 57.1437, lon: -2.0991 },
  { name: 'Dundee',                 crs: 'DEE', lat: 56.4566, lon: -2.9712 },
  { name: 'Inverness',              crs: 'INV', lat: 57.4773, lon: -4.2231 },
  { name: 'Perth',                  crs: 'PTH', lat: 56.3963, lon: -3.4403 },
  { name: 'Stirling',               crs: 'STG', lat: 56.1181, lon: -3.9369 },

  // Wales
  { name: 'Cardiff Central',        crs: 'CDF', lat: 51.4754, lon: -3.1791 },
  { name: 'Newport',                crs: 'NWP', lat: 51.5842, lon: -2.9978 },
  { name: 'Swansea',                crs: 'SWA', lat: 51.6217, lon: -3.9444 },
];

// ── Haversine distance (km) ───────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Returns the nearest station within maxKm (default 30km).
 * Returns null if nothing is within range (user is not near a station).
 */
export function findNearestStation(
  lat: number,
  lon: number,
  maxKm = 30,
): StationGeo | null {
  let best: StationGeo | null = null;
  let bestDist = Infinity;
  for (const station of UK_STATIONS) {
    const d = haversineKm(lat, lon, station.lat, station.lon);
    if (d < bestDist) { bestDist = d; best = station; }
  }
  return best && bestDist <= maxKm ? best : null;
}
