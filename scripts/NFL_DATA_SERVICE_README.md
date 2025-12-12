# NFL Data Service

Comprehensive API integration for fetching real-time NFL data including schedules, weather, and defensive rankings.

## Features

### ✅ Implemented

1. **ESPN API Integration**
   - Real-time NFL schedule for any week
   - Game times with timezone conversion
   - Broadcast network information (ABC, CBS, FOX, ESPN, NBC, Prime Video)
   - Stadium information (indoor/outdoor status)
   - Team abbreviation mapping (ESPN → MFL format)

2. **Weather.gov API Integration**
   - Real-time weather forecasts by stadium location
   - Temperature and conditions for outdoor games
   - Indoor stadium detection (no weather needed)
   - Stadium coordinate database for all 32 NFL teams
   - Weather icons: 🏟️ (dome), ☀️ (clear), 🌧️ (rain), 🌨️ (snow), ☁️ (cloudy), ⛅ (partly cloudy), ⛈️ (thunderstorm)

3. **TV Network Logo Integration**
   - Maps network names to logo files in `/assets/tv-logos/`
   - Supported networks: ABC, CBS, ESPN, FOX, NBC, Prime Video, Netflix, YouTube TV
   - Fallback handling for unsupported networks

4. **Defensive Rankings**
   - Rankings by position: QB, RB, WR, TE
   - Lower rank = tougher defense (1 = best defense, 32 = worst)
   - Currently using cached 2024 data
   - Ready for FantasyPros API integration

5. **Data Caching**
   - 1-hour cache for API responses
   - Saves to `data/theleague/nfl-cache/`
   - Reduces API calls and improves performance

## Usage

### Quick Start

```javascript
import { buildCompleteNFLData } from './nfl-data-service.mjs';

// Fetch complete NFL data for a specific week
const nflData = await buildCompleteNFLData(2024, 15);

console.log(nflData);
// {
//   year: 2024,
//   week: 15,
//   schedule: { 'BUF': 'DET', 'DET': 'BUF', ... },
//   gameDetails: {
//     'BUF_vs_DET': {
//       time: '4:25 PM PST',
//       day: 'Sun',
//       channel: 'CBS',
//       channelLogo: 'cbs-nfl-us.png',
//       weather: '🏟️',
//       temp: '72°',
//       conditions: 'Dome',
//       venue: { ... }
//     }
//   },
//   defensiveRankings: {
//     QB: { 'DET': 3, 'BUF': 5, ... },
//     RB: { 'PIT': 2, 'DET': 4, ... },
//     WR: { 'BUF': 3, 'DET': 5, ... },
//     TE: { 'BUF': 2, 'PIT': 4, ... }
//   },
//   fetchedAt: '2024-12-12T06:31:07.504Z',
//   sources: {
//     schedule: 'ESPN API',
//     weather: 'Weather.gov API',
//     rankings: 'Cached (TODO: FantasyPros API)'
//   }
// }
```

### Individual Functions

```javascript
import {
  fetchNFLSchedule,
  fetchWeatherForGames,
  fetchDefensiveRankings,
  getTVLogoPath
} from './nfl-data-service.mjs';

// Get just the schedule
const schedule = await fetchNFLSchedule(2024, 15);

// Get weather for specific games
const weather = await fetchWeatherForGames(schedule.games);

// Get defensive rankings
const rankings = await fetchDefensiveRankings(2024, 15);

// Get TV logo path
const cbsLogo = getTVLogoPath('CBS'); // '/assets/tv-logos/cbs-nfl-us.png'
```

### Caching

```javascript
import {
  buildCompleteNFLData,
  cacheNFLData,
  loadCachedNFLData
} from './nfl-data-service.mjs';

// Try to load from cache first (max age: 1 hour)
let nflData = loadCachedNFLData(2024, 15, 3600000);

if (!nflData) {
  // Cache miss or expired, fetch fresh data
  nflData = await buildCompleteNFLData(2024, 15);
  cacheNFLData(nflData);
}
```

## Data Structures

### Schedule Lookup
```javascript
{
  'BUF': 'DET',  // Buffalo plays at Detroit
  'DET': 'BUF',  // Detroit plays at Buffalo
  'SFO': 'LAR',  // San Francisco plays at LA Rams
  // ... all 32 teams
}
```

