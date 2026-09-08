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
  resolveTeamTokens,
  tokenizedTeam,
  MASKED_TEAM,
  TEAM_TOKEN,
  TEAM_SHORT_TOKEN,
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

/**
 * Step 2: the model is never handed a franchise name at all.
 *
 * Masking the memory block (above) closed the leak PATH for the 2026-09-07
 * incident. Tokens close the CAPABILITY: `exposure.team` reaches the LLM as
 * `{{TEAM}}` / `{{TEAM_SHORT}}`, and the real franchise is substituted in code
 * afterwards. Naming the wrong team stops being forbidden and becomes
 * unwritable — the model cannot substitute a name it was never given.
 *
 * This is only sound because exactly ONE team is nameable per post (HARD RULE
 * 26, "You may NOT name a second team"), so one token needs no franchise id
 * and there is exactly one substitution target.
 */
describe('team tokens — the wrong franchise becomes unwritable', () => {
  const RUMOR_SRC = read('scripts/schefter-rumor-scan.mjs');

  it('the payload hands over a token, never the real name', () => {
    expect(tokenizedTeam()).toEqual({ name: TEAM_TOKEN, nameShort: TEAM_SHORT_TOKEN });
    // The spread of the real team is gone from the LLM-facing payload.
    expect(RUMOR_SRC).toMatch(/team: tokenizedTeam\(\),/);
    expect(RUMOR_SRC).not.toMatch(/team: \{ \.\.\.tip\.exposure\.team \}/);
  });

  it('substitutes both registers, so the voice keeps its short form', () => {
    // Real cadence: "Pain's been shopping", not "Bring the Pain's been shopping".
    const team = { name: 'Bring the Pain', nameShort: 'Pain' };
    const { text, unresolved } = resolveTeamTokens(
      `${TEAM_SHORT_TOKEN}'s been shopping a tight end. The ${TEAM_TOKEN} aren't done.`,
      team,
    );
    expect(text).toBe("Pain's been shopping a tight end. The Bring the Pain aren't done.");
    expect(unresolved).toBe(false);
  });

  it('falls back to the long name when nameShort is absent', () => {
    // pickDisplayTeam only guarantees `name`; nameShort is optional in config.
    const { text } = resolveTeamTokens(`The ${TEAM_SHORT_TOKEN} called.`, { name: 'Fire Ready Aim' });
    expect(text).toBe('The Fire Ready Aim called.');
  });

  it('flags an invented placeholder as unresolved rather than shipping it', () => {
    const { unresolved } = resolveTeamTokens(
      `The {{TEAM_NICKNAME}} are shopping.`,
      { name: 'Bring the Pain', nameShort: 'Pain' },
    );
    expect(unresolved).toBe(true);
  });

  it('flags a token with no team to fill it', () => {
    const { text, unresolved } = resolveTeamTokens(`The ${TEAM_TOKEN} are shopping.`, null);
    expect(unresolved).toBe(true);
    expect(text).toContain(TEAM_TOKEN);
  });

  it('the scanner falls back to the template on an unresolved token', () => {
    // A literal {{TEAM}} in the group chat would be worse than the
    // misattribution this replaces, so an unresolved token is treated as a
    // failed generation — not a body to patch.
    expect(RUMOR_SRC).toMatch(/if \(resolvedBody\.unresolved && aiBody\) \{/);
    expect(RUMOR_SRC).toMatch(/falling back to template/);
    // ...and a survivor past the template is scrubbed to prose, never shipped.
    expect(RUMOR_SRC).toMatch(/body\.replace\(\/\\\{\\\{\[\^\}\]\*\\\}\\\}\/g, MASKED_TEAM\)/);
  });

  it('resolves from the ORIGINAL tip, not the anonymized copy', () => {
    // The anonymized copy is the one carrying tokens; reading the team off it
    // would substitute "{{TEAM}}" for "{{TEAM}}" and resolve nothing.
    expect(RUMOR_SRC).toMatch(/beat\.batch\?\.find\(\(t\) => t\?\.exposure\?\.team\)/);
  });

  it('teaches the token in the rules AND the exposure examples', () => {
    // Examples teach by demonstration — an exposure example still showing a
    // franchise name would model the exact behavior the rule forbids.
    expect(RUMOR_SRC).toMatch(/is a PLACEHOLDER, not a name/);
    // Examples G-J are the exposure ladder; J is the last of them.
    const examples = RUMOR_SRC.match(/Example G —[\s\S]*?Example J —[\s\S]*?\n\n/)?.[0] ?? '';
    expect(examples, 'exposure ladder examples not found — regex is stale').toBeTruthy();
    expect(examples).not.toMatch(/Gaslamp Griffins/);
    expect(examples).not.toMatch(/Harbor City Kraken/);
    // Source, so the tokens appear as the interpolation, not the literal.
    expect(examples).toContain('${TEAM_SHORT_TOKEN}');
  });

  it('documents formerName as the remaining real-name surface', () => {
    // HARD RULE 30's callback is deliberately NOT tokenized. The joke needs
    // both names, and its `formerName` is built for `scope.franchise` at two
    // of its three call sites — which is not necessarily `exposure.team`, so
    // reusing {{TEAM}} there would invent a NEW misattribution rather than
    // close one. Left as a named gap, not an oversight.
    expect(RUMOR_SRC).toMatch(/safe\.formerName = formerNameFor\(/);
    const rules = read('docs/claude/rules/schefter.md');
    expect(rules).toMatch(/formerName/);
  });

  it('end to end: a model that copies a name from memory cannot succeed', () => {
    // The failure being closed. Memory says "[a team]" (masked), the payload
    // says "{{TEAM}}", and the substitution only ever writes the offer's own
    // franchise — so the Fire Ready Aim / Cyrus Allen pairing is unreachable.
    const real = { name: 'Bring the Pain', nameShort: 'Pain' };
    const memory = maskFranchiseNames('Fire Ready Aim has a wideout on the table.', incidentTeams());
    expect(memory).not.toContain('Fire Ready Aim');

    const generated = `Per multiple sources: the ${TEAM_SHORT_TOKEN} have Cyrus Allen on the table.`;
    const { text, unresolved } = resolveTeamTokens(generated, real);
    expect(unresolved).toBe(false);
    expect(text).toBe('Per multiple sources: the Pain have Cyrus Allen on the table.');
    expect(text).not.toContain('Fire Ready Aim');
  });
});
