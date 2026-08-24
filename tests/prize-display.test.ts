/**
 * Guard tests for prize DISPLAY surfaces.
 *
 * The bug these exist to stop has already shipped twice. `StandingsTable.astro`
 * hardcoded `TIER_PRIZES`, and both playoff pages hardcoded their own tables
 * (`placementPayouts`, `aflPayouts`) — so the dollars an owner read on a page
 * and the dollars the commissioner wrote to MFL were independent constants
 * free to disagree. Every amount now derives from the registry payout table;
 * the scan at the bottom is what keeps a new copy from creeping back in.
 *
 * See docs/claude/rules/accounting.md.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { bracketKindFromName, isTitleBracket } from '../src/utils/afl-bracket-kind.mjs';
import { join } from 'node:path';
import {
  formatPrizeAmount,
  getAwardPrize,
  getDerivedPrizeTotal,
  getPlacementPrize,
  getPrizeByKey,
  getPrizePool,
  getPrizeTableRows,
  getPrizes,
  getSeedPrize,
  getTierPrize,
  getWeeklyHighPrize,
} from '../src/utils/prize-display';

describe('formatPrizeAmount', () => {
  it('renders whole dollars without cents', () => {
    expect(formatPrizeAmount(300)).toBe('$300');
    expect(formatPrizeAmount(45)).toBe('$45');
  });

  it('keeps cents for a split amount', () => {
    // Weekly-high ties SPLIT (both constitutions). Rounding $1.50 to $2 or $1
    // misstates what an owner is owed.
    expect(formatPrizeAmount(1.5)).toBe('$1.50');
  });
});

describe('lookups resolve against the registry', () => {
  it("finds TheLeague's placement prizes", () => {
    expect(getPlacementPrize('theleague', 1)?.amount).toBe(300);
    expect(getPlacementPrize('theleague', 6)?.amount).toBe(25);
    expect(getPlacementPrize('theleague', 1)?.label).toBe('League Champion');
  });

  it('returns null for a place the league does not pay', () => {
    expect(getPlacementPrize('theleague', 7)).toBeNull();
  });

  it("finds the AFL's award prizes", () => {
    expect(getAwardPrize('afl-fantasy', 'afl-championship')?.amount).toBe(300);
    expect(getAwardPrize('afl-fantasy', 'al-champion')?.amount).toBe(150);
    expect(getAwardPrize('afl-fantasy', 'nl-champion')?.amount).toBe(150);
    expect(getAwardPrize('afl-fantasy', 'nit')?.amount).toBe(50);
  });

  it("finds the AFL's tier prizes", () => {
    expect(getTierPrize('afl-fantasy', 'Premier League', 1)?.amount).toBe(225);
    expect(getTierPrize('afl-fantasy', 'Premier League', 4)?.amount).toBe(50);
    expect(getTierPrize('afl-fantasy', 'D-League', 1)?.amount).toBe(50);
    // Ranks below the paid ones win nothing — the tier table renders an empty
    // cell there, not `undefined`.
    expect(getTierPrize('afl-fantasy', 'Premier League', 5)).toBeNull();
    expect(getTierPrize('afl-fantasy', 'D-League', 2)).toBeNull();
  });

  it('returns null for a league with no payout table', () => {
    // best-ball-1 is draft-only: no prize table, and no accounting feature.
    expect(getPrizes('best-ball-1')).toEqual([]);
    expect(getPrizePool('best-ball-1')).toBeNull();
    expect(getPlacementPrize('best-ball-1', 1)).toBeNull();
    expect(getDerivedPrizeTotal('best-ball-1')).toBeNull();
  });
});

describe('the AFL pays FOUR division titles, not six', () => {
  // Six divisions, but each conference sends only four teams: its two best
  // division winners (seeds 1-2) plus two wild cards (seeds 3-4). A third
  // division winner who misses the playoffs is NOT paid. Confirmed with the
  // commissioner, Aug 2026 — do not "fix" this back to six division awards.
  it('pays seeds 1-2 a division title', () => {
    expect(getSeedPrize('afl-fantasy', 1)?.key).toBe('division-title');
    expect(getSeedPrize('afl-fantasy', 2)?.key).toBe('division-title');
    expect(getSeedPrize('afl-fantasy', 1)?.amount).toBe(150);
  });

  it('pays seeds 3-4 a wild card', () => {
    expect(getSeedPrize('afl-fantasy', 3)?.key).toBe('wild-card');
    expect(getSeedPrize('afl-fantasy', 4)?.key).toBe('wild-card');
    expect(getSeedPrize('afl-fantasy', 3)?.amount).toBe(100);
  });

  it('pays a fifth seed nothing', () => {
    // In the 2003-2012 six-division layout a conference could seed a third
    // division winner here. Paying it would be the $2,525-against-$2,220 bug.
    expect(getSeedPrize('afl-fantasy', 5)).toBeNull();
    expect(getSeedPrize('afl-fantasy', 0)).toBeNull();
  });
});

describe('weekly high score', () => {
  it("reads TheLeague's per-week amount and expected week count", () => {
    const weekly = getWeeklyHighPrize('theleague');
    expect(weekly?.amount).toBe(3);
    expect(weekly?.weeks).toBe(14);
  });

  it('is absent from the AFL, which does not pay it', () => {
    expect(getWeeklyHighPrize('afl-fantasy')).toBeNull();
  });
});

describe('prize table rendering', () => {
  it("reconciles TheLeague's table to its stated pool exactly", () => {
    // 300+150+100+50+45+25 = 670, plus 3 x 14 weeks = 42 -> 712.
    expect(getDerivedPrizeTotal('theleague')).toBe(712);
    expect(getPrizePool('theleague')).toBe(712);
  });

  it('declines to total the AFL rather than guessing a conference count', () => {
    // A playoff-seed prize pays its seeds in EVERY conference, and the payout
    // table does not carry how many conferences a league runs. A total that
    // silently counted each seed prize once would read $1,325 against a stated
    // $2,220 pool and look like money had gone missing.
    expect(getDerivedPrizeTotal('afl-fantasy')).toBeNull();
    expect(getPrizePool('afl-fantasy')).toBe(2220);
  });

  it('describes how each prize is awarded', () => {
    const rows = getPrizeTableRows('afl-fantasy');
    const division = rows.find((r) => r.key === 'division-title');
    expect(division?.note).toBe('Each conference, seeds 1-2');
    expect(division?.winners).toBeNull();

    const champion = rows.find((r) => r.key === 'afl-championship');
    expect(champion?.note).toBe('');
    expect(champion?.winners).toBe(1);
  });

  it('spells out the weekly-high arithmetic', () => {
    const weekly = getPrizeTableRows('theleague').find((r) => r.key === 'weekly-high');
    expect(weekly?.note).toBe('$3 × 14 weeks');
    expect(weekly?.winners).toBe(14);
  });

  it('renders every registry row, in constitution order', () => {
    const rows = getPrizeTableRows('theleague');
    expect(rows.map((r) => r.key)).toEqual(getPrizes('theleague').map((p) => p.key));
    expect(rows[0].label).toBe('League Champion');
    expect(rows[0].amount).toBe('$300');
  });

  it('exposes prizes by their stable registry key', () => {
    expect(getPrizeByKey('afl-fantasy', 'premier-league')?.amount).toBe(225);
    expect(getPrizeByKey('afl-fantasy', 'nope')).toBeNull();
  });
});

/**
 * The regression scan: no prize amount may be typed into a display surface.
 *
 * Every amount in either league's payout table, written as a dollar literal,
 * is forbidden in the files that render prizes. Those files must ask the
 * registry instead. This is the check that would have caught `placementPayouts`
 * and `aflPayouts` when they were written.
 */
