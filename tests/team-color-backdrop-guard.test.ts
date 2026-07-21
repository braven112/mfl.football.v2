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
import { readdirSync, readFileSync } from 'node:fs';
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

// Pure-Node scan (no shelling out to grep — portable across dev platforms,
// same approach as tests/design-token-guard.test.ts). Every pattern below is
// a plain substring, so no regex escaping to get wrong either.
const SOURCE_EXT = /\.(ts|tsx|astro|mjs|js|jsx)$/;

function listSourceFiles(relDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listSourceFiles(rel));
    else if (SOURCE_EXT.test(entry.name)) out.push(rel);
  }
  return out;
}

const sourceFiles = listSourceFiles('src').map((f) => ({
  path: f,
  content: readFileSync(join(ROOT, f), 'utf8'),
}));

/** Repo-relative paths of source files whose content contains `substring`. */
function grepFiles(substring: string): string[] {
  return sourceFiles
    .filter((f) => f.content.includes(substring))
    .map((f) => f.path)
    .sort();
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

  it('no raw NFL_TEAM_COLORS color access outside the color module', () => {
    // Reaching past the helper to the raw table is the other way to reinvent
    // an unguarded backdrop. The table is exported for tests and for
    // precompute loops over its KEYS (players.astro pattern), so flag every
    // way of reading COLORS off it: bracket/dot access, values/entries
    // destructuring, and the exported fallback pair.
    const patterns = [
      'NFL_TEAM_COLORS[',
      'NFL_TEAM_COLORS.',
      'Object.values(NFL_TEAM_COLORS',
      'Object.entries(NFL_TEAM_COLORS',
      'NFL_COLORS_FALLBACK.',
    ];
    const files = new Set<string>();
    for (const pattern of patterns) {
      for (const f of grepFiles(pattern)) files.add(f);
    }
    const offenders = [...files].filter((f) => f !== 'src/utils/nfl-team-colors.ts').sort();
    expect(
      offenders,
      `Raw NFL_TEAM_COLORS/NFL_COLORS_FALLBACK color access outside the color module: ${offenders.join(', ')}. ` +
        'Use getNflTeamColors() (allowlisted surfaces) or the avatar helpers.',
    ).toEqual([]);
  });

  it('every file that renders .player-cell__avatar markup sets the team backdrop', () => {
    // The bug class the allowlist can't see: REUSING the chip markup while
    // omitting --player-avatar-bg silently ships gray chips in dark mode
    // (how projected-free-agents and the AFL players page regressed).
    // querySelector lookups and CSS selectors don't match these patterns —
    // only markup construction does.
    const markupPatterns: string[] = [
      'class="player-cell__avatar', // template strings / .astro templates
      "class:list={['player-cell__avatar", // PlayerCell.astro
      'className={`player-cell__avatar', // PlayerCell.tsx
    ];
    const builders = new Set<string>();
    for (const p of markupPatterns) {
      for (const f of grepFiles(p)) builders.add(f);
    }
    const setsBackdrop = new Set([
      ...grepFiles('--player-avatar-bg'),
      ...grepFiles('getPlayerAvatarBackground'),
    ]);
    const offenders = [...builders].filter((f) => !setsBackdrop.has(f)).sort();
    expect(
      offenders,
      `File(s) render .player-cell__avatar without setting --player-avatar-bg: ${offenders.join(', ')}. ` +
        'Dark mode will show a gray chip instead of the team-color spotlight — use buildPlayerCellHTML, ' +
        '<PlayerCell>, or the getPlayerAvatarStyleMaps() precompute pattern (see players.astro).',
    ).toEqual([]);
  });

  it('every file that sets --player-avatar-bg also sets both ring properties', () => {
    // The ring is theme-split across TWO per-player properties
    // (--player-avatar-ring light / --player-avatar-ring-dark dark). Missing
    // one fails SILENTLY to the translucent CSS fallback — a PIT chip gets a
    // generic gray ring instead of its gold-tinted one, and nobody notices.
    // Any renderer painting the backdrop must set the full ring pair too.
    const setters = grepFiles('--player-avatar-bg');
    const offenders = setters
      .filter(
        (f) =>
          !grepFiles('--player-avatar-ring').includes(f) ||
          !grepFiles('--player-avatar-ring-dark').includes(f),
      )
      .sort();
    expect(
      offenders,
      `File(s) set --player-avatar-bg without the full ring pair (--player-avatar-ring + --player-avatar-ring-dark): ${offenders.join(', ')}. ` +
        'Set both via getPlayerAvatarRing/getPlayerAvatarRingDark (or the ring/ringDark maps on getPlayerAvatarStyleMaps).',
    ).toEqual([]);
  });
});
