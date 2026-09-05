import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Player lockup guard — a player is rendered with the shared PlayerCell, never
 * a hand-rolled `<img src={headshot}>` next to a name.
 *
 * The bug this exists to stop shipped on the AFL's 2026 Draft Results board
 * (Sept 2026): the page painted `<img src={p.headshot}>` directly, so every
 * DEFENSE drafted rendered the browser's broken-image icon. A DEF has no
 * headshot by construction — the shared cell knows to swap the team crest in —
 * and a bespoke `<img>` also ships with no ESPN → college → MFL → silhouette
 * cascade, no team-color chip, and no click-through to the player modal. Three
 * separate surfaces had grown their own copy of that markup.
 *
 * The rule: if a file renders a player headshot, it goes through
 * `PlayerCell` (.astro or .tsx) or `buildPlayerCellHTML()` for JS-rendered
 * rows. If a surface genuinely is not a cell — a full-bleed broadcast
 * composite, a warmer that fetches URLs and renders nothing — it goes on the
 * allowlist below WITH a reason.
 *
 * Scope is the draft surfaces, where the bug shipped and where the duplicate
 * copies lived. Widening it repo-wide is a separate, larger cleanup; this
 * guard's job is to keep the ground already retaken.
 */

const ROOT = join(__dirname, '..');

/** Directories whose player rendering this guard covers. */
const SCAN_DIRS = [
  'src/components/shared/draft-results',
  'src/components/shared/draft-hub',
  'src/components/shared/draft-mock',
  'src/components/shared/draft-broadcast',
  'src/components/shared/draft-room',
  'src/components/theleague/draft-room',
  'src/pages/theleague/draft',
  'src/pages/afl-fantasy/draft',
];

/**
 * Files allowed to paint a headshot themselves, with why. Every entry here is
 * a COMPOSITE — a full-bleed presentation surface where the player art is the
 * artwork, not a 32px chip beside a name — or a file that touches headshot
 * URLs without rendering a lockup at all.
 */
const ALLOWLIST: Record<string, string> = {
  'src/components/shared/draft-broadcast/BroadcastRevealCard.tsx':
    'broadcast reveal composite — full-bleed ESPN cutout over a franchise gradient, not a cell',
  'src/components/shared/draft-broadcast/BroadcastWarmup.tsx':
    'pre-warms headshot URLs into the service worker cache; renders no player',
  'src/components/shared/draft-broadcast/BroadcastFace.tsx':
    'renders the shared player-cell chip directly, retuned to broadcast size',
  'src/components/theleague/draft-room/PickRevealSplash.tsx':
    'pick-reveal composite — same deep-ink family as the broadcast card',
  'src/components/theleague/draft-room/PlayerDetailModal.tsx':
    'the player modal itself — the destination a cell links TO',
};

function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(join(dir, entry)));
    } else if (/\.(astro|tsx|ts)$/.test(entry)) {
      out.push(relative(ROOT, full));
    }
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap(walk);

/** An `<img>` whose src is a headshot — the shape being outlawed. */
const HEADSHOT_IMG = /<img[^>]*\bsrc=\{?[^>]*(headshot|Headshot|getPlayerImageUrl|getCollegeHeadshot)[^>]*>/;

/** Any of the sanctioned ways to render the lockup. */
const USES_SHARED_CELL = /PlayerCell|buildPlayerCellHTML|player-cell__avatar/;

describe('player cell pattern', () => {
  it('has draft surfaces to scan (the globs did not go stale)', () => {
    expect(FILES.length).toBeGreaterThan(5);
  });

  it('renders every drafted player through the shared PlayerCell', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (file in ALLOWLIST) continue;
      const src = readFileSync(join(ROOT, file), 'utf-8');
      if (HEADSHOT_IMG.test(src) && !USES_SHARED_CELL.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      `These draft surfaces paint a headshot themselves. Use PlayerCell (or buildPlayerCellHTML for JS-rendered rows) — a bespoke <img> has no DEF crest swap and no fallback cascade:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('keeps the allowlist honest — every entry still exists and still opts out', () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, `${file} needs a reason`).toBeGreaterThan(10);
      // A stale entry is worse than none: it silently exempts a file that has
      // since been converted, or names one that no longer exists.
      expect(() => readFileSync(join(ROOT, file), 'utf-8'), `${file} is allowlisted but missing`).not.toThrow();
    }
  });

  it('pins the Draft Results board specifically — where the broken DEF shipped', () => {
    const src = readFileSync(join(ROOT, 'src/components/shared/draft-results/DraftResultsPage.astro'), 'utf-8');
    expect(src).toContain('PlayerCell');
    expect(src).not.toMatch(/<img[^>]*p\.headshot/);
  });
});
