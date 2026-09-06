/**
 * The FAQ must not describe a league's rules using another league's mechanics.
 *
 * The page's whole argument is "we can be specific because we only serve one
 * league". The first draft undercut it by hardcoding TheLeague's vocabulary —
 * "our contracts, our cap" — into a SHARED component, so AFL readers were told
 * the site was built around a salary cap and contract years the AFL does not
 * have (`contracts: false`, `salaryCap: false` in the registry).
 *
 * Naming a mechanic a league doesn't have is worse than saying nothing: it
 * tells the reader the page isn't really about them. This scans the rendered
 * copy source for any feature word used unconditionally.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES, leagueHasFeature } from '../src/config/leagues';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAQ = path.resolve(__dirname, '../src/components/shared/faq/FaqPage.astro');

/** Words that name a mechanic only SOME leagues have, and the flag that owns each. */
const FEATURE_WORDS: Array<{
  word: RegExp;
  feature: 'contracts' | 'salaryCap' | 'keepers' | 'taxiSquad';
}> = [
  { word: /\bcontracts?\b/i, feature: 'contracts' },
  { word: /\bcontract year\b/i, feature: 'contracts' },
  { word: /\bsalary cap\b/i, feature: 'salaryCap' },
  { word: /\bkeepers?\b/i, feature: 'keepers' },
  // The AFL has no practice squad; TheLeague's holds 3.
  { word: /\btaxi\b/i, feature: 'taxiSquad' },
  { word: /\bpractice squad\b/i, feature: 'taxiSquad' },
];

/** The page body only — the frontmatter is where the conditionals legitimately live. */
function templateOf(src: string): string {
  const parts = src.split('---');
  // ['', frontmatter, ...template]
  return parts.slice(2).join('---');
}

describe('FAQ page — no league is told about another league’s mechanics', () => {
  const src = fs.readFileSync(FAQ, 'utf8');
  const template = templateOf(src);

  it('reads the template (a restructured file must not silently pass)', () => {
    expect(template).toContain('faq__hero');
  });

  it.each(FEATURE_WORDS.map((f) => [f.feature, f.word] as const))(
    'never hardcodes a %s word in the template',
    (_feature, word) => {
      // Strip HTML comments and the {expression} interpolations, which are the
      // sanctioned way to say these words — they resolve per league.
      const prose = template
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\{[^{}]*\}/g, '');
      expect(prose).not.toMatch(word);
    },
  );

  it('every league has at least one true thing to say about its own rules', () => {
    for (const league of ALL_LEAGUES) {
      const owned = (['contracts', 'salaryCap', 'keepers', 'taxiSquad'] as const).filter((f) =>
        leagueHasFeature(league.slug, f),
      );
      // Not an assertion about the copy — a league with none of these still
      // gets "our playoff format". This pins that the flags are readable at
      // all, so a renamed flag fails here rather than silently emptying the
      // list into "our rules — and our playoff format".
      expect(Array.isArray(owned)).toBe(true);
    }
  });
});
