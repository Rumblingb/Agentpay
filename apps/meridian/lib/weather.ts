export interface WeatherData {
  tempC: number;
  description: string;
  windKph: number;
  weatherCode: number;
}

interface GeocodingResponse {
  results?: Array<{
    latitude: number;
    longitude: number;
  }>;
}

interface ForecastResponse {
  current?: {
    temperature_2m?: number;
    weathercode?: number;
    windspeed_10m?: number;
  };
}

function describeWeather(code: number): string {
  if (code === 0) return 'Clear';
  if (code >= 1 && code <= 3) return 'Cloudy';
  if (code >= 45 && code <= 48) return 'Fog';
  if (code >= 51 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 95 && code <= 99) return 'Storm';
  return 'Clear';
}

export async function fetchWeatherForStation(stationName: string): Promise<WeatherData | null> {
  const query = stationName.trim();
  if (!query) return null;

  try {
    const geocodeRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`,
    );
    if (!geocodeRes.ok) return null;

    const geocode = await geocodeRes.json() as GeocodingResponse;
    const match = geocode.results?.[0];
    if (!match) return null;

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${match.latitude}&longitude=${match.longitude}&current=temperature_2m,weathercode,windspeed_10m&timezone=auto`,
    );
    if (!weatherRes.ok) return null;

    const forecast = await weatherRes.json() as ForecastResponse;
    const current = forecast.current;
    if (
      typeof current?.temperature_2m !== 'number' ||
      typeof current.weathercode !== 'number' ||
      typeof current.windspeed_10m !== 'number'
    ) {
      return null;
    }

    return {
      tempC: current.temperature_2m,
      description: describeWeather(current.weathercode),
      windKph: current.windspeed_10m,
      weatherCode: current.weathercode,
    };
  } catch {
    return null;
  }
}