describe('no hardcoded prize amounts in display surfaces', () => {
  const PRIZE_SURFACES = [
    'src/components/theleague/standings/StandingsTable.astro',
    'src/components/shared/PayoutsTable.astro',
    'src/pages/theleague/playoffs.astro',
    'src/pages/afl-fantasy/playoffs.astro',
    'src/pages/theleague/standings.astro',
    'src/pages/afl-fantasy/standings.astro',
    'src/utils/prize-display.ts',
    // The rules pages are deliberately NOT scanned: they carry unrelated
    // league money that collides with prize amounts by coincidence — a $45
    // million salary cap, a $25 trade deposit, a $425,000 minimum bid. Their
    // payouts sections are pinned by the dedicated tests below instead.
  ];

  // Amounts small enough to collide with unrelated numbers (week counts, ranks,
  // pixel sizes) are matched only with a `$` in front, which is how a prize
  // reads in markup.
  const amounts = Array.from(
    new Set(
      [...getPrizes('theleague'), ...getPrizes('afl-fantasy')].map((p) => p.amount)
    )
  ).sort((a, b) => b - a);

  it('has amounts to check', () => {
    expect(amounts.length).toBeGreaterThan(3);
  });

  for (const file of PRIZE_SURFACES) {
    it(`${file} names no prize amount`, () => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      // Comments explain the history and cite amounts ("$2,525 against a
      // $2,220 pool"); prose is not a constant the app can render.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*(\/\/|\*).*$/gm, '');
      const offenders = amounts.filter((amount) =>
        new RegExp(`\\$${amount}(?![\\d.])`).test(code)
      );
      expect(offenders).toEqual([]);
    });
  }

  it('leaves the registry as the only place the amounts live', () => {
    const registry = readFileSync(
      join(process.cwd(), 'src/config/leagues-data.mjs'),
      'utf8'
    );
    for (const amount of amounts) {
      expect(registry).toContain(`amount: ${amount}`);
    }
  });
});

