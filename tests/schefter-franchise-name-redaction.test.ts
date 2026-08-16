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
import { anonymizeTips, AMBIGUOUS_NAME_TOKENS } from '../scripts/schefter-rumor-scan.mjs';

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
  history?: Array<{ name?: string; nameShort?: string; abbrev?: string; aliases?: string[] }>;
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
    // A retired name carries its OWN aliases in the real configs — "Heavy
    // Chevy" retired with aliases ["Heavy", "Chevy"] in theleague.config.json.
    history: [{ name: 'Sabertooths', abbrev: 'SBR', aliases: ['Sabers'] }],
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

  it('redacts the aliases hanging off a RETIRED name, not just the name', async () => {
    // The harvest read `team.aliases` only, so a nickname for a retired name
    // was invisible to it. Real instance: 0004's "Heavy Chevy" retired with
    // aliases ["Heavy", "Chevy"], and "Chevy" alone points at exactly one
    // franchise as surely as the full retired name does.
    const safe = await anonymizeFuzzed('the Sabers front office is up to something');
    expect(safe.text).not.toMatch(/Sabers/i);
    expect(safe.text).toContain('[a team]');
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

      // Each token is placed MID-SENTENCE in its own config casing — the
      // position and form a deliberate franchise mention actually takes.
      //
      // This used to join every token with " / " and scan the result once.
      // That construction cannot express position, and position is now load-
      // bearing: `readsAsOrdinaryProse` deliberately lets an ambiguous token
      // through when it is lowercase or sentence-initial, because there it is
      // a word rather than a name ("Deal is dead."). A bare join would report
      // those deliberate pass-throughs as leaks while ALSO never testing the
      // one position that matters. One tip per token is the honest guard.
      const leaked: string[] = [];
      for (const tok of new Set(tokens)) {
        const out = await anonymizeTips(
          [{
            id: 't1',
            source: 'web',
            topic: 'roster',
            text: `Hearing ${tok} is shopping a tight end.`,
            submittedAt: Date.now(),
          }],
          realTeams,
        );
        // Detect leaks with a plain substring check, NOT the boundary regex the
        // redactor uses. Sharing that construct made this test blind to exactly
        // the bug it exists to catch: `\b` cannot match after a token ending in
        // punctuation, so "The Blunt Bros." and "Be Rough!" both survived
        // redaction AND went unreported here. A guard must not assume the same
        // thing as the code it guards.
        if (out[0].text.toLowerCase().includes(tok.toLowerCase())) leaked.push(tok);
      }
      // The one permitted survivor class: a config form stored already in
      // lowercase is indistinguishable from prose by construction, so an
      // ambiguous one can never redact on its own. TheLeague's `dream` alias
      // is the only instance, and franchise 0016 keeps "The Dream" / "Running
      // Down The Dream" / "Silver Bullets" / "RDTD", which is what a real
      // mention ("hearing the dream is shopping") actually matches.
      const permitted = leaked.filter(
        (tok) => tok === tok.toLowerCase() && AMBIGUOUS_NAME_TOKENS.has(tok),
      );
      expect(leaked.filter((tok) => !permitted.includes(tok))).toEqual([]);
    });
  }
});

