/**
 * The My Team page for the MFL Football app, for ANY MFL league the account is
 * in: the roster with slots, injuries and byes, the cap and contracts where the
 * league uses them, and the draft picks the team holds.
 *
 * Split in two on purpose. `readMflLiveTeam` does the network work (five MFL
 * exports with the owner's own cookie, in parallel); `buildMflLiveTeam` is a
 * pure function of those payloads, which is what the tests pin.
 *
 * ── THE CAP IS MFL'S OWN ARITHMETIC ───────────────────────────────────────
 * A league outside this site has rules we do not know, so the cap is read off
 * the league's own settings rather than any one league's constitution: the
 * active roster in full, IR at `includeIRWithSalary` percent, the taxi squad
 * at `includeTaxiWithSalary` percent, plus `salaryAdjustments` (dead money).
 * TheLeague's settings (IR 100, taxi 50) reproduce the number MFL shows.
 *
 * ── A FAILED ROSTER READ IS A FAILURE, NOT AN EMPTY TEAM ──────────────────
 * MFL answers errors and throttling as HTTP 200 (docs/claude/rules/lineups.md),
 * so a body is only a roster when it parses AND carries no `error`. Without
 * the roster there is nothing to show and the caller says so; the other
 * reads are decoration and degrade to "not shown" on their own.
 *
 * SERVER-SIDE ONLY. Store-safe: no headshots, no ESPN ids, no NFL marks.
 */

import type {
  MflLiveAppDraftPick,
  MflLiveAppRosterPlayer,
  MflLiveAppRosterSlot,
  MflLiveAppTeamCap,
  MflLiveAppTeamPage,
} from '../../../packages/shared-types/src/mfl-live-app-team';
import { buildMflExportUrl } from '../mfl-url';
import { mflFetch } from '../mfl-fetch';
import { getPlayerMap } from '../player-map';
import { formatMflName } from '../player-name-matching';
import { positionLabel, positionRank } from '../mfl-live-lineup';
import { byeWeeksByTeam } from '../nfl-bye-lookup';
import { byeWeeksForSeason } from '../nfl-bye-weeks';
import { normalizeTeamCode } from '../nfl-logo';
import { loadLiveInjuryMap } from '../mfl-injuries-live-map';
import type { InjuryMap } from '../mfl-injuries';

/** The league and team the page is for — already checked against the account. */
export interface MflLiveTeamLeague {
  leagueId: string;
  leagueName: string;
  franchiseId: string;
  franchiseName: string;
  /** MFL league year. */
  year: number;
  /** The league's MFL origin, e.g. https://www49.myfantasyleague.com. */
  host: string | null;
}

export interface PlayerIdentityLite {
  name: string;
  position: string;
  nflTeam: string;
}

export interface BuildMflLiveTeamInput {
  league: MflLiveTeamLeague;
  rosters: unknown;
  leagueSettings?: unknown;
  futurePicks?: unknown;
  draftResults?: unknown;
  adjustments?: unknown;
  identity: (id: string) => PlayerIdentityLite | undefined;
  injuries: InjuryMap;
  /** NFL club → bye week, either dialect of code. */
  byes: Record<string, number>;
  now: Date;
}

const asArray = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);
const pad = (id: unknown) => {
  const s = `${id ?? ''}`.trim();
  return /^\d+$/.test(s) ? s.padStart(4, '0') : s;
};
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : parseFloat(`${v ?? ''}`);
  return Number.isFinite(n) ? n : undefined;
};

/** A payload that parsed and is not one of MFL's 200-status errors. */
export function isReadable(body: unknown): body is Record<string, any> {
  return !!body && typeof body === 'object' && !(body as { error?: unknown }).error;
}

export const SLOT_BY_STATUS: Record<string, MflLiveAppRosterSlot> = {
  ROSTER: 'active',
  INJURED_RESERVE: 'ir',
  TAXI_SQUAD: 'taxi',
};
const SLOT_ORDER: MflLiveAppRosterSlot[] = ['active', 'ir', 'taxi'];

