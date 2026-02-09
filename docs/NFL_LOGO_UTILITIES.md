# NFL Logo Utilities

Reusable functions for displaying NFL team logos consistently across the application.

## Installation

The utilities are available at `src/utils/nfl-logo.ts` and can be imported anywhere in the app:

```typescript
import { getNFLTeamLogo, normalizeTeamCode } from '@/utils/nfl-logo';
```

## Quick Start

### In Astro Components (Server-Side)

```astro
---
import { getNFLTeamLogo } from '@/utils/nfl-logo';

const player = {
  name: 'Patrick Mahomes',
  team: 'KC',
  position: 'QB'
};
---

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

### In Client-Side JavaScript

```typescript
// Copy the functions into a <script> tag or import via a bundled module

const getNFLTeamLogo = (teamCode: string, variant?: 'dark'): string => {
  // ... function implementation
};

// Use in dynamic rendering
const renderPlayer = (player) => {
  return `
    <div class="player">
      <img src="${getNFLTeamLogo(player.team)}" alt="${player.team}" />
      <span>${player.name}</span>
    </div>
  `;
};
```

### In React/Vue Components

```tsx
import { getNFLTeamLogo } from '@/utils/nfl-logo';

function PlayerCard({ player }) {
  return (
    <div className="player-card">
      <img 
        src={getNFLTeamLogo(player.team)} 
        alt={player.team}
        className="team-logo"
      />
      <h3>{player.name}</h3>
    </div>
  );
}
```

## API Reference

### `getNFLTeamLogo(teamCode, variant?)`

Get an ESPN CDN URL for an NFL team logo.

**Parameters:**
- `teamCode` (string): Team abbreviation (e.g., 'WAS', 'DAL', 'GB')
- `variant` (optional): `'dark'` for dark mode backgrounds

**Returns:** string - ESPN CDN URL (500px resolution)

**Examples:**

```typescript
// Standard logo
getNFLTeamLogo('WAS')
// => 'https://a.espncdn.com/i/teamlogos/nfl/500/WSH.png'

// Dark variant for dark backgrounds
getNFLTeamLogo('DAL', 'dark')
// => 'https://a.espncdn.com/i/teamlogos/nfl/500-dark/DAL.png'

// Handles MFL format automatically
getNFLTeamLogo('GBP') // Green Bay Packers (MFL code)
// => 'https://a.espncdn.com/i/teamlogos/nfl/500/GB.png'
```

### `normalizeTeamCode(teamCode)`

Convert MFL team codes to ESPN/Standard format.

**Parameters:**
- `teamCode` (string): Team abbreviation in any format

**Returns:** string - Normalized team code

**Examples:**

```typescript
normalizeTeamCode('WAS') // => 'WSH' (Washington)
normalizeTeamCode('JAC') // => 'JAX' (Jacksonville)
normalizeTeamCode('GBP') // => 'GB' (Green Bay)
normalizeTeamCode('DAL') // => 'DAL' (unchanged)
normalizeTeamCode('') // => '' (empty)
```

### `getAllNFLTeamCodes()`

Get all valid NFL team codes (ESPN format).

**Returns:** string[] - Array of all 32 team codes

**Examples:**

```typescript
const teams = getAllNFLTeamCodes();
// => ['ARI', 'ATL', 'BAL', 'BUF', ...]

// Use in a dropdown
const teamOptions = teams.map(code => ({
  value: code,
  label: code,
  logo: getNFLTeamLogo(code)
}));
```

### `isValidTeamCode(teamCode)`

Check if a team code is valid.

**Parameters:**
- `teamCode` (string): Team abbreviation to validate

**Returns:** boolean - True if valid

**Examples:**

```typescript
isValidTeamCode('DAL') // => true
isValidTeamCode('WAS') // => true (normalized to WSH)
isValidTeamCode('XXX') // => false
isValidTeamCode('') // => false
```

## Common Use Cases

### 1. Player Tables

```astro
---
import { getNFLTeamLogo } from '@/utils/nfl-logo';
---

<table class="player-table">
  <thead>
    <tr>
      <th>Player</th>
      <th>Position</th>
      <th>Team</th>
    </tr>
  </thead>
  <tbody>
    {players.map(player => (
      <tr>
        <td>{player.name}</td>
        <td>{player.position}</td>
        <td class="team-cell">
          <img src={getNFLTeamLogo(player.team)} alt={player.team} />
        </td>
      </tr>
    ))}
  </tbody>
</table>

<style>
  .team-cell img {
    height: 24px;
    width: auto;
    object-fit: contain;
  }
</style>
```

### 2. Dynamic Client-Side Rendering

```javascript
// Add the function to your client script
const getNFLTeamLogo = (teamCode, variant) => {
  const normalizeTeamCode = (code) => {
    if (!code) return '';
    const map = {
      'WAS': 'WSH', 'JAC': 'JAX', 'GBP': 'GB', // ... etc
    };
    return map[code.toUpperCase()] || code.toUpperCase();
  };
  
  const code = normalizeTeamCode(teamCode);
  if (!code) return '';
  const path = variant === 'dark' ? '500-dark' : '500';
  return `https://a.espncdn.com/i/teamlogos/nfl/${path}/${code}.png`;
};