/**
 * The rules pages must not re-list prizes as markup either — that is where
 * TheLeague's `<ul>` and the AFL's constitution HTML kept their own copies.
 */
describe('rules pages render the derived payouts table', () => {
  it("TheLeague's rules page delegates its payouts section", () => {
    const source = readFileSync(
      join(process.cwd(), 'src/pages/theleague/rules.astro'),
      'utf8'
    );
    expect(source).toContain('<PayoutsTable');
    // The old hand-typed list is gone.
    expect(source).not.toContain('Total Net Prize Money');
    expect(source).not.toMatch(/<li>League Champion \$300<\/li>/);
  });

  it("the AFL's rules page splices the derived table over the constitution's list", () => {
    const source = readFileSync(
      join(process.cwd(), 'src/pages/afl-fantasy/rules.astro'),
      'utf8'
    );
    expect(source).toContain('<PayoutsTable');
    expect(source).toContain('Prize Distribution');
  });

  it("the AFL rules page's footnote removal still matches the constitution", () => {
    // The component renders a DERIVED version of this footnote. If the pattern
    // stops matching, the stale hand-typed one renders alongside it.
    const page = readFileSync(
      join(process.cwd(), 'src/pages/afl-fantasy/rules.astro'),
      'utf8'
    );
    const html = readFileSync(
      join(process.cwd(), 'src/pages/afl-fantasy/docs/rules.html'),
      'utf8'
    );
    const declared = page.match(/const FOOTNOTE_PATTERN = (\/.*\/);/);
    expect(declared).not.toBeNull();
    const pattern = new RegExp(declared![1].slice(1, -1));
    expect(pattern.test(html)).toBe(true);
  });

  it("the AFL constitution still carries the markers the splice looks for", () => {
    // The league office replaces this file wholesale. If a new version drops
    // the heading, the splice silently stops and the stale list renders again
    // — so this test is the tripwire that says the page needs re-pointing.
    const html = readFileSync(
      join(process.cwd(), 'src/pages/afl-fantasy/docs/rules.html'),
      'utf8'
    );
    const start = html.indexOf('<h3>Prize Distribution</h3>');
    expect(start).toBeGreaterThan(-1);
    expect(html.indexOf('</ul>', start)).toBeGreaterThan(start);
  });
});