/** This franchise's row of a `rosters` export, or null when it is not there. */
export function findRoster(rosters: unknown, franchiseId: string): Record<string, any> | null {
  if (!isReadable(rosters)) return null;
  const rows = asArray<any>((rosters as any).rosters?.franchise);
  return rows.find((r) => pad(r?.id) === franchiseId) ?? null;
}

/**
 * Assemble the page from MFL's payloads. Returns null when the roster itself
 * is not readable — the one read the page cannot do without.
 */
export function buildMflLiveTeam(input: BuildMflLiveTeamInput): MflLiveAppTeamPage | null {
  const { league, identity, injuries, byes } = input;
  const roster = findRoster(input.rosters, league.franchiseId);
  if (!roster) return null;

  const settings = isReadable(input.leagueSettings) ? (input.leagueSettings as any).league ?? {} : {};
  const usesSalaries = `${settings.usesSalaries ?? ''}` === '1';
  const usesContracts = `${settings.usesContractYear ?? ''}` === '1';

  const franchiseRows = asArray<any>(settings.franchises?.franchise);
  const teamNames = new Map<string, string>(
    franchiseRows.map((f) => [pad(f?.id), `${f?.name ?? ''}`.trim()] as [string, string]),
  );
  const own = franchiseRows.find((f) => pad(f?.id) === league.franchiseId);
  const icon = [own?.icon, own?.logo].map((u) => `${u ?? ''}`.trim()).find((u) => u.startsWith('https://'));

  const players: MflLiveAppRosterPlayer[] = asArray<any>(roster.player)
    .filter((p) => `${p?.id ?? ''}`.trim())
    .map((p) => {
      const id = `${p.id}`.trim();
      const who = identity(id);
      const nflTeam = who?.nflTeam ?? '';
      const row: MflLiveAppRosterPlayer = {
        id,
        name: who?.name || `Player ${id}`,
        position: positionLabel(who?.position ?? ''),
        nflTeam,
        slot: SLOT_BY_STATUS[`${p.status ?? ''}`.toUpperCase()] ?? 'active',
      };
      const hurt = injuries[id];
      if (hurt?.injuryStatus) {
        row.injury = { status: hurt.injuryStatus, ...(hurt.injuryBodyPart ? { detail: hurt.injuryBodyPart } : {}) };
      }
      const bye = nflTeam ? byes[nflTeam] ?? byes[normalizeTeamCode(nflTeam)] : undefined;
      if (bye) row.byeWeek = bye;
      if (usesSalaries) row.salary = num(p.salary) ?? 0;
      if (usesContracts) {
        const years = num(p.contractYear);
        if (years !== undefined) row.contractYears = years;
        const info = `${p.contractInfo ?? ''}`.trim();
        if (info) row.contractInfo = info;
      }
      return row;
    })
    .sort(
      (a, b) =>
        SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) ||
        positionRank(a.position) - positionRank(b.position) ||
        (b.salary ?? 0) - (a.salary ?? 0) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );

  return {
    ok: true,
    leagueId: league.leagueId,
    leagueName: `${settings.name ?? ''}`.trim() || league.leagueName,
    year: league.year,
    ...(num(roster.week) ? { week: num(roster.week) } : {}),
    franchiseId: league.franchiseId,
    franchiseName: teamNames.get(league.franchiseId) || league.franchiseName || `Team ${league.franchiseId}`,
    ...(icon ? { icon } : {}),
    players,
    cap: usesSalaries ? capFor(settings, players, input.adjustments, league.franchiseId) : null,
    usesContracts,
    limits: limitsFor(settings),
    picks: picksFor(input.futurePicks, input.draftResults, league, teamNames),
    generatedAt: input.now.toISOString(),
  };
}

