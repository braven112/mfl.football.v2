/**
 * Team-color-behind-player guard.
 *
 * Any UI that puts an NFL team color behind a player headshot must use the
 * shared, luminance-guarded helpers (`getPlayerAvatarBackground` /
 * `getPlayerAvatarBorder` via the `--player-avatar-bg` pattern, or
 * `buildPlayerCellHTML`). Hand-rolling gradients from `getNflTeamColors`
 * reintroduces the dark-mode bug those helpers exist to prevent: a third of
 * the NFL wears near-black primaries, and a dark-jerseyed headshot on a raw
 * team primary is invisible on a dark page (July 2026, Cam Ward on Titans
 * navy — see docs/claude/insights/features/player-composites.md).
 *
 * This test freezes the set of files allowed to call `getNflTeamColors`
 * directly. The current allowlist is the "deep-ink composite" family — hero
 * panels, the player modal band, OG images, pick-reveal splash — which are
 * full-bleed dark surfaces with white text on top; a lightened backdrop would
 * break their text contrast, and their fixed deep-ink base already keeps dark
 * teams from failing.
 *
 * If this test fails on a NEW file: use `getPlayerAvatarBackground` /
 * `buildPlayerCellHTML` for avatar chips, or — only if the surface truly
 * belongs to the composite family — add it to the allowlist with a reason.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

/**
 * Files allowed to consume `getNflTeamColors` directly, with why.
 * Everything else must go through the shared avatar helpers.
 */
const ALLOWLIST: Record<string, string> = {
  // The module itself + the shared helpers built on top of it.
  'src/utils/nfl-team-colors.ts': 'defines the palette and the guarded helpers',

  // Deep-ink composite family: full-bleed dark panels, white text on the
  // colored area — the ink base (not a luminance floor) handles dark teams.
  'src/components/theleague/FeatureCompositeHero.astro': 'composite hero',
  'src/components/theleague/AuctionCompositeHero.astro': 'composite hero',
  'src/components/theleague/BreakingStoryHero.astro': 'composite hero',
  'src/components/theleague/CutWatchCompositeHero.astro': 'composite hero',
  'src/components/theleague/PreseasonCompositeHero.astro': 'composite hero',
  'src/components/theleague/UdfaCompositeHero.astro': 'composite hero',
  'src/components/theleague/TaggedShowcaseCompositeHero.astro': 'composite hero',
  'src/components/theleague/FaceoffComposite.astro': 'two-panel composite',
  'src/components/theleague/season-heroes/ArticleHero.astro': 'composite hero',
  'src/components/theleague/trade-builder/TradeCompositeStrip.tsx': 'composite strip',
  'src/components/afl/AflEventHero.astro': 'AFL event hero glow',

  // Intentionally desaturated "dead colors" treatment — must NOT go vibrant.
  'src/components/theleague/DeadMoneyComposite.astro': 'dead-colors composite',
  'src/components/theleague/DeadMoneyPlayerCard.astro': 'dead-colors card',
  'src/pages/theleague/dead-money.astro': 'dead-colors page accents',

  // Client-side band/splash painters (white text on the colored area).
  'src/utils/player-modal-band.ts': 'player modal band painter',
  'src/utils/pick-reveal.ts': 'draft pick-reveal splash colors',

  // Server-rendered OG imagery (dark card, fixed deep-navy ramp).
  'src/utils/schefter-og.ts': 'Schefter OG image background',

  // Page-level composite usage (hero art on the rookies page).
  'src/pages/theleague/rookies-2026.astro': 'rookie hero composites',
};

function grepFiles(pattern: string): string[] {
  try {
    const out = execFileSync(
      'grep',
      ['-rl', '--include=*.ts', '--include=*.tsx', '--include=*.astro', '--include=*.mjs', pattern, 'src/'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    return out.split('\n').filter(Boolean).sort();
  } catch (err: unknown) {
    // grep exits 1 on zero matches — that's an empty result, not an error.
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
}

describe('team-color-behind-player guard', () => {
  it('only allowlisted files consume getNflTeamColors directly', () => {
    const callers = grepFiles('getNflTeamColors');
    const unexpected = callers.filter((f) => !(f in ALLOWLIST));
    expect(
      unexpected,
      `New direct getNflTeamColors consumer(s): ${unexpected.join(', ')}.\n` +
        'For a player-avatar chip, use getPlayerAvatarBackground/getPlayerAvatarBorder ' +
        '(or buildPlayerCellHTML) instead — they carry the dark-mode luminance guard. ' +
        'Only add to the allowlist in tests/team-color-backdrop-guard.test.ts if the ' +
        'surface is genuinely a deep-ink composite with text on the colored area.',
    ).toEqual([]);
  });

  it('allowlist entries are live (no stale files)', () => {
    const callers = new Set(grepFiles('getNflTeamColors'));
    const stale = Object.keys(ALLOWLIST).filter((f) => !callers.has(f));
    expect(
      stale,
      `Allowlisted file(s) no longer call getNflTeamColors — remove them: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('no raw NFL_TEAM_COLORS gradient math outside the color module', () => {
    // Reaching past the helper to the raw table is the other way to reinvent
    // an unguarded backdrop. The table is exported for tests and for
    // precompute loops over its KEYS (players/projected-free-agents pattern),
    // so only flag files that read `.primary`/`.secondary` off the table.
    const files = grepFiles('NFL_TEAM_COLORS\\[');
    const offenders = files.filter((f) => f !== 'src/utils/nfl-team-colors.ts');
    expect(
      offenders,
      `Raw NFL_TEAM_COLORS indexing outside the color module: ${offenders.join(', ')}. ` +
        'Use getNflTeamColors() (allowlisted surfaces) or the avatar helpers.',
    ).toEqual([]);
  });
});
