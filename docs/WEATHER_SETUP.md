# NFL Weather Integration - Quick Start Guide

## Overview

The NFL weather system fetches real-time weather forecasts for all outdoor NFL games using the National Weather Service API. This guide shows you how to set it up and use it.

## Quick Start

### 1. Fetch Current Week Schedule + Weather

```bash
npm run fetch:schedule:current
```

This will:
1. Fetch Week 15 2025 schedule from ESPN
2. Enrich with live weather data from NWS
3. Save to `data/theleague/nfl-cache/week15-2025.json`

### 2. Fetch Specific Week

```bash
# Fetch schedule
node scripts/fetch-espn-schedule.mjs --week 16 --year 2025

# Add weather
node scripts/enrich-schedule-with-weather.mjs --week 16 --year 2025
```

### 3. View Results

The data is now available in your Astro pages! The matchup preview page will automatically show:
- 🏟️ Indoor venues with "72°F Indoor"
- ☀️ Outdoor games with real forecasts like "10°F - Slight Chance Snow"

## How It Works

### Step 1: ESPN Fetches Game Info
```
ESPN API → Game schedule, times, channels, venues
```

### Step 2: NWS Enriches with Weather
```
For each outdoor venue:
  Stadium coordinates → NWS API → Real forecast

Indoor venues:
  Automatically set to "🏟️ 72°F Indoor"
```

### Step 3: Display on Page
```
Astro page loads cached JSON → Shows weather with game details
```

## Example Output

### Before Weather Enrichment:
```json
{
  "weather": "☀️",
  "temp": "",
  "conditions": ""
}
```

### After Weather Enrichment:
```json
{
  "weather": "❄️",
  "temp": "10°F",
  "conditions": "Slight Chance Snow"
}
```

### Temperature Display by Country:
- **United States**: 10°F - Slight Chance Snow
- **Canada**: 10°C - Slight Chance Snow (auto-converted)
- **Australia**: 10°C - Slight Chance Snow (auto-converted)
- **Indoor Domes**:
  - US: 72°F - Indoor
  - CA/AU: 22°C - Indoor

## Weather Emojis

The system automatically selects weather emojis based on forecast conditions:

- ☀️ Clear/Sunny
- ⛅ Partly Cloudy
- ☁️ Cloudy
- 🌧️ Rain
- ❄️ Snow
- ⛈️ Thunderstorms
- 💨 Windy
- 🌫️ Fog/Mist
- 🏟️ Indoor Venue

## Workflow for Weekly Updates

Every week during the season:

```bash
# 1. Fetch this week's schedule
npm run fetch:schedule:current

# 2. View on your site
npm run dev

# 3. Navigate to matchup preview page
# Weather shows automatically!
```

## Automation (Optional)

Schedule a weekly cron job to fetch fresh data:

```bash
# Every Monday at 9 AM
0 9 * * 1 cd /path/to/project && npm run fetch:schedule:current
```

## No API Keys Required!

The National Weather Service API is:
- ✅ **Free** - No signup or API key needed
- ✅ **Reliable** - Official US government data
- ✅ **Accurate** - Real forecasts from weather.gov
- ✅ **No Rate Limits** - For reasonable use (we delay 500ms between calls)

## Troubleshooting

### Weather not showing?
1. Check the cache file exists: `data/theleague/nfl-cache/week15-2025.json`
2. Verify `weatherEnrichedAt` field is present in the JSON
3. Check browser console for errors

### Shows "☀️" instead of real weather?
- The weather enrichment script wasn't run
- Run: `npm run fetch:weather -- --week 15 --year 2025`

### Wrong temperature?
- Weather is fetched at script runtime
- Re-run closer to game time for more accurate forecasts
- Remember: Indoor venues always show "72°F Indoor"

## Technical Details

### Stadium Coordinates
All 32 NFL stadiums have hardcoded coordinates in the enrichment script. If a new stadium is added, update the `STADIUM_COORDS` object in `scripts/enrich-schedule-with-weather.mjs`.

### API Calls
- ESPN API: 1 call per week fetch
- NWS API: 2 calls per outdoor game (point lookup + forecast)
  - Week 15 example: 12 outdoor games = 24 NWS calls
  - Takes ~10 seconds with 500ms delay between calls

### Caching
Weather data is cached in the JSON file. To update:
1. Re-run the enrichment script
2. It overwrites existing weather data with fresh forecasts

## Links

- **ESPN API**: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
- **NWS API**: `https://api.weather.gov/points/{lat},{lon}`
- **Documentation**: `docs/ESPN_BROADCAST_INTEGRATION.md`
