export interface StationGeo {
  name: string;
  crs: string;
  lat: number;
  lon: number;
}

export const UK_STATIONS: StationGeo[] = [
  { name: 'London St Pancras', crs: 'STP', lat: 51.5308, lon: -0.1260 },
  { name: 'London Euston', crs: 'EUS', lat: 51.5282, lon: -0.1337 },
  { name: 'London Kings Cross', crs: 'KGX', lat: 51.5304, lon: -0.1232 },
  { name: 'London Paddington', crs: 'PAD', lat: 51.5154, lon: -0.1755 },
  { name: 'London Waterloo', crs: 'WAT', lat: 51.5036, lon: -0.1136 },
  { name: 'London Victoria', crs: 'VIC', lat: 51.4952, lon: -0.1441 },
  { name: 'London Bridge', crs: 'LBG', lat: 51.5053, lon: -0.0864 },
  { name: 'London Liverpool Street', crs: 'LST', lat: 51.5178, lon: -0.0823 },
  { name: 'London Charing Cross', crs: 'CHX', lat: 51.5074, lon: -0.1248 },
  { name: 'London Cannon Street', crs: 'CST', lat: 51.5113, lon: -0.0904 },
  { name: 'London Blackfriars', crs: 'BFR', lat: 51.5119, lon: -0.1039 },
  { name: 'London Fenchurch Street', crs: 'FST', lat: 51.5116, lon: -0.0786 },
  { name: 'Manchester Piccadilly', crs: 'MAN', lat: 53.4773, lon: -2.2309 },
  { name: 'Manchester Victoria', crs: 'MCV', lat: 53.4871, lon: -2.2424 },
  { name: 'Manchester Airport', crs: 'MIA', lat: 53.3655, lon: -2.2721 },
  { name: 'Birmingham New Street', crs: 'BHM', lat: 52.4775, lon: -1.8983 },
  { name: 'Birmingham Moor Street', crs: 'BMO', lat: 52.4790, lon: -1.8917 },
  { name: 'Birmingham International', crs: 'BHI', lat: 52.4496, lon: -1.7252 },
  { name: 'Leeds', crs: 'LDS', lat: 53.7952, lon: -1.5477 },
  { name: 'Sheffield', crs: 'SHF', lat: 53.3781, lon: -1.4628 },
  { name: 'Liverpool Lime Street', crs: 'LIV', lat: 53.4078, lon: -2.9775 },
  { name: 'Liverpool Central', crs: 'LVC', lat: 53.4044, lon: -2.9778 },
  { name: 'Bristol Temple Meads', crs: 'BRI', lat: 51.4491, lon: -2.5813 },
  { name: 'Bristol Parkway', crs: 'BPW', lat: 51.5139, lon: -2.5429 },
  { name: 'Cardiff Central', crs: 'CDF', lat: 51.4755, lon: -3.1791 },
  { name: 'Cardiff Queen Street', crs: 'CDQ', lat: 51.4817, lon: -3.1715 },
  { name: 'Edinburgh Waverley', crs: 'EDB', lat: 55.9522, lon: -3.1893 },
  { name: 'Edinburgh Haymarket', crs: 'EHM', lat: 55.9458, lon: -3.2185 },
  { name: 'Glasgow Central', crs: 'GLC', lat: 55.8584, lon: -4.2580 },
  { name: 'Glasgow Queen Street', crs: 'GLQ', lat: 55.8626, lon: -4.2514 },
  { name: 'Newcastle', crs: 'NCL', lat: 54.9683, lon: -1.6174 },
  { name: 'Sunderland', crs: 'SUN', lat: 54.9069, lon: -1.3821 },
  { name: 'Middlesbrough', crs: 'MBR', lat: 54.5762, lon: -1.2364 },
  { name: 'York', crs: 'YRK', lat: 53.9580, lon: -1.0933 },
  { name: 'Harrogate', crs: 'HGT', lat: 53.9918, lon: -1.5370 },
  { name: 'Nottingham', crs: 'NOT', lat: 52.9470, lon: -1.1464 },
  { name: 'Derby', crs: 'DBY', lat: 52.9165, lon: -1.4635 },
  { name: 'Leicester', crs: 'LEI', lat: 52.6314, lon: -1.1245 },
  { name: 'Coventry', crs: 'COV', lat: 52.4008, lon: -1.5135 },
  { name: 'Wolverhampton', crs: 'WVH', lat: 52.5872, lon: -2.1195 },
  { name: 'Oxford', crs: 'OXF', lat: 51.7532, lon: -1.2701 },
  { name: 'Reading', crs: 'RDG', lat: 51.4586, lon: -0.9717 },
  { name: 'Brighton', crs: 'BTN', lat: 50.8293, lon: -0.1411 },
  { name: 'Gatwick Airport', crs: 'GTW', lat: 51.1564, lon: -0.1617 },
  { name: 'Luton Airport Parkway', crs: 'LTN', lat: 51.8817, lon: -0.2173 },
  { name: 'Stansted Airport', crs: 'SSD', lat: 51.8898, lon: 0.2615 },
  { name: 'Cambridge', crs: 'CBG', lat: 52.1945, lon: 0.1377 },
  { name: 'Norwich', crs: 'NRW', lat: 52.6271, lon: 1.3068 },
  { name: 'Ipswich', crs: 'IPS', lat: 52.0505, lon: 1.1442 },
  { name: 'Peterborough', crs: 'PBO', lat: 52.5748, lon: -0.2502 },
  { name: 'Southampton Central', crs: 'SOU', lat: 50.9096, lon: -1.4138 },
  { name: 'Portsmouth Harbour', crs: 'PMH', lat: 50.7978, lon: -1.1080 },
  { name: 'Bournemouth', crs: 'BMH', lat: 50.7272, lon: -1.8645 },
  { name: 'Exeter St Davids', crs: 'EXD', lat: 50.7293, lon: -3.5430 },
  { name: 'Plymouth', crs: 'PLY', lat: 50.3782, lon: -4.1432 },
  { name: 'Truro', crs: 'TRU', lat: 50.2631, lon: -5.0647 },
  { name: 'Bath Spa', crs: 'BTH', lat: 51.3780, lon: -2.3569 },
  { name: 'Swindon', crs: 'SWI', lat: 51.5654, lon: -1.7857 },
  { name: 'Cheltenham Spa', crs: 'CNM', lat: 51.8971, lon: -2.1008 },
  { name: 'Gloucester', crs: 'GCR', lat: 51.8656, lon: -2.2389 },
  { name: 'Stoke-on-Trent', crs: 'SOT', lat: 53.0033, lon: -2.1794 },
  { name: 'Crewe', crs: 'CRE', lat: 53.0897, lon: -2.4338 },
  { name: 'Chester', crs: 'CTR', lat: 53.1968, lon: -2.8804 },
  { name: 'Wrexham General', crs: 'WRX', lat: 53.0451, lon: -2.9925 },
  { name: 'Carlisle', crs: 'CAR', lat: 54.8926, lon: -2.9332 },
  { name: 'Preston', crs: 'PRE', lat: 53.7552, lon: -2.7074 },
  { name: 'Blackpool North', crs: 'BPN', lat: 53.8219, lon: -3.0493 },
  { name: 'Wigan North Western', crs: 'WGN', lat: 53.5446, lon: -2.6326 },
  { name: 'Huddersfield', crs: 'HUD', lat: 53.6486, lon: -1.7852 },
  { name: 'Bradford Forster Square', crs: 'BDQ', lat: 53.7950, lon: -1.7516 },
  { name: 'Hull', crs: 'HUL', lat: 53.7442, lon: -0.3454 },
  { name: 'Doncaster', crs: 'DON', lat: 53.5228, lon: -1.1398 },
  { name: 'Grantham', crs: 'GRA', lat: 52.9066, lon: -0.6408 },
  { name: 'Lincoln Central', crs: 'LIN', lat: 53.2178, lon: -0.5404 },
  { name: 'Stockport', crs: 'SPT', lat: 53.4044, lon: -2.1624 },
  { name: 'Bolton', crs: 'BON', lat: 53.5776, lon: -2.4258 },
  { name: 'Swansea', crs: 'SWA', lat: 51.6252, lon: -3.9416 },
  { name: 'Newport', crs: 'NWP', lat: 51.5888, lon: -2.9980 },
  { name: 'Shrewsbury', crs: 'SHR', lat: 52.7113, lon: -2.7487 },
  { name: 'Hereford', crs: 'HFD', lat: 52.0567, lon: -2.7086 },
  { name: 'Salisbury', crs: 'SAL', lat: 51.0701, lon: -1.8061 },
  { name: 'Winchester', crs: 'WIN', lat: 51.0671, lon: -1.3197 },
  { name: 'Guildford', crs: 'GLD', lat: 51.2364, lon: -0.5819 },
  { name: 'Woking', crs: 'WOK', lat: 51.3190, lon: -0.5573 },
  { name: 'Basingstoke', crs: 'BSK', lat: 51.2681, lon: -1.0871 },
];

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findNearestStation(lat: number, lon: number): StationGeo {
  let nearest = UK_STATIONS[0];
  let nearestDistance = haversineKm(lat, lon, nearest.lat, nearest.lon);

  for (let i = 1; i < UK_STATIONS.length; i += 1) {
    const station = UK_STATIONS[i];
    const distance = haversineKm(lat, lon, station.lat, station.lon);
    if (distance < nearestDistance) {
      nearest = station;
      nearestDistance = distance;
    }
  }

  return nearest;
}