// Use in dynamic HTML generation
const renderPlayerCard = (player) => {
  return `
    <div class="player-card">
      <img 
        src="${getNFLTeamLogo(player.team)}" 
        alt="${player.team}"
        class="team-logo"
      />
      <h3>${player.name}</h3>
      <p>${player.position} - ${player.team}</p>
    </div>
  `;
};
```

### 3. Dark Mode Support

```astro
---
import { getNFLTeamLogo } from '@/utils/nfl-logo';
---

<div class="player-card dark-theme">
  <!-- Use dark variant for dark backgrounds -->
  <img src={getNFLTeamLogo(player.team, 'dark')} alt={player.team} />
  <h3>{player.name}</h3>
</div>

<style>
  .dark-theme {
    background: #1a1a1a;
    color: white;
  }
</style>
```

### 4. Team Selection Dropdown

```astro
---
import { getAllNFLTeamCodes, getNFLTeamLogo } from '@/utils/nfl-logo';

const teams = getAllNFLTeamCodes();
---

<select name="team" class="team-selector">
  {teams.map(code => (
    <option value={code}>
      {code}
    </option>
  ))}
</select>

<!-- Or with logos (requires custom dropdown) -->
<div class="custom-team-dropdown">
  {teams.map(code => (
    <div class="team-option" data-value={code}>
      <img src={getNFLTeamLogo(code)} alt={code} />
      <span>{code}</span>
    </div>
  ))}
</div>
```

## Styling Guidelines

### Recommended Sizes

```css
/* Small logo (mobile, inline) */
.nfl-logo-small {
  height: 16px;
  width: auto;
  object-fit: contain;
}

/* Medium logo (table cells, cards) */
.nfl-logo-medium {
  height: 24px;
  width: auto;
  object-fit: contain;
}

/* Large logo (headers, featured) */
.nfl-logo-large {
  height: 48px;
  width: auto;
  object-fit: contain;
}
```

### Alignment

```css
/* Vertical center alignment */
.nfl-logo {
  vertical-align: middle;
}

/* Flexbox alignment */
.team-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

## Team Code Reference

### Standard Codes (ESPN Format)

All functions return URLs using these codes:

- **AFC East:** BUF, MIA, NE, NYJ
- **AFC North:** BAL, CIN, CLE, PIT
- **AFC South:** HOU, IND, JAX, TEN
- **AFC West:** DEN, KC, LAC, LV
- **NFC East:** DAL, NYG, PHI, WSH
- **NFC North:** CHI, DET, GB, MIN
- **NFC South:** ATL, CAR, NO, TB
- **NFC West:** ARI, LAR, SEA, SF

### MFL Format Mappings

These codes are automatically normalized:

- `WAS` → `WSH` (Washington)
- `JAC` → `JAX` (Jacksonville)
- `GBP` → `GB` (Green Bay)
- `KCC` → `KC` (Kansas City)
- `NEP` → `NE` (New England)
- `NOS` → `NO` (New Orleans)
- `SFO` → `SF` (San Francisco)
- `TBB` → `TB` (Tampa Bay)
- `LVR` → `LV` (Las Vegas)
- `HST` → `HOU` (Houston)
- `BLT` → `BAL` (Baltimore)
- `CLV` → `CLE` (Cleveland)
- `ARZ` → `ARI` (Arizona)

## Implementation Examples

### Existing Usage

The NFL logo utilities are currently used in:

1. **Auction Predictor** (`src/pages/theleague/auction-predictor.astro`)
   - Player table team column
   - Mobile player cards
   - Player details modal

2. **Sunday Ticket Multi-View** (`src/components/theleague/SundayTicketMultiView.astro`)
   - Game matchup displays
   - Dark variant for TV-style layout

3. **Matchup Preview** (`src/pages/theleague/matchup-preview-example.astro`)
   - NFL game cards
   - Team comparison views

### Adding to New Components

1. **Import the utility:**
   ```typescript
   import { getNFLTeamLogo } from '@/utils/nfl-logo';
   ```

2. **Use in your component:**
   ```astro
   <img src={getNFLTeamLogo(team)} alt={team} class="team-logo" />
   ```

3. **Add appropriate styles:**
   ```css
   .team-logo {
     height: 24px;
     width: auto;
     object-fit: contain;
   }
   ```

## Best Practices

1. **Always provide alt text** for accessibility
2. **Use `object-fit: contain`** to maintain aspect ratio
3. **Set height, not width** to maintain proportions
4. **Use dark variant** for dark backgrounds
5. **Normalize team codes** before validation
6. **Cache logo URLs** if rendering many logos

## Troubleshooting

### Logo not displaying?

1. Check team code is valid: `isValidTeamCode(teamCode)`
2. Check network requests in DevTools
3. Verify ESPN CDN is accessible
4. Check for empty/null team codes

### Wrong logo displayed?

1. Check if team code needs normalization (MFL → ESPN)
2. Verify team code against reference list
3. Check console for errors

### Styling issues?

1. Ensure `object-fit: contain` is set
2. Set height instead of width
3. Use `vertical-align: middle` for inline display
4. Check parent container doesn't restrict sizing

## Support

For questions or issues:
- Check existing usage examples in the codebase
- Review team code reference above
- Verify team codes against MFL data
- Check ESPN CDN availability
