/**
 * MFL API Integration for Matchup Previews
 * Handles starting lineups, player status, and matchup data
 */

import type { FantasyPlayer, StartingLineup, PlayerStatus, FantasyTeam } from '../types/matchup-previews';

/**
 * MFL API configuration
 */
export interface MFLApiConfig {
  leagueId: string;
  year: string;
  host?: string;
  mflUserId?: string;
  mflApiKey?: string;
}

/**
 * Raw MFL roster response
 */
interface MFLRosterResponse {
  rosters: {
    franchise: Array<{
      id: string;
      player: Array<{
        id: string;
        status: string;
        salary?: string;
        contractYear?: string;
      }>;
    }>;
  };
}

/**
 * Raw MFL player response
 */
interface MFLPlayerResponse {
  players: {
    player: Array<{
      id: string;
      name: string;
      position: string;
      team: string;
      injury_status?: string;
      birthdate?: string;
    }>;
  };
}

/**
 * Raw MFL starting lineup response
 */
interface MFLStartingLineupResponse {
  startingLineups: {
    franchise: Array<{
      id: string;
      player: Array<{
        id: string;
        status: 'starter' | 'nonstarter';
      }>;
    }>;
  };
}

/**
 * Raw MFL league response for team info
 */
interface MFLLeagueResponse {
  league: {
    franchises: {
      franchise: Array<{
        id: string;
        name: string;
        owner_name?: string;
        icon?: string;
        logo?: string;
      }>;
    };
  };
}

/**
 * Raw MFL schedule response
 */
interface MFLScheduleResponse {
  schedule: {
    weeklySchedule: Array<{
      week: string;
      matchup: Array<{
        franchise: Array<{
          id: string;
          isHome?: string;
        }>;
      }>;
    }>;
  };
}

/**
 * Create MFL API client
 */
export class MFLMatchupApiClient {
  private config: MFLApiConfig;
  private baseUrl: string;

  constructor(config: MFLApiConfig) {
    this.config = config;
    this.baseUrl = config.host || 'https://api.myfantasyleague.com';
  }

  /**
   * Build authenticated URL
   */
  private buildUrl(endpoint: string, params: Record<string, string> = {}): string {
    const url = new URL(`${this.baseUrl}/${this.config.year}/export`);
    
    // Add base parameters
    url.searchParams.set('TYPE', endpoint);
    url.searchParams.set('L', this.config.leagueId);
    url.searchParams.set('JSON', '1');

    // Add additional parameters
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    // Add authentication if available
    if (this.config.mflApiKey) {
      url.searchParams.set('APIKEY', this.config.mflApiKey);
    }

    return url.toString();
  }