### Game Details Lookup
```javascript
{
  'BUF_vs_DET': {
    time: '4:25 PM PST',
    day: 'Sun',
    channel: 'CBS',
    channelLogo: 'cbs-nfl-us.png',
    weather: '🏟️',
    temp: '72°',
    conditions: 'Dome',
    venue: {
      name: 'Ford Field',
      city: 'Detroit',
      state: 'MI',
      indoor: true
    }
  }
}
```

### Defensive Rankings
```javascript
{
  QB: {
    'DET': 3,  // Detroit is 3rd-best defense vs QBs
    'BUF': 5,  // Buffalo is 5th-best defense vs QBs
    // ... all 32 teams
  },
  RB: { ... },
  WR: { ... },
  TE: { ... }
}
```

## Team Abbreviation Mapping

ESPN uses different abbreviations than MFL for some teams:

| ESPN | MFL | Team |
|------|-----|------|
| GB   | GBP | Green Bay Packers |
| KC   | KCC | Kansas City Chiefs |
| JAX  | JAC | Jacksonville Jaguars |
| LV   | LVR | Las Vegas Raiders |
| NE   | NEP | New England Patriots |
| NO   | NOS | New Orleans Saints |
| SF   | SFO | San Francisco 49ers |
| TB   | TBB | Tampa Bay Buccaneers |

The service automatically handles this conversion.

## Weather Integration

Weather is fetched from the free Weather.gov API for US locations. The service:

1. Maps stadiums to GPS coordinates
2. Calls Weather.gov point API for forecast URL
3. Fetches current forecast for game time
4. Determines appropriate weather icon
5. Indoor stadiums get 🏟️ icon with "Dome" condition

## TV Network Logos

Logos must exist in `/public/assets/tv-logos/` with these filenames:

- `abc.png` - ABC
- `cbs-nfl-us.png` - CBS
- `espn.png` - ESPN
- `fox.png` - FOX
- `prime-video.png` - Amazon Prime Video
- `netflix.png` - Netflix
- `youtube-tv.png` - YouTube TV

Networks without logos fall back to 📺 emoji.

## Testing

Run the test suite:

```bash
node scripts/test-nfl-data-service.mjs
```

This will test:
- NFL schedule fetching
- Weather data fetching
- Defensive rankings
- Complete data building
- Caching functionality
- TV logo path resolution

## Future Enhancements

### 🚧 Defensive Rankings API
Currently using cached 2024 data. Future integration options:

1. **FantasyPros API** (recommended)
   - Most accurate fantasy-focused rankings
   - Updated weekly
   - Requires paid subscription

2. **ESPN Fantasy API**
   - Free but unofficial
   - May require scraping

3. **Pro Football Reference**
   - Most comprehensive stats
   - Requires scraping

### 📋 Vegas Lines
Add betting lines and over/under for each game:

```javascript
gameDetails: {
  'BUF_vs_DET': {
    spread: 'BUF -3.5',
    overUnder: 51.5,
    moneyline: { home: -180, away: +155 }
  }
}
```

### 📋 Injury Reports
Integrate injury status for key players:

```javascript
injuries: {
  'BUF': [
    { player: 'Von Miller', position: 'LB', status: 'Questionable' }
  ]
}
```

## API Limits and Rate Limiting

### ESPN API
- No official rate limits documented
- Implemented 100ms delay between requests to be respectful
- Use caching to minimize requests

### Weather.gov API
- Free for all users
- Rate limit: ~5 requests per second
- Requires User-Agent header: `MFL-Football-App`
- Implemented 100ms delay between requests

## Error Handling

All functions include error handling with fallbacks:

- Schedule fetch fails → throw error (critical)
- Weather fetch fails → use default "Weather unavailable"
- Rankings fetch fails → use cached data
- Unknown stadium → default outdoor weather

## Dependencies

```json
{
  "dependencies": {
    "node:fs": "Built-in",
    "node:path": "Built-in",
    "fetch": "Built-in Node 18+"
  }
}
```

No external npm packages required!

## License

MIT - Use freely in your fantasy football league!

## Questions?

See main documentation: [ai-matchup-stories.md](../src/pages/theleague/docs/ai-matchup-stories.md)