describe('franchise-name redaction — names ending in punctuation', () => {
  // `\b` is a boundary between a word and a non-word char, so it cannot exist
  // after a token that ENDS in punctuation — `\bBe Rough!\b` matches nothing.
  // Eight real AFL names died this way, several of them punitive rebrands.
  const punctTeams = new Map<string, TeamEntry>([
    ['0001', { name: 'The Blunt Bros.', nameShort: 'Blunt Bros.', division: 'NL' }],
    ['0002', { name: 'Lucky Buck$', division: 'NL' }],
    ['0003', { name: 'Be Rough!', division: 'NL' }],
    ['0004', { name: 'Be Gentle. It\'s my first time.', division: 'NL' }],
    ['0005', { name: 'Plain Name', division: 'NL' }],
  ]);

  it.each([
    ['The Blunt Bros.', 'The Blunt Bros. are shopping a TE'],
    ['Lucky Buck$', 'Hearing Lucky Buck$ is in the market'],
    ['Be Rough!', 'Be Rough! has been quiet'],
    ['Be Gentle. It\'s my first time.', 'Word is Be Gentle. It\'s my first time. wants out'],
  ])('redacts %s', async (name, text) => {
    const out = await anonymizeTips(
      [{ id: 't1', source: 'web', topic: 'roster', text, submittedAt: Date.now() }],
      punctTeams,
    );
    expect(out[0].text.toLowerCase()).not.toContain(name.toLowerCase());
    expect(out[0].text).toContain('[a team]');
  });

  it('still refuses to match a name glued to a longer word', async () => {
    const out = await anonymizeTips(
      [{ id: 't1', source: 'web', topic: 'roster', text: 'The PlainNamed guy called', submittedAt: Date.now() }],
      punctTeams,
    );
    expect(out[0].text).toBe('The PlainNamed guy called');
  });

  it('redacts a punctuation-ending name even when a word is glued to it', async () => {
    // The second-order version of the same bug. Wrapping every token in a
    // blanket `(?!\w)` fixes "Bros. are" but not "Bros.are" — the `.` is
    // followed by `a`, the lookahead fails, and the whole name survives.
    // A token that already ends in punctuation carries its own delimiter and
    // must not get a right guard at all.
    const out = await anonymizeTips(
      [{ id: 't1', source: 'web', topic: 'roster', text: 'I hear The Blunt Bros.are done and Lucky Buck$are next', submittedAt: Date.now() }],
      punctTeams,
    );
    expect(out[0].text).toBe('I hear [a team]are done and [a team]are next');
  });
});

describe('franchise-name redaction — trade-bait owner comments', () => {
  const baitTeams = new Map<string, TeamEntry>([
    ['0001', { name: 'Pacific Pigskins', nameShort: 'Pigskins', division: 'NW' }],
    ['0002', { name: 'Nashville Geeks', nameShort: 'Geeks', division: 'NW' }],
  ]);

  const bait = async (ownerWillGiveUp: string, ownerWillTake: string) => {
    const out = await anonymizeTips(
      [{
        id: 'b', source: 'trade_bait', topic: 'trade', franchiseHint: '0001',
        author: 'Pigskins', attributable: true, submittedAt: Date.now(),
        meta: { adds: [], byPos: {}, totalAdds: 0, ownerWillGiveUp, ownerWillTake },
      }],
      baitTeams,
    );
    return out[0];
  };

  it('fuzzes a counterparty named in the owner\'s own MFL comment', async () => {
    // Naming the LISTING team is the point of this scope — they published it.
    // The team they name in the comment did not, and gets no say.
    const safe = await bait('Call Nashville Geeks only', 'Anything from the Geeks');
    expect(safe.meta.ownerWillGiveUp).toBe('Call [a team] only');
    expect(safe.meta.ownerWillTake).toBe('Anything from the [a team]');
  });

  it('leaves the listing team\'s own name intact', async () => {
    const safe = await bait('Pigskins are selling', 'Anything');
    expect(safe.meta.ownerWillGiveUp).toBe('Pigskins are selling');
  });
});

