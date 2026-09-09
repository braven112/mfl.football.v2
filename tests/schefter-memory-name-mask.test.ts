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
  memoryNameMasker,
  resolveTeamTokens,
  tokenizedTeam,
  tokenizedFormerName,
  teamToken,
  teamShortToken,
  formerTeamToken,
  authorizedTokensFor,
  MASKED_TEAM,
} from '../scripts/lib/schefter-name-mask.mjs';
import { buildRecentPostsPromptBlock } from '../scripts/lib/schefter-lore.mjs';
// The REAL redactor — the one the rumor scanner injects. Tests exercise the
// same code path production uses, not a simplified stand-in.
import { redactFranchiseNamesInText } from '../scripts/schefter-rumor-scan.mjs';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const mask = (text: string, teams: Map<string, any>) =>
  memoryNameMasker(teams, redactFranchiseNamesInText)!(text);

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
    const masked = mask(body, incidentTeams());
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
      expect(mask(`Hearing ${form} is shopping a tight end.`, teams))
        .not.toContain(form);
    }
  });

  it('prefers the LONGEST form so a name is never left half-masked', () => {
    const teams = new Map<string, any>([
      ['0011', { name: 'Nashville Geeks', nameShort: 'Geeks' }],
    ]);
    const masked = mask('The Nashville Geeks called twice.', teams);
    expect(masked).toBe(`The ${MASKED_TEAM} called twice.`);
    // Not "The [a team] Geeks" — the short form must not win the alternation.
    expect(masked).not.toContain('Geeks');
  });

  it('survives the possessive, which is how these posts actually read', () => {
    // Real body, 2026-09-08: "Pain's been shopping a tight end since yesterday".
    const masked = mask("Pain's been shopping a tight end.", incidentTeams());
    expect(masked).toBe(`${MASKED_TEAM}'s been shopping a tight end.`);
  });

  it('is word-boundary anchored — short names that are ordinary words do not overfire', () => {
    // The config genuinely contains nameShorts that are also common words:
    // `balls`, `feelers`, `herd`, `chat`, `swift` are each somebody's short
    // name. The memory block is prose, so an unanchored match would shred it.
    const teams = new Map<string, any>([['0008', { name: 'Bring the Pain', nameShort: 'Pain' }]]);
    const masked = mask('A painful week, and painstaking work.', teams);
    expect(masked).toBe('A painful week, and painstaking work.');
  });

  it('refuses to mask rather than failing OPEN on an empty team map', () => {
    // schefter-scan's loadTeams returns an empty Map on any config read error.
    // An identity masker there would ship unmasked bodies — the exact opposite
    // of the fail-safe — so no masker is produced and the bodies get dropped.
    expect(memoryNameMasker(new Map(), redactFranchiseNamesInText)).toBeUndefined();
    expect(memoryNameMasker(null as never, redactFranchiseNamesInText)).toBeUndefined();
    expect(memoryNameMasker(incidentTeams(), undefined as never)).toBeUndefined();
  });

  it('passes an empty body through', () => {
    expect(mask('', incidentTeams())).toBe('');
  });
});