  /**
   * Make API request
   */
  private async makeRequest<T>(url: string): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add user ID cookie if available
    if (this.config.mflUserId) {
      headers['Cookie'] = `MFL_USER_ID=${this.config.mflUserId}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`MFL API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Fetch starting lineups for a specific week
   */
  async getStartingLineups(week: number): Promise<Record<string, string[]>> {
    const url = this.buildUrl('rosters', { W: week.toString() });
    const response = await this.makeRequest<MFLStartingLineupResponse>(url);

    const lineups: Record<string, string[]> = {};

    if (response.startingLineups?.franchise) {
      response.startingLineups.franchise.forEach(franchise => {
        const starters = franchise.player
          ?.filter(p => p.status === 'starter')
          ?.map(p => p.id) || [];
        lineups[franchise.id] = starters;
      });
    }

    return lineups;
  }

  /**
   * Fetch player data with injury status
   */
  async getPlayers(): Promise<Record<string, FantasyPlayer>> {
    const url = this.buildUrl('players', { DETAILS: '1' });
    const response = await this.makeRequest<MFLPlayerResponse>(url);

    const players: Record<string, FantasyPlayer> = {};

    if (response.players?.player) {
      response.players.player.forEach(player => {
        players[player.id] = {
          id: player.id,
          name: player.name,
          position: player.position,
          nflTeam: player.team,
          fantasyTeamId: '', // Will be populated from roster data
          isStarting: false, // Will be populated from lineup data
          injuryStatus: this.normalizeInjuryStatus(player.injury_status),
        };
      });
    }

    return players;
  }

  /**
   * Fetch roster data for all teams
   */
  async getRosters(week?: number): Promise<Record<string, string[]>> {
    const params: Record<string, string> = week ? { W: week.toString() } : {};
    const url = this.buildUrl('rosters', params);
    const response = await this.makeRequest<MFLRosterResponse>(url);

    const rosters: Record<string, string[]> = {};

    if (response.rosters?.franchise) {
      response.rosters.franchise.forEach(franchise => {
        rosters[franchise.id] = franchise.player?.map(p => p.id) || [];
      });
    }

    return rosters;
  }

  /**
   * Fetch fantasy team information
   */
  async getFantasyTeams(): Promise<Record<string, FantasyTeam>> {
    const url = this.buildUrl('league');
    const response = await this.makeRequest<MFLLeagueResponse>(url);

    const teams: Record<string, FantasyTeam> = {};

    if (response.league?.franchises?.franchise) {
      response.league.franchises.franchise.forEach(franchise => {
        teams[franchise.id] = {
          id: franchise.id,
          name: franchise.name,
          ownerName: franchise.owner_name || '',
          icon: franchise.icon,
          banner: franchise.logo,
        };
      });
    }

    return teams;
  }

  /**
   * Get complete starting lineup data for a team
   */
  async getTeamStartingLineup(teamId: string, week: number): Promise<StartingLineup | null> {
    try {
      const [players, rosters, startingLineups] = await Promise.all([
        this.getPlayers(),
        this.getRosters(week),
        this.getStartingLineups(week),
      ]);

      const teamRoster = rosters[teamId] || [];
      const teamStarters = startingLineups[teamId] || [];

      if (teamRoster.length === 0) {
        return null;
      }

      // Build fantasy players with starting status
      const fantasyPlayers = teamRoster.map(playerId => {
        const player = players[playerId];
        if (!player) return null;

        return {
          ...player,
          fantasyTeamId: teamId,
          isStarting: teamStarters.includes(playerId),
        };
      }).filter((p): p is FantasyPlayer => p !== null);

      // Organize by position
      const positions = {
        QB: fantasyPlayers.filter(p => p.position === 'QB' && p.isStarting),
        RB: fantasyPlayers.filter(p => p.position === 'RB' && p.isStarting),
        WR: fantasyPlayers.filter(p => p.position === 'WR' && p.isStarting),
        TE: fantasyPlayers.filter(p => p.position === 'TE' && p.isStarting),
        FLEX: fantasyPlayers.filter(p => ['RB', 'WR', 'TE'].includes(p.position) && p.isStarting),
        K: fantasyPlayers.filter(p => p.position === 'K' && p.isStarting),
        DEF: fantasyPlayers.filter(p => p.position === 'Def' && p.isStarting),
      };

      const bench = fantasyPlayers.filter(p => !p.isStarting);

      return {
        teamId,
        week,
        positions,
        bench,
        totalProjected: 0, // Will be calculated elsewhere
        optimizationOpportunities: [], // Will be calculated elsewhere
      };
    } catch (error) {
      console.error(`Failed to get starting lineup for team ${teamId}:`, error);
      return null;
    }
  }

  /**
   * Normalize injury status from MFL API
   */
  private normalizeInjuryStatus(status?: string): PlayerStatus {
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

  /**
   * Check if a player is IR eligible based on injury status
   */
  isPlayerIReligible(player: FantasyPlayer): boolean {
    return player.injuryStatus === 'Out' && !player.isStarting;
  }

  /**
   * Fetch fantasy schedule for a specific week
   */
  async getFantasySchedule(week: number): Promise<MFLScheduleResponse> {
    const url = this.buildUrl('schedule', { W: week.toString() });
    return this.makeRequest<MFLScheduleResponse>(url);
  }

  /**
   * Submit IR move for a player (requires authentication)
   */
  async movePlayerToIR(playerId: string, franchiseId: string): Promise<boolean> {
    if (!this.config.mflUserId) {
      throw new Error('Authentication required for IR moves');
    }

    try {
      const url = `${this.baseUrl}/${this.config.year}/freeagency`;
      const params = new URLSearchParams({
        TYPE: 'moveToIR',
        L: this.config.leagueId,
        PLAYER: playerId,
        FRANCHISE: franchiseId,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': `MFL_USER_ID=${this.config.mflUserId}`,
        },
        body: params.toString(),
      });

      return response.ok;
    } catch (error) {
      console.error('Failed to move player to IR:', error);
      return false;
    }
  }
}

/**
 * Create MFL API client from environment or config
 */
export function createMFLApiClient(config: Partial<MFLApiConfig> = {}): MFLMatchupApiClient {
  const defaultConfig: MFLApiConfig = {
    leagueId: config.leagueId || process.env.MFL_LEAGUE_ID || '13522',
    year: config.year || new Date().getFullYear().toString(),
    host: config.host || process.env.MFL_HOST || 'https://api.myfantasyleague.com',
    mflUserId: config.mflUserId || process.env.MFL_USER_ID,
    mflApiKey: config.mflApiKey || process.env.MFL_APIKEY,
  };

  return new MFLMatchupApiClient(defaultConfig);
}