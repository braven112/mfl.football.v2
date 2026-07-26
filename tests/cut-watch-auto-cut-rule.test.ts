/**
 * Cut Watch auto-cut rule — regression suite for the July 2026 factual bug
 * where a shipped article claimed deadline auto-cuts are value-based:
 *
 *   "When you don't pick, the system picks the weakest combined-value
 *    players first, and this roster is loaded with dead weight nobody in
 *    this league would touch in a draft."
 *
 * The real rule (src/utils/august-cut-selection-core.mjs, the code the
 * deadline job actually runs): owner-marked players first, then newest
 * waiver/FA/auction pickup first; trades never count as acquisitions
 * (traded-for players are long-held, reached last); exactly the overage is
 * cut. Value plays no role.
 *
 * Root cause was category confusion, not a wrong fact: the article
 * INTENTIONALLY surfaces value-ranked cut candidates as editorial advice,
 * and the model collapsed that advisory ranking into the mechanical rule.
 * So this suite tests BOTH directions:
 *   Layer 1 — never describe auto-cuts as value-based (detector below);
 *   Layer 2 — the advisory value ranking must still exist, clearly labeled
 *             (a "fix" that stops recommending entirely breaks the feature).
 *
 * DO NOT replace the detector with a cut-verb regex: the shipped bad string
 * contains no cut/drop/release verb. Detection is per-sentence co-occurrence
 * of ACTION + VALUE + MECHANISM lexicons, with a narrow negation escape.
 * The live generation eval is tests/eval/cut-watch.eval.ts (API-gated).
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain .mjs module without type declarations
import { findValueBasedAutoCutClaims, findValueBasedAutoCutClaimsInPost, stripHtml } from '../scripts/lib/cut-watch-graders.mjs';
// @ts-expect-error — plain .mjs module without type declarations
import { buildFactSheet, getUserPrompt } from '../scripts/article-types/cut-watch.mjs';
// @ts-expect-error — plain .mjs module without type declarations
import { selectAutoCuts, parseAcquisitionEvents } from '../src/utils/august-cut-selection-core.mjs';
import { fixtureData, fixtureAdp } from './fixtures/cut-watch-fixture';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The exact string that shipped in sf_2026_cut_watch_0726 — canonical positive. */
const SHIPPED_BAD_STRING =
  "When you don't pick, the system picks the weakest combined-value players first, " +
  'and this roster is loaded with dead weight nobody in this league would touch in a draft.';

describe('value-based auto-cut detector (Layer 1)', () => {
  it('fires on the exact string that shipped (canonical positive)', () => {
    const violations = findValueBasedAutoCutClaims(SHIPPED_BAD_STRING);
    expect(violations).toHaveLength(1);
    // All three lexicons matched something in the sentence.
    expect(violations[0].action).toBeTruthy();
    expect(violations[0].value).toBeTruthy();
    expect(violations[0].mechanism).toBeTruthy();
  });

  it('fires on euphemistic phrasings with no cut verb (CUT-14)', () => {
    const euphemisms = [
      'When you snooze, the system just goes after the lowest-rated roster spots on its own.',
      "If you don't file, it automatically takes the dead weight first.",
      'The machine starts with the worst players by default.',
      'No plan means the algorithm grabs your least valuable guys.',
      'Auto-cuts come for the weakest links, and this roster has plenty.',
    ];
    for (const s of euphemisms) {
      expect(findValueBasedAutoCutClaims(s), s).toHaveLength(1);
    }
  });

  it('does not fire on advisory value framing without a mechanism (Layer 2 preserved)', () => {
    const advisory = [
      'Likely cut candidates, weakest combined value first: Lindqvist, Mbeki, Ferraro.',
      'My advice: cut the dead weight — Lindqvist is unranked in league-wide ADP.',
      'The easy cuts are the worst-value contracts nobody would draft.',
      'This owner should shed his lowest-valued spots before the deadline hits.',
    ];
    for (const s of advisory) {
      expect(findValueBasedAutoCutClaims(s), s).toHaveLength(0);
    }
  });

  it('does not fire on correct mechanical statements that negate the value link', () => {
    const correct = [
      'The system takes your newest pickups first — your July waiver adds — regardless of value.',
      "If you don't file a plan, the system cuts your newest pickups first, not your weakest players.",
      'Value plays no role when the system picks — it goes newest pickup first.',
      'The system is blind to value: it works from the newest acquisition down.',
    ];
    for (const s of correct) {
      expect(findValueBasedAutoCutClaims(s), s).toHaveLength(0);
    }
  });

  it('does not fire on benign deadline copy from real articles', () => {
    const benign = [
      'These owners are sharp — they know that controlling your own cuts beats letting the system decide.',
      'Every hour that passes without a plan increases the odds that auto-cuts claim a player you wanted to keep.',
      'Nail down your moves now, or let the league machine do it for you.',
    ];
    for (const s of benign) {
      expect(findValueBasedAutoCutClaims(s), s).toHaveLength(0);
    }
  });

  it('scans across HTML paragraphs of a post', () => {
    const post = {
      headline: 'Cut Day Chaos',
      excerpt: 'Six teams scrambling.',
      content: [`<p>${SHIPPED_BAD_STRING}</p>`, '<p>Everything else is fine.</p>'],
    };
    expect(findValueBasedAutoCutClaimsInPost(post)).toHaveLength(1);
  });
});

