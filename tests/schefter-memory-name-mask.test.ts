/**
 * Franchise names must not reach the LLM through the MEMORY block.
 *
 * The incident, 2026-09-07: a trade-offer post read "Fire Ready Aim has Cyrus
 * Allen on the table". Cyrus Allen (17518) is and has been a Bring the Pain
 * (0008) player since the May 9 auction — no trade, every roster snapshot
 * agrees. Fire Ready Aim is 0007.
 *
 * The `exposure` payload could not have produced that pairing. `buildExposure`
 * lists players only off `ownPlayers(chosenFid)`, and `escalatedPlayer` is
 * re-picked from `sidesByFid[namedFid]` once a team is named, so a player from
 * the other side cannot be constructed into the payload — that was the
 * 2026-09-07 attribution fix, and it works. The name came from somewhere the
 * payload does not control: the RECENT POSTS block, where the three previous
 * trade posts had all named Fire Ready Aim.
 *
 * Two structural facts make this a leak rather than a curiosity:
 *   1. Both scanners read ONE post-history.json. The transaction scanner names
 *      teams legitimately (a completed trade is public), and the rumor scanner
 *      reads those bodies back as memory.
 *   2. Nothing downstream checks which franchise a generated post names.
 *      `sanitizeAiPost` only looks for meta-commentary patterns.
 *
 * So the block is masked at the source. It exists to stop repeated openers,
 * closers and bits; it never needed the names.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  collectFranchiseNameTokens,
  maskFranchiseNames,
  memoryNameMasker,
  MASKED_TEAM,
} from '../scripts/lib/schefter-name-mask.mjs';
import { buildRecentPostsPromptBlock } from '../scripts/lib/schefter-lore.mjs';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

/** The two franchises from the incident, in the config's real shape. */
function incidentTeams() {
  return new Map<string, any>([
    ['0007', { name: 'Fire Ready Aim', nameShort: 'Fire', abbrev: 'FRA' }],
    ['0008', { name: 'Bring the Pain', nameShort: 'Pain', abbrev: 'BTP' }],
  ]);
}

describe('memory-block masking — the 2026-09-07 leak', () => {
  it('masks the franchise name that bled into the Cyrus Allen post', () => {
    const body =
      'Per multiple sources with direct knowledge: Fire Ready Aim has a wideout '
      + 'on the table in a two-for-one swap.';
    const masked = maskFranchiseNames(body, incidentTeams());
    expect(masked).not.toMatch(/Fire Ready Aim/);
    expect(masked).toContain(MASKED_TEAM);
  });

  it('masks every form a franchise answers to, not just the long name', () => {
    const teams = new Map<string, any>([
      ['0008', {
        name: 'Bring the Pain',
        nameMedium: 'Bring The Pain',
        nameShort: 'Pain',
        abbrev: 'BTP',
        aliases: ['The Pain Train'],
        // A retired name carries its own aliases — "Heavy Chevy" retired with
        // ["Heavy", "Chevy"], and a nickname for a retired name identifies the
        // franchise exactly as well as the retired name itself.
        history: [{ name: 'Heavy Chevy', nameShort: 'Chevy', aliases: ['Heavy'] }],
      }],
    ]);
    for (const form of ['Bring the Pain', 'Pain', 'BTP', 'The Pain Train', 'Heavy Chevy', 'Chevy', 'Heavy']) {
      expect(maskFranchiseNames(`Hearing ${form} is shopping a tight end.`, teams))
        .not.toContain(form);
    }
  });

  it('prefers the LONGEST form so a name is never left half-masked', () => {
    const teams = new Map<string, any>([
      ['0011', { name: 'Nashville Geeks', nameShort: 'Geeks' }],
    ]);
    const masked = maskFranchiseNames('The Nashville Geeks called twice.', teams);
    expect(masked).toBe(`The ${MASKED_TEAM} called twice.`);
    // Not "The [a team] Geeks" — the short form must not win the alternation.
    expect(masked).not.toContain('Geeks');
  });

  it('survives the possessive, which is how these posts actually read', () => {
    // Real body, 2026-09-08: "Pain's been shopping a tight end since yesterday".
    const masked = maskFranchiseNames("Pain's been shopping a tight end.", incidentTeams());
    expect(masked).toBe(`${MASKED_TEAM}'s been shopping a tight end.`);
  });

  it('is word-boundary anchored — short names that are ordinary words do not overfire', () => {
    // The config genuinely contains nameShorts that are also common words:
    // `balls`, `feelers`, `herd`, `chat`, `swift` are each somebody's short
    // name. The memory block is prose, so an unanchored match would shred it.
    const teams = new Map<string, any>([['0008', { name: 'Bring the Pain', nameShort: 'Pain' }]]);
    const masked = maskFranchiseNames('A painful week, and painstaking work.', teams);
    expect(masked).toBe('A painful week, and painstaking work.');
  });

  it('degrades to the input when there is nothing to mask', () => {
    expect(maskFranchiseNames('text', new Map())).toBe('text');
    expect(maskFranchiseNames('text', null as never)).toBe('text');
    expect(maskFranchiseNames('', incidentTeams())).toBe('');
  });
});