describe('franchise-name redaction — every field the LLM sees, not just text', () => {
  it('scrubs threadFollowup.parentHeadlineSnippet on an anonymous tip', async () => {
    // The snippet is lifted from a PUBLISHED post, which may legitimately have
    // named a franchise, then pinned onto a tip that may be fully anonymous.
    // It reaches the prompt through the same JSON.stringify as `text`.
    const feed = [{ id: 'p1', body: 'The Nashville Geeks are shopping a tight end. Developing.' }];
    const out = await anonymizeTips(
      [{ id: 'c', source: 'web', topic: 'roster', text: 'nothing identifying', repliesToPostId: 'p1', submittedAt: Date.now() }],
      teams,
      feed,
    );
    expect(out[0].scope.kind).toBe('league-wide');
    expect(out[0].threadFollowup.parentHeadlineSnippet).not.toMatch(/Nashville Geeks/i);
    expect(out[0].threadFollowup.parentHeadlineSnippet).toContain('[a team]');
  });

  it('keeps the scoped franchise in the snippet when naming is allowed', async () => {
    const feed = [{ id: 'p1', body: 'The Pacific Pigskins are shopping a tight end.' }];
    const now = Date.now();
    const out = await anonymizeTips(
      [
        { id: 't1', source: 'web', topic: 'roster', text: 'more on this', franchiseHint: '0001', repliesToPostId: 'p1', submittedAt: now },
        { id: 't2', source: 'web', topic: 'roster', text: 'same', franchiseHint: '0001', submittedAt: now },
      ],
      teams,
      feed,
    );
    expect(out[0].scope.kind).toBe('franchise-multi-source');
    expect(out[0].threadFollowup.parentHeadlineSnippet).toContain('Pigskins');
  });
});

describe('franchise-name redaction — single pass, no self-corruption', () => {
  // Sequential per-token replaces re-scan their own output: once "Smokane" is
  // normalized to "Smokane FC", a later "Smokane" pass matches inside what was
  // just written. One alternation pass visits each position exactly once.
  const longNameTeams = new Map<string, TeamEntry>([
    ['0001', { name: 'Smokane FC', aliases: ['Smokane'], division: 'NW' }],
    ['0002', { name: 'The Show', aliases: ['Show'], division: 'NW' }],
  ]);

  const twice = async (text: string, hint: string) => {
    const now = Date.now();
    const out = await anonymizeTips(
      [
        { id: 't1', source: 'web', topic: 'roster', text, franchiseHint: hint, submittedAt: now },
        { id: 't2', source: 'web', topic: 'roster', text: 'same', franchiseHint: hint, submittedAt: now },
      ],
      longNameTeams,
    );
    return out[0];
  };

  it('does not double a canonical name that contains one of its own aliases', async () => {
    expect((await twice('Smokane FC are shopping a TE', '0001')).text)
      .toBe('Smokane FC are shopping a TE');
    expect((await twice('The Show is in the market', '0002')).text)
      .toBe('The Show is in the market');
  });

  it('still normalizes a bare alias up to the canonical name', async () => {
    expect((await twice('Smokane are shopping a TE', '0001')).text)
      .toBe('Smokane FC are shopping a TE');
  });
});

