/**
 * Throwback Week welcome — the one-time "this week you are the …" popup.
 *
 * Shown to a signed-in owner on the first league page they open once their
 * league's throwback week has begun (the NFL calendar turning to that week,
 * `getCurrentNFLWeek`), naming and showing the identity they are wearing.
 * Until the week's first kickoff it also links to the era picker; after that
 * picks are locked (`isThrowbackPickLocked`) and the popup only announces.
 *
 * The identity is NOT resolved here. It is read from the same throwback-aware
 * band map the player modals paint from (`buildFranchiseBandBrands`), so the
 * popup can never show a different crest or name than the rest of the page —
 * the throwback-week insights doc is explicit that eras are only resolved at a
 * chokepoint.
 *
 * Deliberately keyed off the REAL current week (`?testDate=` honoured), never
 * `?week=`: `/live-scoring?week=4` in December is someone reading history, not
 * the start of Throwback Week.
 */

import type { LeagueSlug } from '../types/nav';
import { buildFranchiseBandBrands } from './franchise-band-brand';
import { resolveThrowbackAssignments, type ThrowbackPick } from './throwback-identity';
import {
  isThrowbackPickLocked,
  isThrowbackWeekForScope,
  strictThrowbackScopeForNavSlug,
} from './throwback-scope';
import { getCurrentNFLWeek } from './current-week';
import { hexToRgba, mixHex } from './nfl-team-colors';
import { getLeagueTeams } from './league-config';

/** `'08–'11`, or `'08` for a one-season era. */
export function formatThrowbackEraYears(yearStart: number, yearEnd?: number): string {
  const yy = (y: number) => `\u2019${String(y % 100).padStart(2, '0')}`;
  return !yearEnd || yearEnd === yearStart ? yy(yearStart) : `${yy(yearStart)}\u2013${yy(yearEnd)}`;
}

export interface ThrowbackWelcome {
  /** localStorage key — one sighting per device, per league, per throwback week. */
  storageKey: string;
  week: number;
  /** The name the owner is playing under this week. */
  name: string;
  /** The era's seasons (`'08–'11`); empty when the team wears its current look. */
  years: string;
  /** Crest drawn on the band (dark-safe art; the band is ink in both themes). */
  crest: string;
  crestFilter?: string;
  /** Band gradient stops + glow, computed the way `applyPlayerModalBand` does. */
  bandStart: string;
  bandEnd: string;
  bandGlow: string;
  /** True once the week's first kickoff has passed — no more era changes. */
  locked: boolean;
}

export interface ThrowbackWelcomeInput {
  league: LeagueSlug;
  /** The SESSION franchise for this league — never the preference cookie. */
  franchiseId: string | null;
  now: Date;
  /** Every owner's stored pick for this league's scope. */
  overrides: Record<string, ThrowbackPick>;
}

/** Null whenever there is nothing to announce. Pure — the caller reads the store. */
export function buildThrowbackWelcome(input: ThrowbackWelcomeInput): ThrowbackWelcome | null {
  const { league, franchiseId, now, overrides } = input;
  if (!franchiseId) return null;
  const scope = strictThrowbackScopeForNavSlug(league);
  if (!scope) return null;
  const week = getCurrentNFLWeek(now);
  if (!week || !isThrowbackWeekForScope(week, scope)) return null;

  const brand = buildFranchiseBandBrands(league, {
    throwbackActive: true,
    throwbackOverrides: overrides,
  }).teams[franchiseId];
  if (!brand?.name) return null;

  // The years come from the same league-wide assignment the band map resolves
  // through; they are only trusted when that era IS what the band shows.
  const era = resolveThrowbackAssignments(getLeagueTeams(scope), overrides, scope).eras.get(franchiseId);
  const years = era && era.name === brand.name ? formatThrowbackEraYears(era.yearStart, era.yearEnd) : '';

  // NFL season year: Jan–Aug belongs to the previous season (current-week.ts).
  const seasonYear = now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear();

  return {
    storageKey: `throwback-welcome:${scope}:${seasonYear}:w${week}`,
    week,
    name: brand.name,
    years,
    crest: brand.crest,
    ...(brand.crestFilter ? { crestFilter: brand.crestFilter } : {}),
    bandStart: mixHex(brand.primary, '#0b0e13', 0.62),
    bandEnd: brand.primary,
    bandGlow: hexToRgba(brand.secondary, 0.4),
    locked: isThrowbackPickLocked(scope, now),
  };
}
