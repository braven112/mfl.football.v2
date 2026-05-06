/**
 * MFL API Integration for Matchup Previews
 * Handles starting lineups, player status, and matchup data
 */

import type { FantasyPlayer, StartingLineup, PlayerStatus, FantasyTeam } from '../types/matchup-previews';
import { mflFetch } from './mfl-fetch';

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

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });

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
   * Fetch injury report data from MFL
   * MFL has a separate injury endpoint that might have more current data
   */
  async getInjuryReport(): Promise<Record<string, PlayerStatus>> {
    try {
      const url = this.buildUrl('injuries');
      const response = await this.makeRequest<any>(url);
      
      const injuries: Record<string, PlayerStatus> = {};
      
      // MFL injury report structure may vary, this is a best guess
      if (response.injuries?.injury) {
        response.injuries.injury.forEach((injury: any) => {
          if (injury.id && injury.status) {
            injuries[injury.id] = this.normalizeInjuryStatus(injury.status);
          }
        });
      }
      
      return injuries;
    } catch (error) {
      console.warn('Failed to fetch MFL injury report:', error);
      return {};
    }
  }

  /**
   * Fetch roster data for all teams.
   *
   * When an MFL_USER_ID cookie is configured, route through mflFetch() so the
   * Cookie header survives the api → www49 redirect (Node's undici strips
   * sensitive headers on cross-origin redirects). Required for any caller
   * that uses the result for auth-gated decisions like roster-membership
   * preflight on write endpoints.
   */
  async getRosters(week?: number): Promise<Record<string, string[]>> {
    const params: Record<string, string> = week ? { W: week.toString() } : {};
    const url = this.buildUrl('rosters', params);

    let response: MFLRosterResponse;
    if (this.config.mflUserId) {
      const res = await mflFetch({
        url,
        method: 'GET',
        mflUserCookie: this.config.mflUserId,
        timeoutMs: 8000,
      });
      if (!res.ok) {
        throw new Error(`MFL rosters fetch failed: ${res.status}`);
      }
      response = (await res.json()) as MFLRosterResponse;
    } else {
      response = await this.makeRequest<MFLRosterResponse>(url);
    }

    type RosterFranchise = MFLRosterResponse['rosters']['franchise'][number];
    const isFranchise = (x: unknown): x is RosterFranchise =>
      !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string';

    const rosters: Record<string, string[]> = {};
    const raw: unknown = response.rosters?.franchise;
    const list: unknown[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const item of list) {
      if (!isFranchise(item)) continue;
      rosters[item.id] = item.player?.map((p) => p.id) || [];
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
   * In The League, players must be on NFL IR to be fantasy IR eligible
   * Also, bench players with 'Out' status may be IR eligible
   */
  isPlayerIReligible(player: FantasyPlayer): boolean {
    // Players on NFL IR are always eligible
    if (player.injuryStatus === 'IR') {
      return true;
    }
    
    // Bench players with 'Out' status are eligible for IR
    if (player.injuryStatus === 'Out' && !player.isStarting) {
      return true;
    }
    
    return false;
  }

  /**
   * Fetch live projected scores for all players
   */
  async getProjectedScores(week?: number): Promise<Record<string, number>> {
    const params: Record<string, string> = {};
    if (week) {
      params.W = week.toString();
    }
    
    const url = this.buildUrl('projectedScores', params);
    
    interface ProjectedScoresResponse {
      projectedScores: {
        playerScore: Array<{
          id: string;
          score: string;
        }>;
      };
    }
    
    const response = await this.makeRequest<ProjectedScoresResponse>(url);
    const projections: Record<string, number> = {};

    if (response.projectedScores?.playerScore) {
      response.projectedScores.playerScore.forEach(player => {
        const score = parseFloat(player.score);
        if (!isNaN(score)) {
          projections[player.id] = score;
        }
      });
    }

    return projections;
  }

  /**
   * Fetch fantasy schedule for a specific week
   */
  async getFantasySchedule(week: number): Promise<MFLScheduleResponse> {
    const url = this.buildUrl('schedule', { W: week.toString() });
    return this.makeRequest<MFLScheduleResponse>(url);
  }

  /**
   * Update trade bait for the authenticated user's franchise.
   * MFL's tradeBait import OVERWRITES the entire list, so we must:
   *   1. Read the current trade bait for all franchises
   *   2. Find the authenticated user's franchise entries
   *   3. Add or remove the player ID
   *   4. POST the complete updated list back
   *
   * @param playerId - The MFL player ID to add or remove
   * @param action - 'add' to put the player on the trade block, 'remove' to take them off
   * @param franchiseId - The franchise ID of the authenticated user (used to filter current entries)
   * @returns Object with success status and optional error message
   */
  async updateTradeBait(
    playerId: string,
    action: 'add' | 'remove',
    franchiseId: string
  ): Promise<{ success: boolean; error?: string; allPlayerIds?: string[] }> {
    if (!this.config.mflUserId) {
      return { success: false, error: 'Authentication required for trade bait updates' };
    }

    try {
      // Step 1: Read current trade bait for all franchises
      // Use mflFetch instead of makeRequest — MFL 302-redirects from api.myfantasyleague.com
      // to www49.myfantasyleague.com, and Node.js undici strips Cookie headers on cross-origin
      // redirects. mflFetch handles this by following redirects manually.
      const readUrl = this.buildUrl('tradeBait');
      const readResponse = await mflFetch({
        url: readUrl,
        method: 'GET',
        mflUserCookie: this.config.mflUserId!,
      });
      const response = await readResponse.json() as any;

      // Step 2: Parse the current trade bait entries for this franchise
      // MFL returns single object (not array) when there's only one franchise with trade bait
      let tradeBaitEntries: any[] = [];
      const rawEntries = response?.tradeBaits?.tradeBait;
      if (rawEntries) {
        tradeBaitEntries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
      }

      // Find the current franchise's entry
      const franchiseEntry = tradeBaitEntries.find(
        (entry: any) => entry.franchise_id === franchiseId
      );

      // Get current player IDs for this franchise
      let currentPlayerIds: string[] = [];
      if (franchiseEntry?.willGiveUp) {
        currentPlayerIds = typeof franchiseEntry.willGiveUp === 'string'
          ? franchiseEntry.willGiveUp.split(',').map((id: string) => id.trim()).filter(Boolean)
          : [String(franchiseEntry.willGiveUp)];
      }

      // Step 3: Merge or remove the player ID
      if (action === 'add') {
        if (currentPlayerIds.includes(playerId)) {
          return { success: true }; // Already on trade block
        }
        currentPlayerIds.push(playerId);
      } else {
        if (!currentPlayerIds.includes(playerId)) {
          return { success: true }; // Already not on trade block
        }
        currentPlayerIds = currentPlayerIds.filter(id => id !== playerId);
      }

      // Step 4: POST the complete updated list
      // Use the same baseUrl — api.myfantasyleague.com redirects to the correct www## host
      const importUrl = `${this.baseUrl}/${this.config.year}/import`;

      const params = new URLSearchParams();
      params.set('TYPE', 'tradeBait');
      params.set('L', this.config.leagueId);
      params.set('WILL_GIVE_UP', currentPlayerIds.join(','));
      params.set('IN_EXCHANGE_FOR', '');

      const importResponse = await mflFetch({
        url: importUrl,
        method: 'POST',
        mflUserCookie: this.config.mflUserId!,
        body: params.toString(),
      });

      // MFL returns HTTP 200 even for errors — check response body for error XML
      const responseText = await importResponse.text();
      if (responseText.includes('<error>')) {
        const errorMatch = responseText.match(/<error>(.*?)<\/error>/);
        const errorMsg = errorMatch?.[1] || 'Unknown MFL error';
        return { success: false, error: errorMsg };
      }

      // Build the complete list of all trade bait player IDs across ALL franchises
      // (matches the format of tradeBait.json used for local caching)
      const allPlayerIds = new Set<string>();
      for (const entry of tradeBaitEntries) {
        if (entry.franchise_id === franchiseId) continue; // Skip — we'll use our updated list
        if (entry.willGiveUp) {
          const ids = typeof entry.willGiveUp === 'string'
            ? entry.willGiveUp.split(',').map((id: string) => id.trim()).filter(Boolean)
            : [String(entry.willGiveUp)];
          ids.forEach(id => allPlayerIds.add(id));
        }
      }
      // Add the updated list for the current franchise
      currentPlayerIds.forEach(id => allPlayerIds.add(id));

      return { success: true, allPlayerIds: Array.from(allPlayerIds) };
    } catch (error) {
      console.error('Failed to update trade bait:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update trade bait',
      };
    }
  }

  /**
   * Move a player to / from Injured Reserve via MFL's import?TYPE=ir endpoint.
   *
   * Owner-mode auth (MFL_USER_ID cookie). Uses mflFetch() to survive the
   * api → www49 redirect that strips Cookie headers from raw fetch().
   *
   * direction='to'   → ACTIVATED=<id> (player moves ONTO IR)
   * direction='from' → DEACTIVATED=<id> (player moves OFF IR back to active)
   *
   * MFL's transaction record uses the same field names — `ACTIVATED` is the
   * player who has been "activated to IR status," not "activated to play."
   */
  async movePlayerToIR(
    playerId: string,
    franchiseId: string,
    direction: 'to' | 'from' = 'to',
  ): Promise<{ success: boolean; error?: string }> {
    return this.runRosterMove({
      type: 'ir',
      onParam: 'ACTIVATED',
      offParam: 'DEACTIVATED',
      playerId,
      franchiseId,
      direction,
    });
  }

  /**
   * Move a rookie to / from the Taxi (Practice) Squad via MFL's
   * import?TYPE=taxi_squad endpoint.
   *
   * direction='to'   → PROMOTED=<id> (player moves ONTO taxi)
   * direction='from' → DEMOTED=<id>  (player moves OFF taxi back to active)
   *
   * MFL enforces taxi-squad cap and rookie eligibility based on league rules;
   * caller should preflight where possible for friendlier UX.
   */
  async movePlayerToTaxi(
    playerId: string,
    franchiseId: string,
    direction: 'to' | 'from' = 'to',
  ): Promise<{ success: boolean; error?: string }> {
    return this.runRosterMove({
      type: 'taxi_squad',
      onParam: 'PROMOTED',
      offParam: 'DEMOTED',
      playerId,
      franchiseId,
      direction,
    });
  }

  /**
   * Shared internal helper for owner-mode roster bucket moves
   * (IR + Taxi share the exact same call shape, only param names differ).
   */
  private async runRosterMove(opts: {
    type: 'ir' | 'taxi_squad';
    onParam: 'ACTIVATED' | 'PROMOTED';
    offParam: 'DEACTIVATED' | 'DEMOTED';
    playerId: string;
    franchiseId: string;
    direction: 'to' | 'from';
  }): Promise<{ success: boolean; error?: string }> {
    if (!this.config.mflUserId) {
      return { success: false, error: 'Authentication required for roster moves' };
    }

    try {
      // POST directly to the league host (www49) — api.myfantasyleague.com 302s
      // here and mflFetch converts POST → GET on redirect, which silently no-ops
      // MFL's import endpoint (it serves the landing page and returns no error).
      const writeHost = process.env.MFL_WRITE_HOST || 'https://www49.myfantasyleague.com';
      const url = `${writeHost}/${this.config.year}/import?TYPE=${opts.type}&L=${this.config.leagueId}`;
      const params = new URLSearchParams();
      // FRANCHISE_ID in the body matches the working pattern in cut-player.ts /
      // mfl-contract-writer.ts. Owner mode tolerates it (cookie franchise must
      // match), and it's required if MFL flips into commissioner-mode parsing.
      params.set('FRANCHISE_ID', opts.franchiseId);
      if (opts.direction === 'to') {
        params.set(opts.onParam, opts.playerId);
        params.set(opts.offParam, '');
      } else {
        params.set(opts.onParam, '');
        params.set(opts.offParam, opts.playerId);
      }

      console.log(
        `[runRosterMove] POST ${url} body=${params.toString()} userCookie=${this.config.mflUserId ? 'present' : 'MISSING'}`,
      );

      const response = await mflFetch({
        url,
        method: 'POST',
        mflUserCookie: this.config.mflUserId,
        body: params.toString(),
      });

      const text = await response.text();
      console.log(
        `[runRosterMove] MFL response: ${response.status} ${response.headers.get('content-type') ?? ''} | body=${text.slice(0, 500)}`,
      );

      if (text.includes('<error>') || text.includes('"error"')) {
        const errorMatch =
          text.match(/<error[^>]*>(.*?)<\/error>/s) ||
          text.match(/"error"\s*:\s*"([^"]+)"/);
        return { success: false, error: errorMatch?.[1] || 'MFL rejected the request' };
      }

      if (!response.ok) {
        return { success: false, error: `MFL API error: ${response.status}` };
      }

      if (text.includes('<html') || text.includes('<!DOCTYPE')) {
        return { success: false, error: 'MFL did not process the request. Try again.' };
      }

      return { success: true };
    } catch (error) {
      console.error(`Failed to ${opts.direction === 'to' ? 'move to' : 'remove from'} ${opts.type}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Roster move failed',
      };
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