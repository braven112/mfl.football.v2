/**
 * Building the live draft room's page data, for either league.
 *
 * The feed globs stay in each route (a static import specifier can't be a
 * runtime variable), but everything done with them is the same for both
 * leagues and lives here — which is what keeps the routes thin enough that
 * `draft/room.astro` is not a forked sibling (`tests/page-fork-ratchet`).
 *
 * The one real difference between the leagues is the DRAFT UNIT. TheLeague
 * drafts as a single `LEAGUE` unit; the AFL runs CONFERENCE00 and CONFERENCE01
 * as two independent boards that must never be crossed. `unit` selects one,
 * and it is threaded all the way through to the client's poll URL — see
 * `pollUnit` on DraftRoomPageData for why omitting it is a real bug rather
 * than a default.
 */

import { parseTradeFromComment, selectDraftUnit, type RawDraftUnit } from './draft-utils';
import type {
  DraftKind,
  DraftRoomPageData,
  DraftRoomPick,
  DraftRoomPlayer,
  DraftRoomTeam,
} from '../types/draft-room';

/** What Vite hands back for an eager glob. */
export type EagerFeedGlob = Record<string, unknown>;

const getModuleData = (mod: any) =>
  mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;

const seasonOf = (path: string): string | null => {
  const m = path.match(/mfl-feeds\/(\d{4})\//);
  return m ? m[1] : null;
};

/** Pull one season out of an eager glob. */
export function feedForYear(feeds: EagerFeedGlob, year: string | number): any {
  const key = Object.keys(feeds).find((p) => seasonOf(p) === String(year));
  return key ? getModuleData(feeds[key]) : null;
}

interface RawPick {
  round?: string;
  pick?: string;
  franchise?: string;
  player?: string;
  timestamp?: string;
  comments?: string;
}

/**
 * Turn one unit's raw picks into board rows.
 *
 * Sorted by (round, pickInRound) and then numbered SEQUENTIALLY rather than by
 * a fixed stride: rounds are not the same size — TheLeague's are 16/17/18
 * because of the toilet-bowl compensatory picks — so `(round - 1) * perRound`
 * collides across rounds.
 */
export function buildRoomPicks(unit: RawDraftUnit<RawPick> | null): DraftRoomPick[] {
  const raw = unit?.draftPick;
  const list: RawPick[] = raw ? (Array.isArray(raw) ? raw : [raw]) : [];

  return [...list]
    .sort((a, b) => {
      const r = parseInt(a.round || '1') - parseInt(b.round || '1');
      return r !== 0 ? r : parseInt(a.pick || '1') - parseInt(b.pick || '1');
    })
    .map((p, idx) => {
      const tradedFrom = parseTradeFromComment(p.comments || '');
      return {
        round: parseInt(p.round || '1'),
        pickInRound: parseInt(p.pick || '1'),
        overallPickNumber: idx + 1,
        franchiseId: p.franchise || '',
        playerId: p.player || '',
        timestamp: p.timestamp || '',
        comments: p.comments || '',
        isTraded: !!tradedFrom,
        originalTeamName: tradedFrom,
      };
    });
}

export interface BuildDraftRoomDataInput {
  leagueYear: number;
  /** Eagerly globbed `draftResults.json` for this league. */
  draftResultsFeeds: EagerFeedGlob;
  /** Eagerly globbed `league.json` for this league. */
  leagueFeeds: EagerFeedGlob;
  teams: DraftRoomTeam[];
  players: DraftRoomPlayer[];
  leagueId: string;
  partyHost: string;
  /**
   * MFL draft unit to read and to poll. Omit for a single-draft league; pass
   * `CONFERENCE00` / `CONFERENCE01` for a league that drafts by conference.
   */
  unit?: string;
  /** MFL host, when it is not TheLeague's (which the API assumes). */
  mflHost?: string;
  /**
   * Overrides MFL's league-wide `draft_kind`. The AFL needs it: its feed
   * declares one kind for a league whose two conferences draft differently.
   */
  draftKind?: DraftKind;
  /** Where this league/conference actually makes picks on MFL. */
  mflPickUrl?: string;
}

export function buildDraftRoomData(input: BuildDraftRoomDataInput): DraftRoomPageData {
  const yearStr = String(input.leagueYear);
  const draftResultsData = feedForYear(input.draftResultsFeeds, yearStr);
  const leagueData = feedForYear(input.leagueFeeds, yearStr);

  const unit = selectDraftUnit<RawPick>(
    draftResultsData?.draftResults?.draftUnit,
    input.unit ?? null
  );
  const picks = buildRoomPicks(unit);

  const rounds = new Set(picks.map((p) => p.round));
  const totalRounds = rounds.size || 3;
  const picksPerRound = totalRounds > 0 ? Math.ceil(picks.length / totalRounds) : 17;

  const leagueConfig = leagueData?.league || {};

  return {
    leagueYear: input.leagueYear,
    draftKind: input.draftKind ?? (leagueConfig.draft_kind === 'live' ? 'live' : 'email'),
    draftLimitHours: leagueConfig.draftLimitHours || '12:00',
    draftTimerSusp: leagueConfig.draftTimerSusp || '03 07',
    totalRounds,
    picksPerRound,
    teams: input.teams,
    picks,
    players: input.players,
    partyHost: input.partyHost,
    leagueId: input.leagueId,
    mflPickUrl: input.mflPickUrl,
    pollUnit: input.unit,
    mflHost: input.mflHost,
  };
}

/**
 * MFL's `baseURL` rotates between www49/www48/… behind its load balancer, so
 * the feed's own value is preferred and the registry host is the fallback.
 */
export function mflBaseUrlFor(leagueFeeds: EagerFeedGlob, year: string | number, fallbackHost: string): string {
  const leagueConfig = feedForYear(leagueFeeds, year)?.league || {};
  const base = (leagueConfig.baseURL as string | undefined) || `https://${fallbackHost}`;
  return base.replace(/\/$/, '');
}

/**
 * Which conference's draft room to show.
 *
 * Priority: an explicit `?conference=`, then the viewer's OWN conference,
 * then the first one. The viewer's own comes before any default because on
 * draft day the room they want is overwhelmingly the one they pick in —
 * landing an NL owner on the AL board is the failure this ordering avoids.
 *
 * An unrecognised param falls back rather than erroring: the two conference
 * ids are the only valid values and a bad one is a typo, not an attack.
 */
export function resolveRoomConference(
  requested: string | null | undefined,
  viewerConference: string | null | undefined,
  available: string[]
): string | null {
  if (available.length === 0) return null;
  // Accepts the bare code AND MFL's unit id, because the other two pages that
  // take `?conference=` do: the broadcast board links `?conference=00`, while
  // Draft Results' matcher takes either. A URL copied between them must not
  // silently land the reader on a different conference than the one they
  // copied.
  const want = (requested ?? '').trim().toUpperCase().replace(/^CONFERENCE/, '');
  const match = available.find((c) => c.trim().toUpperCase() === want);
  if (match) return match;
  if (viewerConference && available.includes(viewerConference)) return viewerConference;
  return available[0];
}
