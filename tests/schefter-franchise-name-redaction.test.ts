/**
 * Franchise-name redaction — a team is identifiable by EVERY name it has
 * ever answered to, not just its current one.
 *
 * The bug this locks in (AFL, 2026-08-15): a rumor post scoped to Balls Deep
 * printed "Hearing Balls Deep and a former Cock Gobbler front office are in
 * ongoing negotiations…" — naming a second team, which the trade playbook
 * forbids. "Cock Gobbler" is The Show's 2025 last-place punitive rebrand,
 * parked in `history[]` in afl.config.json. The redactor's token harvest read
 * only the four CURRENT name fields, so the tipster's raw text sailed through
 * untouched and the LLM repeated it.
 *
 * Retired names are the sharper risk of the two gaps closed here: a punitive
 * rebrand is recent, memorable, and points at exactly one franchise. Aliases
 * ("Pigs", "Mavs") are the same failure with a smaller blast radius.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-ignore — sibling .mjs module, no .d.ts
import { anonymizeTips } from '../scripts/schefter-rumor-scan.mjs';

const SCANNER_SRC = readFileSync(
  path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
  'utf8',
);

type TeamEntry = {
  name: string;
  nameShort?: string;
  abbrev?: string;
  division?: string;
  aliases?: string[];
  history?: Array<{ name?: string; nameShort?: string; abbrev?: string }>;
};

// Shaped exactly like loadTeams()' output, including the two fields whose
// absence caused the leak.
const teams = new Map<string, TeamEntry>([
  ['0001', {
    name: 'Pacific Pigskins',
    nameShort: 'Pigskins',
    abbrev: 'SKINS',
    division: 'Northwest',
    aliases: ['Pigs'],
    history: [{ name: 'Sabertooths', abbrev: 'SBR' }],
  }],
  ['0002', {
    name: 'Nashville Geeks',
    nameShort: 'Geeks',
    division: 'Northwest',
    aliases: ['Nerds'],
    history: [{ name: 'Cock Gobbler' }],
  }],
  ['0003', {
    name: 'Southwest Mafia',
    nameShort: 'Mafia',
    division: 'Southwest',
  }],
]);

/** Two web tips on one franchise → `franchise-multi-source`, which is the
 *  scope that sets keepFranchise (HARD RULE 4 lets Schefter name it). */
async function anonymizeMultiSource(text: string, franchiseHint = '0001') {
  const now = Date.now();
  const out = await anonymizeTips(
    [
      { id: 't1', source: 'web', topic: 'roster', text, franchiseHint, submittedAt: now },
      { id: 't2', source: 'web', topic: 'roster', text: 'Heard the same', franchiseHint, submittedAt: now },
    ],
    teams,
  );
  return out[0];
}

/** One unattributed web tip → league-wide/division fuzz, keepFranchise null,
 *  so EVERY franchise name should be scrubbed. */
async function anonymizeFuzzed(text: string) {
  const out = await anonymizeTips(
    [{ id: 't1', source: 'web', topic: 'roster', text, submittedAt: Date.now() }],
    teams,
  );
  return out[0];
}

describe('franchise-name redaction — retired names', () => {
  it('redacts another franchise\'s retired name (the Cock Gobbler leak)', async () => {
    const safe = await anonymizeMultiSource(
      'Hearing Pigskins and a former Cock Gobbler front office are talking',
    );
    expect(safe.scope.kind).toBe('franchise-multi-source');
    expect(safe.text).not.toMatch(/Cock Gobbler/i);
    expect(safe.text).toContain('[a team]');
    // The scoped franchise is still nameable — that's the whole point of
    // multi-source scope; only the SECOND team gets fuzzed.
    expect(safe.text).toContain('Pigskins');
  });

  it('redacts a retired name under fuzzed scope too', async () => {
    const safe = await anonymizeFuzzed('Cock Gobbler and the Sabertooths are up to something');
    expect(safe.text).not.toMatch(/Cock Gobbler/i);
    expect(safe.text).not.toMatch(/Sabertooths/i);
  });

  it('matches retired names case-insensitively', async () => {
    const safe = await anonymizeFuzzed('heard it from the COCK GOBBLER desk');
    expect(safe.text).not.toMatch(/cock gobbler/i);
  });
});

describe('franchise-name redaction — aliases', () => {
  it('redacts another franchise\'s alias', async () => {
    const safe = await anonymizeMultiSource('Pigskins are circling the Nerds roster');
    expect(safe.text).not.toMatch(/\bNerds\b/);
    expect(safe.text).toContain('[a team]');
  });
});