describe('franchise-name redaction — a kept franchise cannot claim a live rival\'s name', () => {
  // The mirror image of the pickFormerName ownership bug, and worse than a
  // leak: "Midwestside Connection" is 0010's FORMER name and 0011's CURRENT
  // one, so normalizing every token in 0010's history onto the kept name
  // rewrote a genuine mention of 0011 as "Jocks" — misattributing a real
  // team rather than fuzzing it.
  const collidingTeams = new Map<string, TeamEntry>([
    ['0010', {
      name: 'Computer Jocks',
      nameShort: 'Jocks',
      division: 'NW',
      history: [{ name: 'Midwestside Connection', yearStart: 2011, yearEnd: 2015 }],
    }],
    ['0011', { name: 'Midwestside Connection', nameShort: 'Midwestside', division: 'NW' }],
  ]);

  const scopedTo = async (text: string, hint: string) => {
    const now = Date.now();
    const out = await anonymizeTips(
      [
        { id: 't1', source: 'web', topic: 'roster', text, franchiseHint: hint, submittedAt: now },
        { id: 't2', source: 'web', topic: 'roster', text: 'same', franchiseHint: hint, submittedAt: now },
      ],
      collidingTeams,
    );
    return out[0];
  };

  it('fuzzes the live rival instead of renaming it to the kept franchise', async () => {
    const safe = await scopedTo('Hearing Jocks and Midwestside Connection are talking', '0010');
    expect(safe.scope.franchise).toBe('Jocks');
    expect(safe.text).toBe('Hearing Jocks and [a team] are talking');
    expect(safe.text).not.toMatch(/Jocks and Jocks/);
  });

  it('still lets the franchise that actually owns the name be named', async () => {
    const safe = await scopedTo('Hearing Midwestside Connection are shopping', '0011');
    expect(safe.scope.franchise).toBe('Midwestside');
    expect(safe.text).toBe('Hearing Midwestside are shopping');
  });
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
    // Retargeted when the harvest started reading aliases off each history
    // entry too (`form?.aliases` covers both the team and its history rows,
    // where the old `team?.aliases` covered only the team). The behavioral
    // proof is the "Sabers" case above; this guard exists so a refactor that
    // stops walking history at all can't pass on the behavioral tests alone.
    const fn = SCANNER_SRC.match(/function collectFranchiseNameTokens[\s\S]+?\n\}\n/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/team\?\.history/);
    expect(fn![0]).toMatch(/form\?\.aliases/);
  });

  it('redaction is applied to the RESULT, not inside the scope classifier', () => {
    // The structural guarantee. resolveTipScope returns from a dozen branches;
    // redacting inside it means each new branch must remember to, which is how
    // league-wide and commish shipped raw text for months. If someone moves
    // the scrub back inside the classifier, this fails.
    expect(SCANNER_SRC).toMatch(/function redactSafePayload\(safe, teams\)/);
    expect(SCANNER_SRC).toMatch(/redactSafePayload\(await resolveTipScope\(tip\), teams\)/);
    // ...and no scope branch re-implements it inline.
    const classifier = SCANNER_SRC.match(/const resolveTipScope = async \(tip\) => \{[\s\S]+?\n  \};/);
    expect(classifier).not.toBeNull();
    expect(classifier![0]).not.toMatch(/redactFranchiseNamesInText\(/);
  });

  it('matches on non-word lookarounds, never \\b (which cannot follow punctuation)', () => {
    const fn = SCANNER_SRC.match(/function buildFranchiseNameMatcher[\s\S]+?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/\(\?<!\\\\w\)/);
    expect(fn![0]).toMatch(/\(\?!\\\\w\)/);
    expect(fn![0]).not.toMatch(/\\\\b/);
  });
});

/**
 * Over-redaction — the fuzz must not eat the tip's own content.
 *
 * The harvest takes every name form at a floor of two characters and matches
 * it case-insensitively, so ordinary football prose was being shredded by
 * franchise abbreviations and retired nicknames that are also plain English
 * words. Verified live against the real configs before the fix:
 *
 *   "Deal is dead."           → "Deal is [a team]."          (DEAD,    0004 abbrev)
 *   "a heavy favorite"        → "a [a team] favorite"        (Heavy,   0004 retired nameShort)
 *   "a chevy in a ferrari league" → "a [a team] in a ..."    (Chevy,   0004 retired alias)
 *   "Owner put out feelers"   → "put out [a team]"           (Feelers, AFL 0017 alias)
 *   "headed to the Saints"    → "the [a team]"               (Saints,  AFL 0020 — an NFL club)
 *   "Swift is being shopped"  → "[a team] is being shopped"  (Swift,   AFL 0016 — an NFL player)
 *
 * CLAUDE.md's "over-matching is the safe direction" assumed a stray hit merely
 * fuzzes a word. It does something worse: "[a team]" ASSERTS a franchise
 * reference where none existed, and HARD RULES 2/3 then tell the LLM to make
 * the tip's content survive the fuzz — so it invents a team's involvement out
 * of "put out feelers". A leak names the wrong team; this fabricates one on a
 * tip nobody scoped to a franchise.
 *
 * The relaxation is deliberately narrow. An ambiguous token is not dropped; it
 * stops matching only where it cannot be a proper noun — lowercase, or
 * capitalized solely because a sentence began there.
 */
