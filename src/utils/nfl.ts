// Helper to normalize team codes (MFL to ESPN/Standard)
export function normalizeTeamCode(teamCode: string) {
  if (!teamCode) return '';
  const upper = teamCode.toUpperCase();
  const map: Record<string, string> = {
    'WAS': 'WSH', // Washington
    'JAC': 'JAX', // Jacksonville
    'GBP': 'GB',  // Green Bay
    'KCC': 'KC',  // Kansas City
    'NEP': 'NE',  // New England
    'NOS': 'NO',  // New Orleans
    'SFO': 'SF',  // San Francisco
    'TBB': 'TB',  // Tampa Bay
    'LVR': 'LV',  // Las Vegas
    'HST': 'HOU', // Houston
    'BLT': 'BAL', // Baltimore
    'CLV': 'CLE', // Cleveland
    'ARZ': 'ARI'  // Arizona
  };
  return map[upper] || upper;
}

// Helper to get NFL team logo URL
export function getNFLTeamLogo(teamCode: string, variant?: 'dark') {
  const code = normalizeTeamCode(teamCode);
  if (!code) return '';
  const path = variant === 'dark' ? '500-dark' : '500';
  return `https://a.espncdn.com/i/teamlogos/nfl/${path}/${code}.png`;
}

// Helper to get Stadium Name
export function getStadiumName(teamCode: string) {
  const code = normalizeTeamCode(teamCode);
  const stadiums: Record<string, string> = {
    'ARI': 'State Farm Stadium',
    'ATL': 'Mercedes-Benz Stadium',
    'BAL': 'M&T Bank Stadium',
    'BUF': 'Highmark Stadium',
    'CAR': 'Bank of America Stadium',
    'CHI': 'Soldier Field',
    'CIN': 'Paycor Stadium',
    'CLE': 'Huntington Bank Field',
    'DAL': 'AT&T Stadium',
    'DEN': 'Empower Field at Mile High',
    'DET': 'Ford Field',
    'GB': 'Lambeau Field',
    'HOU': 'NRG Stadium',
    'IND': 'Lucas Oil Stadium',
    'JAX': 'EverBank Stadium',
    'KC': 'GEHA Field at Arrowhead Stadium',
    'LAC': 'SoFi Stadium',
    'LAR': 'SoFi Stadium',
    'LV': 'Allegiant Stadium',
    'MIA': 'Hard Rock Stadium',
    'MIN': 'U.S. Bank Stadium',
    'NE': 'Gillette Stadium',
    'NO': 'Caesars Superdome',
    'NYG': 'MetLife Stadium',
    'NYJ': 'MetLife Stadium',
    'PHI': 'Lincoln Financial Field',
    'PIT': 'Acrisure Stadium',
    'SEA': 'Lumen Field',
    'SF': "Levi's Stadium",
    'TB': 'Raymond James Stadium',
    'TEN': 'Nissan Stadium',
    'WSH': 'Northwest Stadium'
  };
  return stadiums[code] || '';
}
