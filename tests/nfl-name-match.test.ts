/**
 * Guard: the MFL Live board's NFL artwork fallback cannot put the wrong club's
 * mark on someone's team.
 *
 * Rung 2 of the identity ladder (docs/plans/mfl-live-app.md) gives a franchise
 * an NFL club's logo and brand colour when its NAME is that club. The whole
 * feature is only worth having because the rule cannot be wrong, so the
 * property below is the feature:
 *
 *   ZERO of the real franchise names in ANY league this site runs may match.
 *
 * Every one of them would be a false positive, and several are close enough to
 * catch a looser rule — "The Boondock Saints", "Cowboy Up", "Titsburgh
 * Feelers", "Music City Mafia". If a future alias breaks this, that alias is
 * wrong, not this test.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  matchNflTeamName,
  normalizeTeamName,
  knownNflTeamNames,
  NFL_LEGACY_NAMES,
} from '../src/utils/nfl-name-match';
import { NFL_TEAM_NAMES } from '../src/utils/nfl-logo';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const ROOT = path.resolve(__dirname, '..');

/**
 * Every franchise name in every league, read through the REGISTRY's
 * `configPath` rather than a hardcoded file list — a league added to the
 * registry is covered here without anyone remembering to add it.
 */
function everyFranchise(): Array<{ league: string; name: string; nameShort?: string; abbrev?: string }> {
  const out: Array<{ league: string; name: string; nameShort?: string; abbrev?: string }> = [];
  for (const league of Object.values(LEAGUES) as Array<{ slug: string; configPath?: string }>) {
    if (!league.configPath) continue;
    const abs = path.join(ROOT, league.configPath);
    if (!fs.existsSync(abs)) continue;
    const config = JSON.parse(fs.readFileSync(abs, 'utf8')) as { teams?: Array<Record<string, unknown>> };
    for (const team of config.teams ?? []) {
      const name = team.name;
      if (typeof name !== 'string' || !name.trim()) continue;
      out.push({
        league: league.slug,
        name,
        nameShort: typeof team.nameShort === 'string' ? team.nameShort : undefined,
        abbrev: typeof team.abbrev === 'string' ? team.abbrev : undefined,
      });
    }
  }
  return out;
}

describe('NFL name match — the zero-false-positive property', () => {
  const franchises = everyFranchise();

  it('reads franchise names from every league in the registry', () => {
    // If this drops to nothing the assertion below passes vacuously, which
    // would retire the guard silently.
    expect(franchises.length).toBeGreaterThan(30);
    const leagues = new Set(franchises.map((f) => f.league));
    expect(leagues.size).toBeGreaterThanOrEqual(2);
  });

  it('matches NONE of their full names', () => {
    const hits = franchises
      .filter((f) => matchNflTeamName(f.name) !== null)
      .map((f) => `${f.league}: "${f.name}" -> ${matchNflTeamName(f.name)}`);
    expect(
      hits,
      'a real franchise name matched an NFL club — the mark would be wrong on that owner\'s team',
    ).toEqual([]);
  });
});

describe('NFL name match — only the FULL name is a valid input', () => {
  /**
   * Found by this guard on its first run, and the reason the rule is written
   * down rather than assumed.
   *
   * The AFL's "The Boondock Saints" is a film reference that correctly matches
   * nothing — but its `nameShort` is "Saints" and its `abbrev` is "SAINTS",
   * and both of those match NEW ORLEANS. A short name is a label an owner
   * picked for column widths; matching one asks a question its author never
   * answered, and the result is a plausible-looking wrong mark.
   *
   * So the hazard is pinned as a POSITIVE assertion — these forms really do
   * match, which is exactly why nothing may feed them to the matcher.
   */
  const franchises = everyFranchise();

  it('the short forms of a real franchise DO match, which is the trap', () => {
    const boondock = franchises.find((f) => f.name === 'The Boondock Saints');
    expect(boondock, 'the franchise this rule was learned from is gone — re-derive the rule').toBeTruthy();
    expect(matchNflTeamName(boondock!.name)).toBeNull();
    expect(matchNflTeamName(boondock!.nameShort)).toBe('NO');
    expect(matchNflTeamName(boondock!.abbrev)).toBe('NO');
  });

  it('names every short form in the repo that would match, so the list is not a surprise', () => {
    const shortHits = franchises
      .flatMap((f) => [f.nameShort, f.abbrev])
      .filter((v): v is string => typeof v === 'string' && matchNflTeamName(v) !== null);
    // Not asserted empty — it CANNOT be, and pretending otherwise would hide
    // the hazard. Asserted small and known, so a new one shows up as a diff.
    expect(new Set(shortHits.map((s) => s.toLowerCase()))).toEqual(new Set(['saints']));
  });
});