describe('franchise-name redaction — ordinary prose survives the fuzz', () => {
  const realTeams = (configPath: string) => {
    const raw = JSON.parse(readFileSync(path.join(process.cwd(), configPath), 'utf8'));
    const map = new Map<string, TeamEntry>();
    for (const t of raw.teams ?? []) {
      map.set(t.franchiseId, {
        name: t.name,
        nameMedium: t.nameMedium,
        nameShort: t.nameShort,
        abbrev: t.abbrev,
        division: t.division,
        aliases: Array.isArray(t.aliases) ? t.aliases : [],
        history: Array.isArray(t.history) ? t.history : [],
      });
    }
    return map;
  };
  const LEAGUE = realTeams('src/data/theleague.config.json');
  const AFL = realTeams('data/afl-fantasy/afl.config.json');

  const scrub = async (text: string, teams: Map<string, TeamEntry>) => {
    const out = await anonymizeTips(
      [{ id: 't1', source: 'web', topic: 'roster', text, submittedAt: Date.now() }],
      teams,
    );
    return out[0].text;
  };

  // The three reported cases, verbatim.
  it.each([
    ['Deal is dead. Somebody may still move.'],
    ['He is a heavy favorite to be cut.'],
    ['That contract is a chevy in a ferrari league.'],
  ])('leaves %s untouched (TheLeague)', async (text) => {
    expect(await scrub(text, LEAGUE)).toBe(text);
  });

  it.each([
    ['There is a gap at running back.'],
    ['That pick is a rock solid value.'],
    ['The art of the deal is lost on him.'],
    ['Fire sale incoming and the pain is real.'],
    ['Dream scenario for that roster.'],
  ])('leaves %s untouched (TheLeague)', async (text) => {
    expect(await scrub(text, LEAGUE)).toBe(text);
  });

  it.each([
    ['There is smoke around this one.'],
    ['Owner put out feelers about a trade.'],
    ['The chat has been quiet all week.'],
    ['That roster is a mint condition contender.'],
    ['He wants to show he belongs.'],
    ['A married man with three kids does not do that.'],
    ['Balls to the wall approach on this rebuild.'],
    ['Swift is being shopped after the trade deadline.'],
  ])('leaves %s untouched (AFL)', async (text) => {
    expect(await scrub(text, AFL)).toBe(text);
  });

  // The other half of the contract: relaxing these tokens must not cost a
  // real mention. Capitalized mid-sentence is what a deliberate franchise
  // reference looks like, and it still redacts.
  it.each([
    ['Talks with Heavy fell apart.'],
    ['The DEAD front office is quiet.'],
    ['Sources say Chevy wants out.'],
  ])('still redacts a mid-sentence capital in %s', async (text) => {
    expect(await scrub(text, LEAGUE)).toContain('[a team]');
  });

  it.each([
    ['Hearing Feelers is shopping a tight end.'],
    ['Sources say Balls is rebuilding.'],
    ['Word is Chat wants a quarterback.'],
  ])('still redacts a mid-sentence capital in %s (AFL)', async (text) => {
    expect(await scrub(text, AFL)).toContain('[a team]');
  });

  it('still redacts the distinctive multi-word form in any casing', async () => {
    // "Heavy" relaxes; "Heavy Chevy" — the form that actually identifies the
    // franchise — must not, even lowercased and sentence-initial.
    for (const text of [
      'heavy chevy are shopping a TE',
      'Heavy Chevy are shopping a TE',
      'dead cap walking is over the cap',
    ]) {
      expect(await scrub(text, LEAGUE)).toContain('[a team]');
    }
  });

  it('catches a bare ambiguous alias through the franchise\'s longer form', async () => {
    // 0016's `dream` alias is stored lowercase, so it can never redact alone.
    // What a real mention looks like is "the dream", which "The Dream" covers.
    expect(await scrub('Hearing the dream is shopping a TE', LEAGUE))
      .toBe('Hearing [a team] is shopping a TE');
  });

  it('does not rewrite an ordinary word into the KEPT franchise\'s name', async () => {
    // Ordering guard. `readsAsOrdinaryProse` has to run BEFORE the keep-
    // franchise normalize branch: "dead" is one of 0004's own forms, so on a
    // tip scoped to Dead Cap Walking the normalize branch would turn
    // "the deal is dead" into "the deal is Dead Cap Walking" — the same
    // fabrication as "[a team]", with a specific team's name on it.
    const now = Date.now();
    const out = await anonymizeTips(
      [
        { id: 't1', source: 'web', topic: 'roster', text: 'The deal is dead but he is a heavy favorite', franchiseHint: '0004', submittedAt: now },
        { id: 't2', source: 'web', topic: 'roster', text: 'Heard the same', franchiseHint: '0004', submittedAt: now },
      ],
      LEAGUE,
    );
    expect(out[0].scope.kind).toBe('franchise-multi-source');
    expect(out[0].text).toBe('The deal is dead but he is a heavy favorite');
  });
});