/**
 * Bracket prize badges — the gate that keeps money off a bracket that does not
 * pay it.
 *
 * `bracketKind()` returns `championship` as a FALLTHROUGH ("AFL-side, not
 * NIT/Cup/AL/NL"), so it covers the AFL 3rd and 5th Place Games as well as the
 * title bracket. Badging on kind alone hangs the $300 League Championship on
 * both placement games. That misreading already shipped once in the
 * franchise-history round labeller, and again here while these badges were
 * being built — `isTitleBracket` is the question actually being asked.
 */
describe('bracket prize badges only ride on title brackets', () => {
  it('treats a tournament final as a title bracket', () => {
    expect(isTitleBracket('AFL Championship')).toBe(true);
    expect(isTitleBracket('AL Championship')).toBe(true);
    expect(isTitleBracket('NIT Championship')).toBe(true);
    // A reconstructed feed rebuilds only the primary bracket, and it arrives
    // unnamed — that counts as the title bracket.
    expect(isTitleBracket(undefined)).toBe(true);
  });

  it('rejects the placement games that share the championship KIND', () => {
    expect(isTitleBracket('AFL 3rd Place Game')).toBe(false);
    expect(isTitleBracket('AFL 5th Place Game')).toBe(false);
    expect(isTitleBracket('NIT 3rd Place Game')).toBe(false);
    expect(isTitleBracket('NIT 5th Place Game')).toBe(false);
  });

  it('agrees with bracketKind on which tournament a bracket belongs to', () => {
    // Both halves are needed: the kind picks WHICH award, isTitleBracket
    // decides WHETHER any award applies.
    expect(bracketKindFromName('AFL 3rd Place Game', '1')).toBe('championship');
    expect(bracketKindFromName('NIT 3rd Place Game', '6')).toBe('nit');
  });

  it("the AFL playoffs page gates its badge on isTitleBracket", () => {
    const source = readFileSync(
      join(process.cwd(), 'src/pages/afl-fantasy/playoffs.astro'),
      'utf8'
    );
    expect(source).toContain('isTitleBracket');
    // The gate must run before the award lookup, not after.
    const gate = source.indexOf('if (!isTitleBracket(');
    const lookup = source.indexOf('BRACKET_AWARD_BY_KIND[bracketKind(');
    expect(gate).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(gate);
  });

  it("TheLeague's brackets and Prizes tab read ONE placement map", () => {
    const source = readFileSync(
      join(process.cwd(), 'src/pages/theleague/playoffs.astro'),
      'utf8'
    );
    // Both the badge helper and the payout lines derive from PLACEMENT_BRACKETS,
    // so a bracket header cannot show money the tab does not pay.
    expect(source).toContain('const PLACEMENT_BRACKETS');
    expect(source).toContain('PLACEMENT_BRACKETS.flatMap');
    expect(source).toContain('PLACEMENT_BRACKETS.find');
  });
});

/**
 * Tokens the prize surfaces style against must exist in BOTH theme files, or
 * the hardcoded fallback renders in both themes — light looks perfect and dark
 * ships an unreadable badge. Same rule as tests/design-token-guard.test.ts,
 * narrowed to the tokens this feature introduced.
 */
describe('prize tokens are defined in both themes', () => {
  const light = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
  const dark = readFileSync(join(process.cwd(), 'src/styles/tokens-dark.css'), 'utf8');

  // Every token the prize surfaces reference.
  const REQUIRED = [
    '--prize-badge-bg',
    '--prize-badge-text',
    '--prize-seed-text',
    '--prize-seed-bg',
    '--prize-seed-border',
    '--prize-empty-text',
    '--prize-pool-text',
  ];

  // The gold badge is deliberately theme-invariant: a saturated gold with
  // black text reads correctly on a dark card too.
  const LIGHT_ONLY = ['--prize-badge-bg', '--prize-badge-text'];

  for (const token of REQUIRED) {
    it(`${token} has a light value`, () => {
      expect(light).toContain(`${token}:`);
    });
  }

  for (const token of REQUIRED.filter((t) => !LIGHT_ONLY.includes(t))) {
    it(`${token} has a dark override`, () => {
      expect(dark).toContain(`${token}:`);
    });
  }
});