describe('buildRecentPostsPromptBlock — bodies are masked or absent, never raw', () => {
  const posts = [
    { subject: 'trade', body: 'Fire Ready Aim has a wideout on the table.', openerUsed: 'Pour yourself a cup', closerUsed: "We'll see" },
  ];

  it('masks franchise names out of recalled bodies', () => {
    const block = buildRecentPostsPromptBlock(posts, {
      maskNames: memoryNameMasker(incidentTeams()),
    });
    expect(block).toContain('RECENT POSTS');
    expect(block).not.toMatch(/Fire Ready Aim/);
    expect(block).toContain(MASKED_TEAM);
  });

  it('DROPS bodies entirely when no masker is supplied, and warns', () => {
    // Fail safe, not fail open. The block's job — "do not reuse these openers,
    // closers, or bits" — still gets done by the lists below; the bodies are
    // the nice-to-have. A silently thinner prompt is worth catching, so it
    // warns rather than degrading quietly.
    const warn = vi.fn();
    const block = buildRecentPostsPromptBlock(posts, { warn });
    expect(block).not.toMatch(/Fire Ready Aim/);
    expect(block).not.toContain('RECENT POSTS');
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toMatch(/maskNames/);
  });

  it('still carries the opener and closer bans with no masker', () => {
    const block = buildRecentPostsPromptBlock(posts, { warn: vi.fn() });
    expect(block).toContain('Pour yourself a cup');
    expect(block).toContain("We'll see");
  });

  it('returns empty for empty history regardless of masker', () => {
    expect(buildRecentPostsPromptBlock([], { maskNames: (t: string) => t })).toBe('');
    expect(buildRecentPostsPromptBlock(null as never, { warn: vi.fn() })).toBe('');
  });
});

describe('both scanners mask — one history file feeds both', () => {
  // loadPostHistory reads lorePaths(navSlug).postHistory, and both scanners
  // pass the same slug. So a body written by the transaction lane is memory
  // for the rumor lane, and masking only one side leaves the leak open.
  const RUMOR_SRC = read('scripts/schefter-rumor-scan.mjs');
  const SCAN_SRC = read('scripts/schefter-scan.mjs');

  it('the rumor scanner passes a masker', () => {
    expect(RUMOR_SRC).toMatch(/buildRecentPostsPromptBlock\(history\.posts,\s*\{[\s\S]*?maskNames: memoryNameMasker\(teams\)/);
  });

  it('the transaction scanner passes a masker', () => {
    expect(SCAN_SRC).toMatch(/maskNames: memoryNameMasker\(/);
  });

  it('no caller builds the block without options', () => {
    for (const src of [RUMOR_SRC, SCAN_SRC]) {
      expect(src).not.toMatch(/buildRecentPostsPromptBlock\(\s*history\.posts\s*\)/);
    }
  });

  it('the transaction scanner loads the fields the masker needs', () => {
    // Its own templates only print name/abbrev, so nameMedium/nameShort/
    // aliases/history look droppable — and dropping them is invisible until a
    // name the harvest missed reaches the shared prompt.
    const loader = SCAN_SRC.match(/async function loadTeams\([\s\S]+?\n\}/)?.[0] ?? '';
    expect(loader).toMatch(/nameMedium/);
    expect(loader).toMatch(/nameShort/);
    expect(loader).toMatch(/aliases/);
    expect(loader).toMatch(/history/);
  });

  it('the harvest has ONE home — neither scanner keeps a private copy', () => {
    for (const src of [RUMOR_SRC, SCAN_SRC]) {
      expect(src).not.toMatch(/^function\s+collectFranchiseNameTokens\(/m);
    }
    expect(collectFranchiseNameTokens(incidentTeams())).toContain('Fire Ready Aim');
  });
});
