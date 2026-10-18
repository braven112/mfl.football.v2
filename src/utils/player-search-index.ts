/**
 * The player half of the header's inline search (HeaderSearch.astro).
 *
 * Built from the league's committed MFL feeds — players.json for names,
 * rosters.json for who holds each player, league.json for team names — and
 * served as a prerendered file (src/pages/api/player-search/[league].json.ts),
 * so it is exactly as fresh as the build-baked pages around it and costs no
 * function call or MFL request per search.
 *
 * Only positions this league actually rosters are listed (players.json is
 * every player MFL knows, defensive linemen and punters included), and a
 * player can have MORE than one owner: an AFL player is routinely held once
 * in each conference, so ownership is a list (getOwnersByPlayer), never one id.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';
import { getLeagueYearForSlug } from './league-year';
import { getOwnersByPlayer } from './offseason-hero-data';

export interface PlayerSearchEntry {
  id: string;
  /** "First Last" — MFL stores "Last, First". */
  name: string;
  pos: string;
  team: string;
  /** Franchise ids holding him, in roster order; empty for a free agent. */
  owners: string[];
  /** name both ways + team + position, lowercased — what a query matches. */
  search: string;
}

export interface PlayerSearchIndex {
  year: number;
  /** Franchise id → team name, for the owners above. */
  teams: Record<string, string>;
  players: PlayerSearchEntry[];
}

function readFeed(dataPath: string, year: number, file: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), dataPath, 'mfl-feeds', String(year), file), 'utf8'));
  } catch {
    return null;
  }
}

const asArray = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** "Allen, Josh" → "Josh Allen"; a team unit ("Bills, Buffalo") reads "Buffalo Bills". */
export function displayName(mflName: string): string {
  const [last, first] = mflName.split(',').map((s) => s.trim());
  return first ? `${first} ${last}` : mflName.trim();
}

export function buildPlayerSearchIndex(league: CanonicalLeagueSlug): PlayerSearchIndex {
  const def = getLeagueBySlug(league);
  if (!def) return { year: 0, teams: {}, players: [] };

  // Between a league rollover and the first sync the new year's directory can
  // be missing; last year's feeds are the honest fallback.
  const current = getLeagueYearForSlug(league);
  const year = [current, current - 1].find((y) => readFeed(def.dataPath, y, 'players.json')) ?? current;

  const players = asArray<any>(readFeed(def.dataPath, year, 'players.json')?.players?.player);
  const owners = getOwnersByPlayer(year, league, { activeOnly: false });
  const franchises = asArray<any>(readFeed(def.dataPath, year, 'league.json')?.league?.franchises?.franchise);
  const teams: Record<string, string> = {};
  for (const f of franchises) if (f?.id) teams[f.id] = String(f.name ?? f.id).trim();

  const byId = new Map(players.map((p) => [String(p.id), p]));
  const rosteredPositions = new Set(
    [...owners.keys()].map((id) => byId.get(id)?.position).filter(Boolean) as string[],
  );

  const entries: PlayerSearchEntry[] = [];
  for (const p of players) {
    if (!p?.id || !p.name || !rosteredPositions.has(p.position)) continue;
    const id = String(p.id);
    const name = displayName(String(p.name));
    const team = String(p.team ?? '');
    entries.push({
      id,
      name,
      pos: String(p.position),
      team,
      owners: owners.get(id) ?? [],
      search: [name, p.name, team, p.position].join(' ').toLowerCase(),
    });
  }
  return { year, teams, players: entries };
}
