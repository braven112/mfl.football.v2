/**
 * A package league's rulebook for Ask Roger and its Rules page, from two
 * sources (the owner's rule, Oct 2026):
 *
 *   1. The commissioner's written rulebook — `data/<slug>/constitution.md`,
 *      pasted in as given. Authoritative where it speaks.
 *   2. The league's settings as configured on MFL —
 *      `data/<slug>/derived/rules-from-mfl.md`, written by
 *      scripts/compute-mfl-settings-digest.mjs on every sync. MFL enforces
 *      these, so they are the fallback wherever the rulebook is silent, and the
 *      whole answer for a league that has no written rulebook yet.
 *
 * TheLeague and the AFL keep their own endpoints and prompts
 * (src/pages/api/rules-qa.ts, afl-rules-qa.ts): a change to those prompts
 * needs `pnpm eval:roger` first (docs/claude/rules/roger.md).
 *
 * Both sources are globbed eagerly as small text files, never the raw feeds —
 * a glob over data/*\/mfl-feeds would drag every season into the server bundle.
 */
import type { RulesQA } from '../types/rules-qa';
import { rogerPrompt } from './roger-prompts';

const CONSTITUTIONS = import.meta.glob<string>('../../data/*/constitution.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const MFL_SETTINGS = import.meta.glob<string>('../../data/*/derived/rules-from-mfl.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const SEEDS = import.meta.glob<RulesQA[]>('../../data/*/rules-qa-seeds.json', {
  import: 'default',
  eager: true,
});

const forLeague = <T>(map: Record<string, T>, dataPath: string, file: string): T | undefined =>
  map[`../../${dataPath}/${file}`];

/** Strip the generator's leading HTML comment; it is for editors, not readers. */
const clean = (s: string | undefined) => (s ?? '').replace(/^<!--[\s\S]*?-->\s*/, '').trim();

export interface LeagueRulebook {
  /** The commissioner's written rulebook, or '' when the league has none yet. */
  constitution: string;
  /** The league's settings as configured on MFL, or '' before the first sync. */
  mflSettings: string;
  /** Pre-answered Ask Roger cards, or []. */
  seeds: RulesQA[];
}

export function loadLeagueRulebook(league: { dataPath: string }): LeagueRulebook {
  return {
    constitution: clean(forLeague(CONSTITUTIONS, league.dataPath, 'constitution.md')),
    mflSettings: clean(forLeague(MFL_SETTINGS, league.dataPath, 'derived/rules-from-mfl.md')),
    seeds: forLeague(SEEDS, league.dataPath, 'rules-qa-seeds.json') ?? [],
  };
}

/** Anchors on the package Rules page, so Roger can link the section he used. */
export const RULES_PAGE_ANCHORS = { rulebook: 'rulebook', mflSettings: 'mfl-settings' } as const;

/**
 * Roger's system prompt for a package league. The source order is the whole
 * point: rulebook first, MFL settings where it is silent, "I don't know" where
 * both are — and a disagreement is reported, never resolved by Roger.
 */
export function buildRulesQaPrompt(
  league: { name: string; slug: string },
  book: Pick<LeagueRulebook, 'constitution' | 'mflSettings'>,
): string {
  const rulesPath = `/${league.slug}/rules`;
  const sources = [
    book.constitution
      ? `SOURCE 1 — THE LEAGUE RULEBOOK (written by the commissioner; authoritative where it speaks):\n\n${book.constitution}`
      : 'SOURCE 1 — THE LEAGUE RULEBOOK: this league has not provided a written rulebook yet.',
    book.mflSettings
      ? `SOURCE 2 — THE LEAGUE'S MFL SETTINGS (as configured on MyFantasyLeague, which enforces them):\n\n${book.mflSettings}`
      : "SOURCE 2 — THE LEAGUE'S MFL SETTINGS: not available yet.",
  ];

  // Roger's instructions live in the private beat-reporter pack
  // (prompts/roger/package-league.md); the sources are built here.
  return rogerPrompt('package-league', {
    LEAGUE_NAME: league.name,
    RULES_PATH: rulesPath,
    RULEBOOK_ANCHOR: RULES_PAGE_ANCHORS.rulebook,
    MFL_SETTINGS_ANCHOR: RULES_PAGE_ANCHORS.mflSettings,
    SOURCES: sources.join('\n\n'),
  });
}
