/**
 * Simple JavaScript wrapper for MFL API to avoid TypeScript import issues
 */

export async function getMFLData(leagueId, year, week) {
  try {
    // Use fetch to call MFL API directly instead of importing TypeScript module
    const baseUrl = 'https://api.myfantasyleague.com';
    
    // Get players with injury status
    const playersUrl = `${baseUrl}/${year}/export?TYPE=players&L=${leagueId}&DETAILS=1&JSON=1`;
    const playersResponse = await fetch(playersUrl);
    const playersData = await playersResponse.json();
    
    // Get injury report (separate endpoint)
    const injuryUrl = `${baseUrl}/${year}/export?TYPE=injuries&L=${leagueId}&JSON=1`;
    const injuryResponse = await fetch(injuryUrl);
    const injuryReportData = await injuryResponse.json();
    
    // Get projected scores
    const projUrl = `${baseUrl}/${year}/export?TYPE=projectedScores&L=${leagueId}&W=${week}&JSON=1`;
    const projResponse = await fetch(projUrl);
    const projData = await projResponse.json();
    
    // Process injury report data first
    const injuryData = {};
    if (injuryReportData?.injuries?.injury) {
      const injuryList = Array.isArray(injuryReportData.injuries.injury)
        ? injuryReportData.injuries.injury
        : [injuryReportData.injuries.injury];
      
      injuryList.forEach(injury => {
        if (injury.id && injury.status) {
          const normalizedStatus = normalizeInjuryStatus(injury.status);
          injuryData[injury.id] = {
            name: injury.name || '',
            injuryStatus: normalizedStatus,
            injuryBodyPart: injury.details || ''
          };
        }
      });
    }
    
    // Process players data (for names and other info)
    if (playersData?.players?.player) {
      const playersList = Array.isArray(playersData.players.player) 
        ? playersData.players.player 
        : [playersData.players.player];
      
      playersList.forEach(player => {
        // Debug: Check for Geno Smith specifically
        if (player.name && player.name.includes('Smith') && player.name.includes('Geno')) {
          console.log(`🔍 MFL API Geno Smith data:`, {
            id: player.id,
            name: player.name,
            injury_status: player.injury_status,
            injury_body_part: player.injury_body_part,
            allFields: Object.keys(player)
          });
          
          // Check if he's in injury report
          const injuryInfo = injuryData[player.id];
          console.log(`🔍 Geno Smith injury report data:`, injuryInfo);
        }
        
        // If player has injury status in players endpoint, use it
        if (player.id && player.injury_status && !injuryData[player.id]) {
          const normalizedStatus = normalizeInjuryStatus(player.injury_status);
          injuryData[player.id] = {
            name: player.name,
            injuryStatus: normalizedStatus,
            injuryBodyPart: player.injury_body_part || ''
          };
        }
      });
    }
    
    console.log(`🔍 Injury report debug:`, {
      injuryReportStructure: injuryReportData,
      totalInjuries: Object.keys(injuryData).length
    });
    
    // Process projections data
    const projections = {};
    if (projData?.projectedScores?.playerScore) {
      const projList = Array.isArray(projData.projectedScores.playerScore)
        ? projData.projectedScores.playerScore
        : [projData.projectedScores.playerScore];
      
      projList.forEach(p => {
        if (p.id && p.score) {
          projections[p.id] = parseFloat(p.score) || 0;
        }
      });
    }
    
    return {
      injuryData,
      projections
    };
    
  } catch (error) {
    console.warn('MFL API wrapper failed:', error);
    return {
      injuryData: {},
      projections: {}
    };
  }
}

/**
 * Normalize injury status from MFL API (same logic as TypeScript client)
 */
function normalizeInjuryStatus(status) {
  if (!status) return 'Healthy';

  const normalized = status.toLowerCase().trim();
  
  switch (normalized) {
    case 'out':
    case 'o':
      return 'Out';
    case 'doubtful':
    case 'd':
      return 'Doubtful';
    case 'questionable':
    case 'q':
      return 'Questionable';
    case 'ir':
    case 'injured reserve':
      return 'IR';
    default:
      return 'Healthy';
  }
}