# Quick Reference: NFL Logo Functions

## Import Options

### Option 1: From nfl-logo.ts (NEW - Recommended)
```typescript
import { getNFLTeamLogo, normalizeTeamCode } from '@/utils/nfl-logo';
```

### Option 2: From nfl.ts (Existing)
```typescript
import { getNFLTeamLogo, normalizeTeamCode } from '@/utils/nfl';
```

Both files have the same functions. Use `nfl-logo.ts` for new code.

## Basic Usage

### In Astro Components
```astro
---
import { getNFLTeamLogo } from '@/utils/nfl-logo';
const player = { team: 'WAS', name: 'Player Name' };
---

<img src={getNFLTeamLogo(player.team)} alt={player.team} class="team-logo" />
```

### In Client-Side JavaScript
```javascript
// Copy these functions into your <script> tag:

const normalizeTeamCode = (teamCode) => {
  if (!teamCode) return '';
  const upper = teamCode.toUpperCase();
  const map = {
    'WAS': 'WSH', 'JAC': 'JAX', 'GBP': 'GB', 'KCC': 'KC',
    'NEP': 'NE', 'NOS': 'NO', 'SFO': 'SF', 'TBB': 'TB',
    'LVR': 'LV', 'HST': 'HOU', 'BLT': 'BAL', 'CLV': 'CLE', 'ARZ': 'ARI'
  };
  return map[upper] || upper;
};

const getNFLTeamLogo = (teamCode, variant) => {
  const code = normalizeTeamCode(teamCode);
  if (!code) return '';
  const path = variant === 'dark' ? '500-dark' : '500';
  return `https://a.espncdn.com/i/teamlogos/nfl/${path}/${code}.png`;
};

// Then use it:
const logoUrl = getNFLTeamLogo('WAS'); // Returns WSH logo URL
imgElement.src = logoUrl;
```

## Common Patterns

### Table Cell
```astro
<td class="team-cell">
  <img src={getNFLTeamLogo(player.team)} alt={player.team} class="team-logo" />
</td>

<style>
  .team-cell {
    text-align: center;
  }
  .team-logo {
    height: 24px;
    width: auto;
    object-fit: contain;
  }
</style>
```

### Player Card
```astro
<div class="player-card">
  <img src={getNFLTeamLogo(player.team)} alt={player.team} class="team-logo" />
  <h3>{player.name}</h3>
  <p>{player.position} - {player.team}</p>
</div>

<style>
  .team-logo {
    height: 32px;
    width: auto;
    object-fit: contain;
  }
</style>
```

### Dynamic Rendering (Client-Side)
```javascript
const renderPlayer = (player) => {
  return `
    <div class="player">
      <img src="${getNFLTeamLogo(player.team)}" alt="${player.team}" />
      <span>${player.name}</span>
    </div>
  `;
};
```

### Dark Mode
```astro
<div class="dark-theme">
  <img src={getNFLTeamLogo(player.team, 'dark')} alt={player.team} />
</div>
```

## Sizing Guide

```css
/* Small (16px) - Mobile, inline */
.nfl-logo-small {
  height: 16px;
  width: auto;
  object-fit: contain;
}

/* Medium (24px) - Tables, cards */
.nfl-logo-medium {
  height: 24px;
  width: auto;
  object-fit: contain;
}

/* Large (48px) - Headers, featured */
.nfl-logo-large {
  height: 48px;
  width: auto;
  object-fit: contain;
}
```

## Team Code Cheat Sheet

**MFL codes that need normalization:**
- WAS → WSH (Washington)
- JAC → JAX (Jacksonville)  
- GBP → GB (Green Bay)
- KCC → KC (Kansas City)
- NEP → NE (New England)
- NOS → NO (New Orleans)
- SFO → SF (San Francisco)
- TBB → TB (Tampa Bay)
- LVR → LV (Las Vegas)
- HST → HOU (Houston)
- BLT → BAL (Baltimore)
- CLV → CLE (Cleveland)
- ARZ → ARI (Arizona)

**All other codes stay the same:** DAL, NYG, PHI, etc.

## Full Documentation

See `docs/NFL_LOGO_UTILITIES.md` for:
- Complete API reference
- All functions and parameters
- Advanced use cases
- Best practices
- Troubleshooting