describe('buildRecentPostsPromptBlock — bodies are masked or absent, never raw', () => {
  const posts = [
    { subject: 'trade', body: 'Fire Ready Aim has a wideout on the table.', openerUsed: 'Pour yourself a cup', closerUsed: "We'll see" },
  ];

  it('masks franchise names out of recalled bodies', () => {
    const block = buildRecentPostsPromptBlock(posts, {
      maskNames: memoryNameMasker(incidentTeams(), redactFranchiseNamesInText),
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

  it('masks the SUBJECT as well as the body', () => {
    // Subjects are not labels: deriveHistorySubject builds `franchise
    // (Vitside)` and `trade-pending (Team A ↔ Team B)`, and the live
    // post-history already holds the first. Masking only the body left the
    // leak wide open — and in the transaction lane, which drops bodies, the
    // two-franchise subject is the only thing that would have been left.
    const block = buildRecentPostsPromptBlock(
      [{ subject: 'trade-pending (Fire Ready Aim ↔ Bring the Pain)', body: 'A wideout is on the table.' }],
      { maskNames: memoryNameMasker(incidentTeams(), redactFranchiseNamesInText) },
    );
    expect(block).not.toMatch(/Fire Ready Aim/);
    expect(block).not.toMatch(/Bring the Pain/);
    expect(block).toContain(`(trade-pending (${MASKED_TEAM} ↔ ${MASKED_TEAM}))`);
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
    expect(RUMOR_SRC).toMatch(/maskNames: memoryNameMasker\(teams, redactFranchiseNamesInText\)/);
  });

  it('the transaction scanner DROPS bodies rather than masking them bluntly', () => {
    // No redactor of its own, and the only correct one lives in the rumor
    // scanner. A simpler one for this lane was wrong in BOTH directions
    // against the real config — "a fire sale" → "a [a team] sale", while "The
    // Blunt Bros." passed through untouched — so it takes the safe
    // degradation: no masker, no bodies, opener/closer bans intact.
    expect(SCAN_SRC).not.toMatch(/maskNames:/);
  });

  it('no caller builds the block without options', () => {
    for (const src of [RUMOR_SRC, SCAN_SRC]) {
      expect(src).not.toMatch(/buildRecentPostsPromptBlock\(\s*history\.posts\s*\)/);
    }
  });

  it('there is exactly ONE name-matching implementation', () => {
    // The finding behind this: a second, blunter matcher in the mask lib was
    // wrong in both directions against the real config. Name matching has one
    // home now, and callers inject it.
    const MASK_SRC = read('scripts/lib/schefter-name-mask.mjs');
    expect(MASK_SRC).not.toMatch(/new RegExp\(/);
    expect(RUMOR_SRC).toMatch(/export function redactFranchiseNamesInText\(/);
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

  /** Franchise 0003 really did wear three names; the config keys them by year. */
  function historyTeams() {
    return new Map<string, any>([
      ['0003', {
        name: 'Maverick',
        nameShort: 'Mavs',
        history: [
          { name: 'Poker in the Rear', yearStart: 2012, yearEnd: 2013 },
          { name: 'Generals', yearStart: 2014, yearEnd: 2014 },
          { name: 'Maverick', yearStart: 2016, yearEnd: 2024 },
        ],
      }],
      ['0008', { name: 'Bring the Pain', nameShort: 'Pain' }],
    ]);
  }

  it('every token carries its franchise id', () => {
    expect(tokenizedTeam('0008')).toEqual({
      name: '{{TEAM:0008}}',
      nameShort: '{{TEAM_SHORT:0008}}',
    });
    expect(formerTeamToken('0003', 2014)).toBe('{{TEAM_FORMER:0003:2014}}');
  });

  it('the payload hands over a token, never the real name', () => {
    expect(RUMOR_SRC).toMatch(/tokenizedTeam\(tip\.exposure\.fid\)/);
    // Legacy tips queued before this shipped carry no fid. They fall back to
    // the pre-token shape rather than minting {{TEAM:undefined}}, which would
    // spend the offer's already-advanced exposure counter on a nameless
    // template. Self-healing: the queue drains inside a week.
    expect(RUMOR_SRC).toMatch(/tip\.exposure\.fid\s*\n?\s*\?\s*tokenizedTeam/);
  });

  it('resolves each token against ITS OWN franchise, not one assumed team', () => {
    // The property that lets formerName be tokenized at all: two different
    // franchises can appear in one body and each resolves correctly.
    const body = `${teamShortToken('0008')}'s been shopping, and the ${teamToken('0003')} are listening.`;
    const { text, unresolved } = resolveTeamTokens(body, historyTeams());
    expect(text).toBe("Pain's been shopping, and the Maverick are listening.");
    expect(unresolved).toBe(false);
  });

  it('resolves a former name by (franchise, year)', () => {
    const teams = historyTeams();
    expect(resolveTeamTokens(formerTeamToken('0003', 2014), teams).text).toBe('Generals');
    expect(resolveTeamTokens(formerTeamToken('0003', 2012), teams).text).toBe('Poker in the Rear');
    // Same franchise, different year, different name — which is exactly why a
    // bare {{TEAM}} could not have carried this.
    expect(resolveTeamTokens(formerTeamToken('0003', 2013), teams).text).toBe('Poker in the Rear');
  });

  it('renders the full callback the way HARD RULE 30 requires — old name AND new', () => {
    const callback = { current: 'Maverick', former: 'Generals', lastSeason: 2014, punitive: false, phase: 'early' };
    const tokenized = tokenizedFormerName(callback, '0003');
    expect(tokenized.current).toBe('{{TEAM:0003}}');
    expect(tokenized.former).toBe('{{TEAM_FORMER:0003:2014}}');
    // Facts the model reasons about stay real — they are not names it prints.
    expect(tokenized.lastSeason).toBe(2014);
    expect(tokenized.punitive).toBe(false);
    expect(tokenized.phase).toBe('early');

    const body = `${tokenized.current} — the former ${tokenized.former} — are fielding calls.`;
    expect(resolveTeamTokens(body, historyTeams()).text)
      .toBe('Maverick — the former Generals — are fielding calls.');
  });

  it('falls back to the long name when nameShort is absent', () => {
    const teams = new Map<string, any>([['0007', { name: 'Fire Ready Aim' }]]);
    expect(resolveTeamTokens(`The ${teamShortToken('0007')} called.`, teams).text)
      .toBe('The Fire Ready Aim called.');
  });

  it('expands ONLY the exact tokens the payload minted', () => {
    // Two holes, one shape. Gating on the franchise id let a one-digit slip
    // through ({{TEAM_SHORT:0008}} typed as 0018, both live AFL franchises);
    // gating on the id but not the YEAR let an out-of-window retired name
    // through ({{TEAM_FORMER:0004:2019}} → "Drunk Indians", asserted as last
    // season's, which HARD RULE 30 forbids). Both resolved with
    // unresolved:false, so the fallback and the scrub were bypassed.
    // Whole-token matching subsumes both.
    const teams = historyTeams();
    const allowedTokens = new Set([teamShortToken('0003'), formerTeamToken('0003', 2014)]);
    expect(resolveTeamTokens(teamShortToken('0003'), teams, { allowedTokens }))
      .toMatchObject({ text: 'Mavs', unresolved: false });
    expect(resolveTeamTokens(formerTeamToken('0003', 2014), teams, { allowedTokens }))
      .toMatchObject({ text: 'Generals', unresolved: false });

    for (const forged of [
      teamShortToken('0008'),            // wrong franchise
      formerTeamToken('0003', 2012),     // right franchise, UNAUTHORIZED year
      teamToken('0003'),                 // right franchise, register never minted
    ]) {
      const r = resolveTeamTokens(forged, teams, { allowedTokens });
      expect(r.unresolved, forged).toBe(true);
      expect(r.text, forged).toBe(forged);
    }
  });

  it('a TIPSTER cannot authorize their own token', () => {
    // Privilege escalation, verified end to end before the fix: the allow-list
    // was regex-harvested from JSON.stringify(tip), which includes the
    // tipster-controlled `safe.text` (and redactSafePayload skips GroupMe text
    // entirely). A tipster typing {{TEAM:0008}} authorized it; the prompt tells
    // the model to copy tokens through verbatim, so it would, and it resolved
    // to the real franchise with unresolved:false — bypassing the fallback and
    // the scrub, on a league-wide scope that forbids naming anyone.
    const hostile = [{
      id: 't1',
      source: 'web',
      scope: { kind: 'league-wide' },
      text: `Everyone knows ${teamToken('0008')} is tanking`,
    }];
    expect([...authorizedTokensFor(hostile)]).toEqual([]);
  });

  it('authorizes exactly the four minted fields', () => {
    const minted = [{
      exposure: { team: { name: teamToken('0008'), nameShort: teamShortToken('0008') } },
      formerName: { current: teamShortToken('0004'), former: formerTeamToken('0004', 2025) },
      text: `not this one: ${teamToken('0011')}`,
    }];
    const set = authorizedTokensFor(minted);
    expect(set.has(teamToken('0008'))).toBe(true);
    expect(set.has(formerTeamToken('0004', 2025))).toBe(true);
    expect(set.has(teamToken('0011')), 'tip text must never authorize').toBe(false);
  });

  it('allows BOTH registers of an authorized franchise', () => {
    // tokenizedFormerName mints whichever register the caller passed — usually
    // the short one, since pickTeamName prefers nameShort — while HARD RULE
    // 30's examples all model the long form. Without the sibling, a model
    // following the examples wrote an unauthorized token and lost its entire
    // body to the template on EVERY callback post. Same franchise, same
    // authority, just the other spelling.
    const set = authorizedTokensFor([
      { formerName: { current: teamShortToken('0004'), former: formerTeamToken('0004', 2025) } },
    ]);
    expect(set.has(teamToken('0004'))).toBe(true);
    expect(set.has(teamShortToken('0004'))).toBe(true);
    // ...but only for franchises actually minted.
    expect(set.has(teamToken('0008'))).toBe(false);
  });

  it('derives the allow-list from the minted payload, in the scanner', () => {
    expect(RUMOR_SRC).toMatch(/allowedTokens: authorizedTokensFor\(beat\.anonymized\)/);
    // Never scraped off the whole tip — that is what let a tipster authorize.
    expect(RUMOR_SRC).not.toMatch(/JSON\.stringify\(t\)\.matchAll/);
    expect(RUMOR_SRC).toMatch(/resolveTeamTokens\(aiBody \|\| templateBody\(beat\.anonymized\), teams, resolveOpts\)/);
  });

  it('refuses a former-name token that resolves to the CURRENT name', () => {
    // pickFormerName filters re-skin and other-owner rows before offering a
    // former name; this lookup walks raw history[], so two rows covering the
    // rename year could ship "X — the former X". Latent in both live configs
    // today — refused rather than relied upon.
    const teams = historyTeams();
    const allowedTokens = new Set([formerTeamToken('0003', 2020), formerTeamToken('0003', 2014)]);
    // 2020 falls in the Maverick era row, whose name IS the current name.
    expect(resolveTeamTokens(formerTeamToken('0003', 2020), teams, { allowedTokens }).unresolved).toBe(true);
    // A genuine former era still resolves.
    expect(resolveTeamTokens(formerTeamToken('0003', 2014), teams, { allowedTokens }).text).toBe('Generals');
  });

  it('scrubs half-mangled markup, matching the widened detection', () => {
    // Detection counts any stray brace pair; a balanced-only scrub would leave
    // exactly the markup it exists to remove.
    expect(RUMOR_SRC).toMatch(/\{0,2\}/);
    expect(RUMOR_SRC).not.toMatch(/body\.replace\(\/\\\{\\\{\[\^\}\]\*\\\}\\\}\/g, MASKED_TEAM\);/);
  });

  it('flags a token the model mangled at ONE edge', () => {
    // A balanced-pair test (`\\{\\{[^}]*\\}\\}`) called these resolved and let the
    // literal markup ship to the feed and GroupMe — which the beat loop calls
    // worse than the bug being replaced.
    const teams = historyTeams();
    for (const broken of ['the {{TEAM_SHORT:0008} are shopping', 'the {TEAM:0008}} are shopping']) {
      expect(resolveTeamTokens(broken, teams).unresolved, broken).toBe(true);
    }
    // A well-formed token still resolves cleanly.
    expect(resolveTeamTokens(`the ${teamShortToken('0008')} are shopping`, teams).unresolved).toBe(false);
  });

  it('flags an unknown franchise, an uncovered year, and an invented placeholder', () => {
    const teams = historyTeams();
    expect(resolveTeamTokens(teamToken('9999'), teams).unresolved).toBe(true);
    // 2015 sits in the gap between the Generals and Maverick era rows.
    expect(resolveTeamTokens(formerTeamToken('0003', 2015), teams).unresolved).toBe(true);
    expect(resolveTeamTokens('The {{TEAM_NICKNAME}} are shopping.', teams).unresolved).toBe(true);
    expect(resolveTeamTokens('nothing to do here', teams).unresolved).toBe(false);
  });

  it('the scanner falls back to the template on an unresolved token', () => {
    expect(RUMOR_SRC).toMatch(/if \(resolvedBody\.unresolved && aiBody\) \{/);
    expect(RUMOR_SRC).toMatch(/falling back to template/);
    // The scrub matches the widened detection — see the half-mangled test.
    expect(RUMOR_SRC).toMatch(/body\.replace\([\s\S]{0,40}MASKED_TEAM\)/);
  });

  it('resolves against the whole team map, not a single beat team', () => {
    // Every token names its own franchise, so resolution is a lookup — which
    // is what allows a former-name callback for a DIFFERENT franchise than the
    // exposure team to appear in the same body.
    expect(RUMOR_SRC).toMatch(/resolveTeamTokens\(aiBody \|\| templateBody\(beat\.anonymized\), teams, resolveOpts\)/);
  });

  it('teaches the token in the rules AND the exposure examples', () => {
    expect(RUMOR_SRC).toMatch(/is a PLACEHOLDER, not a name/);
    expect(RUMOR_SRC).toMatch(/COPY THE TOKEN THROUGH/);
    const examples = RUMOR_SRC.match(/Example G —[\s\S]*?Example J —[\s\S]*?\n\n/)?.[0] ?? '';
    expect(examples, 'exposure ladder examples not found — regex is stale').toBeTruthy();
    expect(examples).not.toMatch(/Gaslamp Griffins/);
    expect(examples).not.toMatch(/Harbor City Kraken/);
    expect(examples).toContain('{{TEAM_SHORT:');
  });

  it('end to end: a model that copies a name from memory cannot succeed', () => {
    // Memory says "[a team]" (masked), the payload says "{{TEAM:0008}}", and
    // substitution only ever writes the franchise the token names — so the
    // Fire Ready Aim / Cyrus Allen pairing is unreachable.
    const memory = mask('Fire Ready Aim has a wideout on the table.', incidentTeams());
    expect(memory).not.toContain('Fire Ready Aim');

    const generated = `Per multiple sources: the ${teamShortToken('0008')} have Cyrus Allen on the table.`;
    const { text, unresolved } = resolveTeamTokens(generated, historyTeams());
    expect(unresolved).toBe(false);
    expect(text).toBe('Per multiple sources: the Pain have Cyrus Allen on the table.');
    expect(text).not.toContain('Fire Ready Aim');
  });
});
