# ESPN Broadcast Integration & International Support

## Overview

This system fetches live NFL broadcast information from ESPN's API and displays it appropriately for users in different countries (US, Canada, Australia).

## Features

### 1. **ESPN API Integration**
- Fetches live game schedules and broadcast information
- Includes channel, time, weather, and venue data
- Updates automatically from ESPN's official data

### 2. **International Broadcast Mapping**
- Automatically detects user's country from timezone
- Maps US broadcasts to international equivalents:
  - **USA**: CBS, FOX, NBC, ESPN, ABC, NFL Network, Prime Video
  - **Canada**: DAZN, TSN, CTV
  - **Australia**: Kayo Sports, 7mate, ESPN Australia

### 3. **Real Weather Data**
- Fetches live weather forecasts from National Weather Service (NWS) API
- Shows temperature, conditions, and weather emoji for outdoor games
- Indoor venues (domes) automatically show 🏟️ 72°F (22°C) - Indoor
- Automatic Celsius conversion for Canada and Australia users
- Free API with no authentication required

### 4. **Automatic Time Conversion**
- Converts all game times to user's local timezone
- Shows appropriate timezone abbreviation (EST, CST, PST, etc.)

## Usage

### Fetch Latest Broadcast Data

```bash
# Fetch schedule only (no weather)
node scripts/fetch-espn-schedule.mjs --week 15 --year 2025

# Enrich with weather data
node scripts/enrich-schedule-with-weather.mjs --week 15 --year 2025

# Or use npm scripts
npm run fetch:espn:schedule -- --week 15 --year 2025
npm run fetch:weather -- --week 15 --year 2025

# Convenience: fetch schedule + weather for current week
npm run fetch:schedule:current
```

### Weather Data Source

Weather data is fetched from the **National Weather Service API** (weather.gov):
- ✅ **Free** - No API key required
- ✅ **Accurate** - Official US government weather data
- ✅ **Reliable** - No rate limits for reasonable use
- 🌍 **Coverage** - US venues only (perfect for NFL)

The weather enrichment script:
1. Reads the ESPN schedule cache
2. For each outdoor game, fetches current forecast from NWS
3. Indoor games show "🏟️ 72°F Indoor"
4. Updates the cache file with weather data

### Output

Data is saved to: `data/theleague/nfl-cache/week{week}-{year}.json`

### Data Structure

```json
{
  "week": 15,
  "year": 2025,
  "fetchedAt": "2025-12-13T...",
  "source": "ESPN API",
  "weatherEnrichedAt": "2025-12-13T...",
  "schedule": {
    "SF": "LAR",
    "LAR": "SF",
    "CHI": "CLE",
    "CLE": "CHI"
  },
  "gameDetails": {
    "LAR_vs_SF": {
      "time": "1:25 PM PST",
      "day": "Sun",
      "channel": "FOX",
      "channelLogo": "fox.png",
      "weather": "🏟️",
      "temp": "72°F",
      "conditions": "Indoor",
      "venue": {
        "name": "SoFi Stadium",
        "city": "Inglewood",
        "state": "CA",
        "indoor": true
      }
    },
    "CLE_vs_CHI": {
      "time": "10:00 AM PST",
      "day": "Sun",
      "channel": "FOX",
      "channelLogo": "fox.png",
      "weather": "❄️",
      "temp": "10°F",
      "conditions": "Slight Chance Snow",
      "venue": {
        "name": "Soldier Field",
        "city": "Chicago",
        "state": "IL",
        "indoor": false
      }
    }
  }
}
```

## How It Works

### 1. **Fetch** (Server-side)
The ESPN API script fetches live data and caches it locally.

### 2. **Load** (Build-time)
Astro pages import the cached JSON data at build time.

### 3. **Display** (Client-side)
JavaScript detects user's location and shows appropriate broadcasts:

```javascript
// Timezone detection
America/Toronto → Canada → DAZN
Australia/Sydney → Australia → Kayo Sports
America/New_York → USA → CBS/FOX/NBC
```

## International Broadcast Mappings

### Canada (DAZN Primary)
| US Channel | Canadian Channel |
|------------|------------------|
| CBS        | DAZN             |
| FOX        | DAZN             |
| NBC        | CTV              |
| ESPN       | TSN              |
| Prime Video| DAZN             |

### Australia (Kayo Sports Primary)
| US Channel | Australian Channel |
|------------|-------------------|
| All        | Kayo Sports       |
| Select     | 7mate (Free)      |

## Updating Broadcast Mappings

Edit `data/theleague/broadcast-mappings.json` to:
- Add new countries
- Update channel mappings
- Add new broadcast networks

## Scheduled Updates

For production, schedule the ESPN fetch script to run weekly:

```bash
# Cron job (runs Monday 12pm PT)
0 12 * * 1 cd /path/to/project && node scripts/fetch-espn-schedule.mjs --week $(get_current_week)
```

## Testing

### Test Different Countries

Open browser console and check:
```javascript
Intl.DateTimeFormat().resolvedOptions().timeZone
// "America/Toronto" → Shows DAZN
// "Australia/Sydney" → Shows Kayo Sports
// "America/New_York" → Shows US channels
```

### Manual Country Override

Use query string to test different countries:
```
http://localhost:4321/theleague/matchup-preview?country=CA  (Canada)
http://localhost:4321/theleague/matchup-preview?country=AU  (Australia)
```

This will show:
- Canadian/Australian broadcast channels
- Temperatures in Celsius
- Appropriate network logos

## API Limits

ESPN API is **free and unofficial**:
- No rate limits observed
- No API key required
- Could change without notice
- Recommended: Cache data locally (already implemented)

## Troubleshooting

### No broadcast data showing
1. Run the fetch script: `node scripts/fetch-espn-schedule.mjs`
2. Check file exists: `data/theleague/nfl-cache/week15-2024.json`
3. Rebuild Astro site

### Wrong country detected
- Check timezone: `Intl.DateTimeFormat().resolvedOptions().timeZone`
- Add timezone mapping in script
- Use manual override (future feature)

### Channel logos missing
- Add logo files to `public/assets/tv-logos/`
- Update mapping in `broadcast-mappings.json`

## Weather Emoji Reference

| Emoji | Condition |
|-------|-----------|
| ☀️ | Clear/Sunny |
| ⛅ | Partly Cloudy |
| ☁️ | Cloudy |
| 🌧️ | Rain/Showers |
| ❄️ | Snow |
| ⛈️ | Thunderstorms |
| 💨 | Windy |
| 🌫️ | Fog/Mist |
| 🏟️ | Indoor Venue |

## Future Enhancements

- [ ] Manual country selector (dropdown)
- [ ] Streaming service links
- [ ] Game availability by subscription
- [ ] Push notifications for game start times
- [ ] Multi-language support
- [ ] Weather alerts for severe conditions