describe('NFL name match — the rule', () => {
  it('every nickname is unique, which is what makes bare nicknames safe', () => {
    // "Cowboys" can only resolve if exactly one club owns that last word. A
    // future expansion team sharing a nickname would silently make one of them
    // unreachable, so this is checked rather than assumed.
    const byNickname = new Map<string, string[]>();
    for (const [code, full] of Object.entries(NFL_TEAM_NAMES)) {
      const nickname = normalizeTeamName(full).split(' ').pop() ?? '';
      byNickname.set(nickname, [...(byNickname.get(nickname) ?? []), code]);
    }
    const collisions = [...byNickname.entries()].filter(([, codes]) => codes.length > 1);
    expect(collisions, 'two clubs share a nickname').toEqual([]);
    expect(byNickname.size).toBe(32);
  });

  it.each([
    ['Cowboys', 'DAL'],
    ['cowboys', 'DAL'],
    ['COWBOYS', 'DAL'],
    ['The Cowboys', 'DAL'],
    ['Dallas Cowboys', 'DAL'],
    ['  Dallas   Cowboys  ', 'DAL'],
    ['49ers', 'SF'],
    ['San Francisco 49ers', 'SF'],
    ['Washington Commanders', 'WSH'],
  ])('%s matches %s', (name, code) => {
    expect(matchNflTeamName(name)).toBe(code);
  });

  it.each([
    'Cowboy Up',
    'The Boondock Saints',
    'Titsburgh Feelers',
    'Music City Mafia',
    'Get off my Ditka',
    'Bills Mafia',
    'Chiefs of Staff',
    'Lions Den',
    'Da Bears',
    'Niners',
    'Bucs',
    '',
    '   ',
  ])('%s does not match', (name) => {
    expect(matchNflTeamName(name)).toBeNull();
  });

  it('treats a nullish name as no match rather than throwing', () => {
    expect(matchNflTeamName(null)).toBeNull();
    expect(matchNflTeamName(undefined)).toBeNull();
  });

  it('folds punctuation to a space rather than deleting it', () => {
    // "st.louis" would be a different string from "st louis" if punctuation
    // simply vanished, and the legacy key is the spaced form.
    expect(normalizeTeamName('St. Louis Rams')).toBe('st louis rams');
    expect(normalizeTeamName("The  Cowboys!")).toBe('cowboys');
  });

  it('drops only a LEADING article, and only "the"', () => {
    expect(normalizeTeamName('The Cowboys')).toBe('cowboys');
    // Not a leading article — the word survives, so this cannot match.
    expect(normalizeTeamName('Da Dangsters')).toBe('da dangsters');
    expect(matchNflTeamName('Da Bears')).toBeNull();
  });

  it('never strips an article that IS the whole name', () => {
    // Guards a shift() that would leave an empty array.
    expect(normalizeTeamName('The')).toBe('the');
    expect(matchNflTeamName('The')).toBeNull();
  });
});

describe('NFL name match — relocations and renames', () => {
  it.each(Object.entries(NFL_LEGACY_NAMES))('%s resolves to %s', (name, code) => {
    expect(matchNflTeamName(name)).toBe(code);
  });

  it('every legacy target is a real current club', () => {
    for (const code of Object.values(NFL_LEGACY_NAMES)) {
      expect(NFL_TEAM_NAMES[code], `${code} is not a current NFL code`).toBeTruthy();
    }
  });

  it('legacy keys are stored already-normalized', () => {
    // They are looked up in normalized form, so a key carrying punctuation or
    // a leading article would be dead weight that never matches.
    for (const name of Object.keys(NFL_LEGACY_NAMES)) {
      expect(normalizeTeamName(name), `${name} is not in normalized form`).toBe(name);
    }
  });

  it('ships relocations only — no nickname aliases', () => {
    // The plan's explicit call: the alias table is the extension point and
    // owner feedback fills it. A nickname alias added here without revisiting
    // the zero-false-positive property above is the regression this catches.
    const nicknames = new Set(
      Object.values(NFL_TEAM_NAMES).map((full) => normalizeTeamName(full).split(' ').pop()),
    );
    for (const name of Object.keys(NFL_LEGACY_NAMES)) {
      expect(nicknames.has(name), `${name} is a bare nickname, not a former name`).toBe(false);
      expect(name.split(' ').length, `${name} should be a full former name`).toBeGreaterThan(1);
    }
  });
});

describe('NFL name match — the accepted set', () => {
  it('is exactly 32 full names + 32 nicknames + the legacy table', () => {
    // A number that moves without a deliberate change means the index grew a
    // form nobody decided on.
    expect(knownNflTeamNames().length).toBe(64 + Object.keys(NFL_LEGACY_NAMES).length);
  });
});