describe('franchise-name redaction — ambiguous-token list invariants', () => {
  const CONFIGS = [
    ['theleague', 'src/data/theleague.config.json'],
    ['afl-fantasy', 'data/afl-fantasy/afl.config.json'],
  ] as const;

  /** Every name form the redactor harvests, grouped by franchise. */
  const formsByFranchise = () => {
    const out = new Map<string, string[]>();
    for (const [league, configPath] of CONFIGS) {
      const raw = JSON.parse(readFileSync(path.join(process.cwd(), configPath), 'utf8'));
      for (const t of raw.teams ?? []) {
        const forms: string[] = [];
        const add = (v: unknown) => {
          if (typeof v === 'string' && v.trim().length >= 2) forms.push(v.trim());
        };
        for (const form of [t, ...(t.history ?? [])]) {
          for (const f of ['name', 'nameMedium', 'nameShort', 'abbrev']) add(form?.[f]);
        }
        for (const a of t.aliases ?? []) add(a);
        out.set(`${league}:${t.franchiseId}`, forms);
      }
    }
    return out;
  };

  it('every entry is a real config name form', () => {
    // Anti-rot in the removal direction: a franchise rename that retires one
    // of these names leaves a dead entry quietly relaxing nothing, and the
    // next reader cannot tell which entries are still load-bearing.
    const live = new Set(
      [...formsByFranchise().values()].flat().map((f) => f.toLowerCase()),
    );
    const stale = [...AMBIGUOUS_NAME_TOKENS].filter((tok) => !live.has(tok));
    expect(stale).toEqual([]);
  });

  it('never leaves a franchise with only ambiguous name forms', () => {
    // The safety invariant. Relaxing a token is only acceptable because the
    // franchise keeps a distinctive form that still catches a real mention —
    // "Balls" relaxes because "Balls Deep" does not. A future rename to a
    // wholly ordinary word would strip a team of all protection, and this is
    // what refuses it.
    const unprotected: string[] = [];
    for (const [key, forms] of formsByFranchise()) {
      if (forms.length === 0) continue;
      const distinctive = forms.filter((f) => !AMBIGUOUS_NAME_TOKENS.has(f.toLowerCase()));
      if (distinctive.length === 0) unprotected.push(key);
    }
    expect(unprotected).toEqual([]);
  });

  it('is all lowercase, since lookup is keyed on the lowercased match', () => {
    expect([...AMBIGUOUS_NAME_TOKENS].filter((t) => t !== t.toLowerCase())).toEqual([]);
  });
});