/** MFL's own cap arithmetic (see the header). The auction room's budget reads it too. */
export function capFor(
  settings: Record<string, any>,
  players: Pick<MflLiveAppRosterPlayer, 'salary' | 'slot'>[],
  adjustmentsPayload: unknown,
  franchiseId: string,
): MflLiveAppTeamCap | null {
  const cap = num(settings.salaryCapAmount);
  if (!cap) return null;
  // MFL's own shares; a league that never set them counts the slot in full.
  const share = (v: unknown) => (num(v) ?? 100) / 100;
  const weight: Record<MflLiveAppRosterSlot, number> = {
    active: 1,
    ir: share(settings.includeIRWithSalary),
    taxi: share(settings.includeTaxiWithSalary),
  };
  const salaries = players.reduce((sum, p) => sum + (p.salary ?? 0) * weight[p.slot], 0);
  const adjustments = isReadable(adjustmentsPayload)
    ? asArray<any>((adjustmentsPayload as any).salaryAdjustments?.salaryAdjustment)
        .filter((a) => pad(a?.franchise_id) === franchiseId)
        .reduce((sum, a) => sum + (num(a?.amount) ?? 0), 0)
    : 0;
  const committed = Math.round(salaries + adjustments);
  return { cap, committed, room: cap - committed, adjustments: Math.round(adjustments) };
}

function limitsFor(settings: Record<string, any>): MflLiveAppTeamPage['limits'] {
  const out: MflLiveAppTeamPage['limits'] = {};
  const roster = num(settings.rosterSize);
  const ir = num(settings.injuredReserve);
  const taxi = num(settings.taxiSquad);
  if (roster) out.roster = roster;
  if (ir) out.ir = ir;
  if (taxi) out.taxi = taxi;
  return out;
}

/**
 * This year's unmade picks (from `draftResults`, once MFL has set the order)
 * and every future pick (`futureDraftPicks`), soonest first.
 *
 * `draftUnit` is an object for most leagues and an ARRAY for a league that
 * drafts by conference (the AFL, docs/plans/draft-hub-and-results.md), and a
 * made pick names its player — so only rows with no player are still held.
 */
function picksFor(
  futurePayload: unknown,
  draftPayload: unknown,
  league: MflLiveTeamLeague,
  teamNames: Map<string, string>,
): MflLiveAppDraftPick[] {
  const picks: MflLiveAppDraftPick[] = [];
  const fromLabel = (orig: string) =>
    orig && orig !== league.franchiseId ? teamNames.get(orig) || `Team ${orig}` : undefined;

  if (isReadable(draftPayload)) {
    for (const unit of asArray<any>((draftPayload as any).draftResults?.draftUnit)) {
      for (const p of asArray<any>(unit?.draftPick)) {
        if (pad(p?.franchise) !== league.franchiseId || `${p?.player ?? ''}`.trim()) continue;
        const round = num(p.round);
        const pick = num(p.pick);
        if (!round) continue;
        picks.push({
          year: league.year,
          round,
          ...(pick ? { pick } : {}),
          label: pick ? `${league.year} ${round}.${String(pick).padStart(2, '0')}` : `${league.year} Round ${round}`,
        });
      }
    }
  }

  if (isReadable(futurePayload)) {
    const rows = asArray<any>((futurePayload as any).futureDraftPicks?.franchise);
    const mine = rows.find((r) => pad(r?.id) === league.franchiseId);
    for (const p of asArray<any>(mine?.futureDraftPick)) {
      const year = num(p?.year);
      const round = num(p?.round);
      if (!year || !round) continue;
      const fromTeam = fromLabel(pad(p.originalPickFor));
      picks.push({
        year,
        round,
        ...(fromTeam ? { fromTeam } : {}),
        label: `${year} Round ${round}${fromTeam ? ` (from ${fromTeam})` : ''}`,
      });
    }
  }

  return picks.sort((a, b) => a.year - b.year || a.round - b.round || (a.pick ?? 99) - (b.pick ?? 99));
}