describe('shipped feed stays clean (regression gate)', () => {
  it('no cut-watch article in schefter-feed.json describes auto-cuts as value-based', () => {
    const feed = JSON.parse(
      readFileSync(path.join(repoRoot, 'src/data/theleague/schefter-feed.json'), 'utf8')
    );
    const posts: any[] = Array.isArray(feed) ? feed : feed.posts ?? [];
    const cutWatch = posts.filter((p) => `${p.id}`.includes('cut_watch'));
    expect(cutWatch.length).toBeGreaterThan(0);
    for (const post of cutWatch) {
      const violations = findValueBasedAutoCutClaimsInPost(post);
      expect(
        violations,
        `${post.id} claims auto-cuts are value-based: ${JSON.stringify(violations, null, 2)}\n` +
          'The deadline auto-cut is newest-pickup-first (trades long-held), NEVER value-based — ' +
          'see src/utils/august-cut-selection-core.mjs. Fix the article copy or the generation prompt.'
      ).toHaveLength(0);
    }
  });
});

// ── Fact-sheet fixture: value and recency deliberately inverted ──────────────
//
// Shared with the live eval — see tests/fixtures/cut-watch-fixture.ts for
// the full design rationale (adapted from the midwestside_28/trade_masking
// eval-design fixtures to the REAL rule; the advisory list and the
// mechanical list share zero names by construction, and the trades sit at
// the end of the roster array because trades are long-held, not absolutely
// exempt — roster order decides within the long-held pool).

async function buildFixtureFactSheet(cutdownPlans: Map<string, number> | null = new Map([['9901', 0]])) {
  const { factSheet } = await buildFactSheet(fixtureData(), 0, 2026, repoRoot, {
    league: 'theleague',
    adp: fixtureAdp(),
    cutdownPlans,
  });
  return factSheet as string;
}

