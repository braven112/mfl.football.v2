/**
 * Weather Utilities
 *
 * Functions and data for fetching and displaying weather information
 * for NFL games. Used in roster pages and matchup previews.
 */

/**
 * NFL Stadium coordinates for weather lookup
 * dome: true indicates indoor/retractable roof stadium
 */
export const NFL_STADIUMS: Record<string, { lat: number; lon: number; dome: boolean }> = {
  ARI: { lat: 33.5277, lon: -112.2626, dome: true },  // State Farm Stadium (retractable)
  ATL: { lat: 33.7553, lon: -84.4006, dome: true },   // Mercedes-Benz Stadium
  BAL: { lat: 39.2780, lon: -76.6227, dome: false },  // M&T Bank Stadium
  BUF: { lat: 42.7738, lon: -78.7870, dome: false },  // Highmark Stadium
  CAR: { lat: 35.2258, lon: -80.8528, dome: false },  // Bank of America Stadium
  CHI: { lat: 41.8623, lon: -87.6167, dome: false },  // Soldier Field
  CIN: { lat: 39.0954, lon: -84.5160, dome: false },  // Paycor Stadium
  CLE: { lat: 41.5061, lon: -81.6995, dome: false },  // Cleveland Browns Stadium
  DAL: { lat: 32.7473, lon: -97.0945, dome: true },   // AT&T Stadium
  DEN: { lat: 39.7439, lon: -105.0201, dome: false }, // Empower Field
  DET: { lat: 42.3400, lon: -83.0456, dome: true },   // Ford Field
  GB: { lat: 44.5013, lon: -88.0622, dome: false },   // Lambeau Field
  HOU: { lat: 29.6847, lon: -95.4107, dome: true },   // NRG Stadium (retractable)
  IND: { lat: 39.7601, lon: -86.1639, dome: true },   // Lucas Oil Stadium
  JAX: { lat: 30.3239, lon: -81.6373, dome: false },  // TIAA Bank Field
  KC: { lat: 39.0489, lon: -94.4839, dome: false },   // Arrowhead Stadium
  LV: { lat: 36.0909, lon: -115.1833, dome: true },   // Allegiant Stadium
  LAC: { lat: 33.9535, lon: -118.3392, dome: true },  // SoFi Stadium
  LAR: { lat: 33.9535, lon: -118.3392, dome: true },  // SoFi Stadium
  MIA: { lat: 25.9580, lon: -80.2389, dome: false },  // Hard Rock Stadium
  MIN: { lat: 44.9736, lon: -93.2575, dome: true },   // U.S. Bank Stadium
  NE: { lat: 42.0909, lon: -71.2643, dome: false },   // Gillette Stadium
  NO: { lat: 29.9511, lon: -90.0812, dome: true },    // Caesars Superdome
  NYG: { lat: 40.8128, lon: -74.0742, dome: false },  // MetLife Stadium
  NYJ: { lat: 40.8128, lon: -74.0742, dome: false },  // MetLife Stadium
  PHI: { lat: 39.9008, lon: -75.1675, dome: false },  // Lincoln Financial Field
  PIT: { lat: 40.4468, lon: -80.0158, dome: false },  // Acrisure Stadium
  SF: { lat: 37.4033, lon: -121.9694, dome: false },  // Levi's Stadium
  SEA: { lat: 47.5952, lon: -122.3316, dome: false }, // Lumen Field
  TB: { lat: 27.9759, lon: -82.5033, dome: false },   // Raymond James Stadium
  TEN: { lat: 36.1665, lon: -86.7713, dome: false },  // Nissan Stadium
  WAS: { lat: 38.9076, lon: -76.8645, dome: false },  // FedExField
};

/**
 * WMO weather code to description mapping
 */
const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly Clear',
  2: 'Partly Cloudy',
  3: 'Cloudy',
  45: 'Fog',
  48: 'Fog',
  51: 'Light Rain',
  53: 'Rain',
  55: 'Heavy Rain',
  61: 'Light Rain',
  63: 'Rain',
  65: 'Heavy Rain',
  66: 'Freezing Rain',
  67: 'Freezing Rain',
  71: 'Light Snow',
  73: 'Snow',
  75: 'Heavy Snow',
  77: 'Snow',
  80: 'Rain Showers',
  81: 'Rain Showers',
  82: 'Heavy Rain',
  85: 'Snow Showers',
  86: 'Snow Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Thunderstorm',
};

export interface WeatherData {
  temperature: number;
  displayValue: string;
}

/**
 * Get weather emoji icon based on condition text
 */
export function getWeatherIcon(displayValue: string | undefined): string {
  if (!displayValue) return '🌡️';

  const condition = displayValue.toLowerCase();

  if (condition.includes('thunder') || condition.includes('storm')) return '⛈️';
  if (condition.includes('snow') || condition.includes('flurr')) return '❄️';
  if (condition.includes('rain') || condition.includes('shower')) return '🌧️';
  if (condition.includes('fog') || condition.includes('mist') || condition.includes('haze')) return '🌫️';
  if (condition.includes('wind')) return '💨';
  if (condition.includes('overcast') || condition === 'cloudy') return '☁️';
  if (condition.includes('partly') || condition.includes('mostly cloudy') || condition.includes('intermittent')) return '⛅';
  if (condition.includes('clear') || condition.includes('sunny') || condition.includes('fair')) return '☀️';
  if (condition === 'dome') return '🏟️';

  return '🌡️'; // Default fallback
}

/**
 * Fetch live weather from Open-Meteo API for a given NFL team
 * Returns dome conditions for indoor stadiums
 */
export async function fetchLiveWeather(teamCode: string): Promise<WeatherData | null> {
  const stadium = NFL_STADIUMS[teamCode];
  if (!stadium) return null;

  // Dome stadiums don't need weather
  if (stadium.dome) {
    return { temperature: 72, displayValue: 'Dome' };
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${stadium.lat}&longitude=${stadium.lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const temp = Math.round(data.current?.temperature_2m || 0);
    const weatherCode = data.current?.weather_code || 0;

    return {
      temperature: temp,
      displayValue: WEATHER_CODE_DESCRIPTIONS[weatherCode] || 'Unknown',
    };
  } catch (error) {
    console.warn(`[weather] Failed to fetch weather for ${teamCode}:`, error);
    return null;
  }
}

/**
 * Check if a team plays in a dome stadium
 */
export function isDomeStadium(teamCode: string): boolean {
  return NFL_STADIUMS[teamCode]?.dome ?? false;
}