describe('franchise-name redaction — kept franchise normalizes to its canonical name', () => {
  it('rewrites the kept franchise\'s alias to the display name rather than fuzzing it', async () => {
    const safe = await anonymizeMultiSource('The Pigs are shopping a TE');
    expect(safe.scope.franchise).toBe('Pigskins');
    expect(safe.text).toContain('Pigskins');
    expect(safe.text).not.toMatch(/\bPigs\b/);
    expect(safe.text).not.toContain('[a team]');
  });

  it('rewrites the kept franchise\'s OWN retired name to the current one', async () => {
    // Naming the team is allowed here — but Schefter should print today's
    // name, not the one it wore two rebrands ago.
    const safe = await anonymizeMultiSource('The Sabertooths are shopping a TE');
    expect(safe.text).toContain('Pigskins');
    expect(safe.text).not.toMatch(/Sabertooths/i);
  });

  it('still fuzzes every OTHER franchise while normalizing the kept one', async () => {
    const safe = await anonymizeMultiSource('Pigs and the Nashville Geeks are talking');
    expect(safe.text).toContain('Pigskins');
    expect(safe.text).not.toMatch(/Nashville Geeks/i);
    expect(safe.text).toContain('[a team]');
  });
});

describe('franchise-name redaction — scopes that return early still scrub', () => {
  // league-wide and commish sit above the fall-through redaction and used to
  // return their text untouched. They are the scopes that need it most:
  // league-wide means "not pinned to anybody", so a franchise name surviving
  // in the raw text hands the LLM the one detail the scope exists to withhold.
  it('scrubs current names under league-wide scope', async () => {
    const safe = await anonymizeFuzzed('Somebody tell the Nashville Geeks to answer their phone');
    expect(safe.scope.kind).toBe('league-wide');
    expect(safe.text).not.toMatch(/Nashville Geeks/i);
    expect(safe.text).toContain('[a team]');
  });

  it('scrubs franchise names under commish scope', async () => {
    const out = await anonymizeTips(
      [{
        id: 't1',
        source: 'web',
        topic: 'frontoffice',
        text: 'The commish is stonewalling the Southwest Mafia on a protest',
        franchiseHint: 'commish',
        submittedAt: Date.now(),
      }],
      teams,
    );
    expect(out[0].scope.kind).toBe('commish');
    expect(out[0].text).not.toMatch(/Southwest Mafia/i);
    expect(out[0].text).toContain('[a team]');
  });
});

describe('franchise-name redaction — real league configs', () => {
  // A synthetic map proves the redactor works; this proves the CONFIGS have
  // nothing the redactor can't see. Both leagues carry history and aliases.
  const CONFIGS = [
    ['theleague', 'src/data/theleague.config.json'],
    ['afl-fantasy', 'data/afl-fantasy/afl.config.json'],
  ] as const;

  for (const [label, configPath] of CONFIGS) {
    it(`scrubs every alias and retired name in ${label}'s config`, async () => {
      const raw = JSON.parse(readFileSync(path.join(process.cwd(), configPath), 'utf8'));
      const realTeams = new Map<string, TeamEntry>();
      const tokens: string[] = [];
      for (const t of raw.teams ?? []) {
        realTeams.set(t.franchiseId, {
          name: t.name,
          nameShort: t.nameShort,
          abbrev: t.abbrev,
          division: t.division,
          aliases: Array.isArray(t.aliases) ? t.aliases : [],
          history: Array.isArray(t.history) ? t.history : [],
        });
        for (const alias of t.aliases ?? []) {
          if (typeof alias === 'string' && alias.trim().length >= 2) tokens.push(alias.trim());
        }
        for (const h of t.history ?? []) {
          for (const field of ['name', 'nameMedium', 'nameShort', 'abbrev'] as const) {
            const v = h?.[field];
            if (typeof v === 'string' && v.trim().length >= 2) tokens.push(v.trim());
          }
        }
      }
      expect(tokens.length).toBeGreaterThan(0);

      const out = await anonymizeTips(
        [{ id: 't1', source: 'web', topic: 'roster', text: tokens.join(' / '), submittedAt: Date.now() }],
        realTeams,
      );
      const leaked = [...new Set(tokens)].filter((tok) =>
        new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(out[0].text),
      );
      expect(leaked).toEqual([]);
    });
  }
});

describe('franchise-name redaction — source guards', () => {
  it('loadTeams carries aliases and history into the teams map', () => {
    // The redactor can only scrub what loadTeams hands it. Dropping either
    // field here re-opens the leak with every behavioral test still green,
    // because those build their own maps.
    const fn = SCANNER_SRC.match(/async function loadTeams\(\)[\s\S]+?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/aliases:\s*Array\.isArray\(t\.aliases\)/);
    expect(fn![0]).toMatch(/history:\s*Array\.isArray\(t\.history\)/);
  });

  it('token harvest walks history entries and aliases', () => {
    const fn = SCANNER_SRC.match(/function collectFranchiseNameTokens[\s\S]+?\n\}\n/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/team\?\.history/);
    expect(fn![0]).toMatch(/team\?\.aliases/);
  });
});