describe('fact sheet — mechanical rule is stated and computed (Layer 1 source)', () => {
  it('states the real rule in a dedicated block', async () => {
    const sheet = await buildFixtureFactSheet();
    expect(sheet).toContain('HOW THE DEADLINE AUTO-CUT ACTUALLY WORKS');
    expect(sheet).toContain('NEWEST PICKUP FIRST');
    expect(sheet).toContain('Player value plays NO role');
    expect(sheet).toContain('Trades never count as pickups');
    expect(sheet).toContain('Exactly the overage is cut');
  });

  it('computes the system auto-cut order with the real selection code: pickups newest-first, trades long-held', async () => {
    const sheet = await buildFixtureFactSheet();
    const lines = sheet.split('\n');
    const start = lines.findIndex((l: string) => l.includes('What the SYSTEM will cut if nothing is marked'));
    expect(start).toBeGreaterThan(-1);
    const preview = lines.slice(start + 1, start + 7);

    // Newest pickup first: Okoye (Jul 22) → Brennan (Jul 15) → Whitlock
    // (Jul 11) → Aduba (Jul 8), then long-held filler in roster order.
    expect(preview[0]).toContain('Daniel Okoye');
    expect(preview[0]).toContain('waiver add Jul 22');
    expect(preview[1]).toContain('Tom Brennan');
    expect(preview[1]).toContain('FA add Jul 15');
    expect(preview[2]).toContain('James Whitlock');
    expect(preview[3]).toContain('Chike Aduba');
    // Slots 5–6 come from the long-held pool (roster order) and must say so.
    expect(preview[4]).toContain('Kai Restrepo');
    expect(preview[4]).toContain('long-held');
    expect(preview[5]).toContain('Gus Halvorsen');
    expect(preview[5]).toContain('long-held');

    // The trade acquisitions never appear in the mechanical list — Traore is
    // the single discriminating datapoint: value logic cuts him (worst
    // value), recency-without-trade-scoping cuts him (newest acquisition),
    // the real rule reaches him last.
    const previewText = preview.join('\n');
    expect(previewText).not.toContain('Traore');
    expect(previewText).not.toContain('Salas');

    // Exactly the overage (6), never more.
    expect(lines[start + 7] ?? '').not.toMatch(/^\s+7\./);
  });

  it('keeps the advisory list, labeled as editorial, with Traore on top (Layer 2 preserved)', async () => {
    const sheet = await buildFixtureFactSheet();
    expect(sheet).toContain('EDITORIAL ranking, not the auto-cut order');
    const lines = sheet.split('\n');
    const advisoryStart = lines.findIndex((l: string) => l.includes('Likely cut candidates'));
    const advisory = lines.slice(advisoryStart + 1, advisoryStart + 9).join('\n');
    // Unranked (Traore + dead-weight filler) tops the advisory list even
    // though the system will never auto-cut him — the two framings coexist.
    expect(advisory).toContain('Ludovic Traore');
    expect(advisory).toContain('UNRANKED');
  });

  it('another franchise\'s pickup of a traded-in player does not count as an acquisition', async () => {
    const sheet = await buildFixtureFactSheet();
    // Salas was FA-added by 9902 on Jul 2 then traded to 9901 — for 9901 he
    // is long-held, so he must not appear in the mechanical preview at all
    // (covered above) and never with a pickup date.
    expect(sheet).not.toMatch(/Salas[^\n]*FA add/);
  });

  it('omits the mechanical preview for owners whose filed plan covers the overage', async () => {
    const sheet = await buildFixtureFactSheet(new Map([['9901', 6]]));
    expect(sheet).toContain('FILED');
    expect(sheet).not.toContain('What the SYSTEM will cut');
  });

  it('flags NONE ON FILE with the newest-pickup-first mechanic', async () => {
    const sheet = await buildFixtureFactSheet();
    expect(sheet).toContain('NONE ON FILE');
    expect(sheet).toContain('auto-chosen newest-pickup-first at the deadline');
  });

  it('the fact sheet itself contains no value-based auto-cut claim', async () => {
    const sheet = await buildFixtureFactSheet();
    expect(findValueBasedAutoCutClaims(stripHtml(sheet))).toHaveLength(0);
  });

  it('degrades to all-long-held (never crashes) when the transactions feed is missing', async () => {
    const data = fixtureData();
    delete (data as any).transactions;
    const { factSheet } = await buildFactSheet(data, 0, 2026, repoRoot, {
      league: 'theleague',
      adp: fixtureAdp(),
      cutdownPlans: null,
    });
    expect(factSheet).toContain('What the SYSTEM will cut');
    expect(factSheet).toContain('long-held');
  });
});

describe('user prompt — instruction contract (Layer 1 + Layer 2)', () => {
  const prompt = getUserPrompt('FACT SHEET PLACEHOLDER');

  it('forbids value-based mechanic claims outright', () => {
    expect(prompt).toContain('NEVER based on value');
    expect(prompt).toMatch(/never say or imply the system targets the weakest/i);
  });

  it('states the real mechanic for the model to repeat', () => {
    expect(prompt).toMatch(/NEWEST waiver\/FA\/auction pickups, newest first/);
    expect(prompt).toMatch(/acquired by trade\s+are treated as long-held/);
  });

  it('demands the two framings stay separate (no welded clause)', () => {
    expect(prompt).toContain('Keep the two lists separate');
    expect(prompt).toMatch(/Never fuse them into one sentence/);
  });

  it('still demands value-ranked recommendations (overcorrection guard)', () => {
    expect(prompt).toContain('COMBINED VALUE');
    expect(prompt).toMatch(/Name specific players who could be cut/);
  });
});

describe('fact-sheet preview matches the deadline job byte-for-byte (shared implementation)', () => {
  it('selectAutoCuts on the fixture returns the exact preview set', () => {
    const data = fixtureData();
    const events = data.transactions.transactions.transaction;
    // Same parse path the fact sheet uses lives in the core module — assert
    // the ground truth directly against selectAutoCuts so a drift in either
    // caller shows up here.
    const roster = data.rosters.rosters.franchise[0];
    const result = selectAutoCuts({
      activeRoster: roster.player,
      markedPlayerIds: [],
      acquisitions: parseAcquisitionEvents(events),
      franchiseId: '9901',
    });
    expect(result.cuts.map((c: any) => c.playerId).slice(0, 4)).toEqual([
      '9002', '9004', '9005', '9006',
    ]);
    expect(result.cuts).toHaveLength(6);
    const cutIds = result.cuts.map((c: any) => c.playerId);
    expect(cutIds).not.toContain('9001'); // Traore — trade, long-held
    expect(cutIds).not.toContain('9003'); // Salas — trade, long-held
  });
});