/** One MFL export with the owner's cookie; null for anything that is not a usable payload. */
async function readExport(
  league: MflLiveTeamLeague,
  mflUserCookie: string,
  type: string,
  params: Record<string, string | number> = {},
): Promise<Record<string, any> | null> {
  try {
    const url = buildMflExportUrl({
      type,
      leagueId: league.leagueId,
      year: league.year,
      params,
      ...(league.host ? { host: league.host } : {}),
    });
    const res = await mflFetch({ url, method: 'GET', mflUserCookie });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!isReadable(body)) {
      if (body) console.warn(`[mfl-live-team] ${type} for ${league.leagueId}: ${String((body as any).error).slice(0, 120)}`);
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

/**
 * Names for players the bundled player map does not carry — an IDP league's
 * linebackers, a rookie the nightly feed has not caught up with. One public
 * `players` export for just those ids; a miss falls back to "Player <id>".
 */
async function readMissingIdentities(year: number, ids: string[]): Promise<Map<string, PlayerIdentityLite>> {
  const out = new Map<string, PlayerIdentityLite>();
  if (ids.length === 0) return out;
  try {
    // Public export, so no cookie: the owner's credential goes only where it must.
    const query = new URLSearchParams({ TYPE: 'players', PLAYERS: ids.join(','), JSON: '1' });
    const res = await fetch(`https://api.myfantasyleague.com/${year}/export?${query}`, {
      signal: AbortSignal.timeout(6000),
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    for (const p of asArray<any>(body?.players?.player)) {
      if (!p?.id) continue;
      out.set(`${p.id}`, {
        name: formatMflName(`${p.name ?? ''}`),
        position: `${p.position ?? ''}`,
        nflTeam: normalizeTeamCode(`${p.team ?? ''}`),
      });
    }
  } catch {
    /* fall back to ids */
  }
  return out;
}

/**
 * Read and assemble the page. Null when MFL would not give us the roster —
 * the route answers that as a failed read, never as an empty team.
 */
export async function readMflLiveTeam(
  league: MflLiveTeamLeague,
  mflUserCookie: string,
  now: Date = new Date(),
): Promise<MflLiveAppTeamPage | null> {
  const [rosters, leagueSettings, futurePicks, draftResults, adjustments, injuries] = await Promise.all([
    readExport(league, mflUserCookie, 'rosters', { FRANCHISE: league.franchiseId }),
    readExport(league, mflUserCookie, 'league'),
    readExport(league, mflUserCookie, 'futureDraftPicks', { FRANCHISE: league.franchiseId }),
    readExport(league, mflUserCookie, 'draftResults'),
    readExport(league, mflUserCookie, 'salaryAdjustments'),
    // NFL-wide, so the site's live injury report serves every league.
    loadLiveInjuryMap('theleague').catch((): InjuryMap => ({})),
  ]);
  if (!findRoster(rosters, league.franchiseId)) return null;

  const map = getPlayerMap(league.year);
  const ids = asArray<any>(findRoster(rosters, league.franchiseId)?.player).map((p) => `${p?.id ?? ''}`.trim());
  const missing = await readMissingIdentities(
    league.year,
    ids.filter((id) => id && !map.has(id)),
  );
  const identity = (id: string): PlayerIdentityLite | undefined => {
    const hit = map.get(id);
    return hit ? { name: hit.name, position: hit.position, nflTeam: hit.nflTeam } : missing.get(id);
  };

  // Byes belong to the NFL season of the calendar year (nfl-bye-lookup.ts).
  const season = now.getFullYear();
  const byes = byeWeeksByTeam({ seasons: { [String(season)]: byeWeeksForSeason(season) ?? {} } }, now);

  return buildMflLiveTeam({
    league,
    rosters,
    leagueSettings,
    futurePicks,
    draftResults,
    adjustments,
    identity,
    injuries,
    byes,
    now,
  });
}
