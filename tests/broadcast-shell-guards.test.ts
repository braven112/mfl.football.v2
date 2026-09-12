/**
 * The broadcast shell's structural rules — the ones that live in CSS and in
 * component wiring, where only a scan can hold them.
 *
 * Every block below is a bug this repo has already shipped somewhere else,
 * pointed at the one surface most likely to repeat it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * The file with its comments removed.
 *
 * Every rule below is DOCUMENTED in the file it guards — the CSS explains why
 * it carries no `html.dark`, the page explains why it does not call
 * `Astro.redirect()`. A scan over the raw text therefore matches the prose
 * describing the trap and reports the file as containing it, which is the one
 * way a guard can be worse than no guard: it fails loudest on the code that
 * documents itself best. Strip comments first and assert against the code.
 */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const CSS = read('src/styles/live-broadcast.css');
const CSS_CODE = code(CSS);
const ISLAND = read('src/components/shared/live-broadcast/LiveBroadcast.tsx');
const ISLAND_CODE = code(ISLAND);
const PAGE = read('src/components/shared/live-broadcast/LiveBroadcastPage.astro');
const PAGE_CODE = code(PAGE);
const ROUTES = [
  'src/pages/theleague/broadcast.astro',
  'src/pages/afl-fantasy/broadcast.astro',
].map((p) => [p, code(read(p))] as const);

describe('the broadcast surface consumes NO colour token', () => {
  it('references no --color-*, --card-*, --content-*, --page-* or --league-accent', () => {
    // Every one of them either inverts under html.dark (--color-gray-900
    // resolves to near-WHITE, so a "dark broadcast panel" turns white at
    // night), is floored against a surface this page does not have, or flips
    // brightness with the theme. Ink here is always white and the ground is
    // always dark, in both themes.
    const banned = /var\(\s*--(color|card|content|page|league-accent|team-accent)[\w-]*/g;
    expect(CSS.match(banned) ?? []).toEqual([]);
  });

  it('needs no html.dark override, and has none', () => {
    // A dark-in-both-themes surface with a dark override is a surface someone
    // has started theming — which is the first half of shipping white-on-white.
    expect(CSS_CODE).not.toMatch(/html\.dark/);
    expect(CSS_CODE).not.toMatch(/\[data-theme/);
  });

  it('declares every custom property the island writes inline', () => {
    // design-token-guard reads CSS only, so a property that exists solely as a
    // JS-set inline style is indistinguishable from a typo'd token silently
    // resolving to its fallback in both themes.
    for (const prop of ['--lbc-drift-x', '--lbc-drift-y', '--lbc-drift-y2', '--lbc-dim', '--lbc-mine', '--lbc-theirs', '--wp-split', '--lbc-primary', '--lbc-secondary']) {
      expect(CSS, `${prop} must be declared, not only referenced`).toMatch(
        new RegExp(`^\\s*${prop}\\s*:`, 'm'),
      );
    }
  });

  it('splits the gradient into background-color + background-image', () => {
    // `background: var(--x)` is all-or-nothing: a value rejected for the
    // property resets it to transparent, not to the cascade winner.
    expect(CSS).toMatch(/background-color:\s*#[0-9a-f]{6};\s*\n\s*background-image:\s*var\(\s*--lbc-gradient/i);
    expect(CSS).not.toMatch(/\n\s*background:\s*var\(\s*--lbc-gradient/);
  });
});

describe('burn-in', () => {
  it('drifts with a transform, never a layout property', () => {
    // A layout-affecting drift re-lays out the entire board every 90 seconds
    // for eight hours.
    expect(CSS).toMatch(/transform:\s*translate3d\(var\(--lbc-drift-x/);
    const driftRules = CSS.match(/(top|left|right|bottom|margin[\w-]*):\s*[^;]*--lbc-drift/g) ?? [];
    expect(driftRules).toEqual([]);
  });

  it('uses co-prime periods so the two orbits never coincide', () => {
    const root = Number(/DRIFT_ROOT_MS = ([\d_]+)/.exec(ISLAND)?.[1].replace(/_/g, ''));
    const glyph = Number(/DRIFT_GLYPH_MS = ([\d_]+)/.exec(ISLAND)?.[1].replace(/_/g, ''));
    expect(root).toBeGreaterThan(0);
    expect(glyph).toBeGreaterThan(0);
    expect(glyph).not.toBe(root);
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    // Their least common multiple must be long enough that the paths do not
    // realign within a session.
    expect((root * glyph) / gcd(root, glyph)).toBeGreaterThan(60 * 60 * 1000);
  });

  it('keeps the drift OUT of prefers-reduced-motion', () => {
    // It is sub-perceptual hardware protection, not decoration. Disabling it
    // would leave a static image on a panel for eight hours.
    const rm = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion'));
    expect(rm).not.toMatch(/--lbc-drift/);
  });
});

describe('the red-zone banner', () => {
  it('is never animated beyond its entrance', () => {
    // A persistent flasher for a whole drive is intolerable to sit in front
    // of, and anything near 3 Hz is a photosensitivity hazard.
    const block = /\.lbc__redzone\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(block).toMatch(/animation:\s*lbc-rz-in/);
    expect(block).not.toMatch(/infinite/);
    // The only keyframes it may reference run once.
    // Capture only THIS keyframes block — `[^@]*` runs to the next at-rule and
    // would swallow the pulse animation, which legitimately loops.
    const rz = /@keyframes lbc-rz-in\s*\{(?:[^{}]|\{[^{}]*\})*\}/.exec(CSS)?.[0] ?? '';
    expect(rz).toBeTruthy();
    expect(rz).not.toMatch(/infinite/);
  });

  it('sits above the stage layer', () => {
    const stageZ = Number(/\.lbc__stage\s*\{[^}]*z-index:\s*(\d+)/.exec(CSS)?.[1]);
    const rzZ = Number(/\.lbc__redzone\s*\{[^}]*z-index:\s*(\d+)/.exec(CSS)?.[1]);
    expect(rzZ).toBeGreaterThan(stageZ);
  });
});

describe('reduced motion kills all three motion sources', () => {
  it('covers keyframes, the strip transition and the reveal repaint', () => {
    // Killing @keyframes alone leaves the page transition and the gradient
    // repaint moving — the playoffs shimmer shipped exactly that way.
    const rm = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion'));
    expect(rm).toMatch(/\.lbc__page/);
    expect(rm).toMatch(/\.lbc-reveal/);
    expect(rm).toMatch(/\.lbc__strip/);
    expect(rm).toMatch(/transition:\s*none/);
    expect(rm).toMatch(/animation:\s*none/);
  });
});

describe('the layer stack', () => {
  it('hides the strip on `strip` or `all`, and the header only on `all`', () => {
    // The lower third must COEXIST with the scoreboard — an opponent's score
    // is not worth taking the board away for.
    expect(ISLAND).toMatch(/hidden=\{occludes === 'all'\}/);
    expect(ISLAND).toMatch(/hidden=\{occludes !== 'none'\}/);
  });

  it('gives the lower third occludes:none and the takeover occludes:strip', () => {
    expect(ISLAND).toMatch(/kind: 'takeover'[^;]*occludes: 'strip'/);
    expect(ISLAND).toMatch(/kind: 'lower-third'[^;]*occludes: 'none'/);
  });

  it('puts no in-transition on the stage layer', () => {
    // Two curves of the same length compound to their square and the layer
    // beneath dips toward black at the midpoint of every reveal.
    const block = /\.lbc__stage\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(block).not.toMatch(/transition:\s*opacity/);
  });
});

describe('the reveal variants differ in more than wording', () => {
  it('differs in area, colour treatment and motion — not just copy', () => {
    // An owner reads this from ten feet with the real game on the other
    // television. A variant that differs only in a word is not a variant.
    const takeover = read('src/components/shared/live-broadcast/MomentTakeover.tsx');
    const third = read('src/components/shared/live-broadcast/MomentLowerThird.tsx');

    // 1. Area: the takeover fills, the third is a band.
    expect(CSS).toMatch(/\.lbc__stage--takeover\s*\{\s*inset:\s*var\(--lbc-header-h\)/);
    expect(CSS).toMatch(/\.lbc__stage--lower-third\s*\{[^}]*height:\s*26vh/);

    // 2. Colour: a FIELD for mine, a hairline rule for theirs.
    expect(takeover).toMatch(/--lbc-gradient|lbc-reveal/);
    expect(/\.lbc-third\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '').toMatch(/border-top:[^;]*--lbc-primary/);
    expect(/\.lbc-third\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '').not.toMatch(/background-image/);

    // 3. Motion: scale-in vs slide-up.
    expect(CSS).toMatch(/@keyframes lbc-reveal-in/);
    expect(CSS).toMatch(/@keyframes lbc-third-in/);

    // 4. Kicker wording, as the redundant fourth channel — never the only one.
    expect(third).toMatch(/Against you/);
  });
});

describe('the fixes that a scan is the only thing holding', () => {
  const HEADER = code(read('src/components/shared/live-broadcast/BroadcastScoreHeader.tsx'));
  const STRIP = code(read('src/components/shared/live-broadcast/BroadcastPlayerStrip.tsx'));
  const BANNER = code(read('src/components/shared/live-broadcast/RedZoneBanner.tsx'));
  const BOARD = code(read('src/utils/broadcast-board.ts'));

  it('passes `inert` as a real boolean', () => {
    // React treats `inert=""` as FALSE and logs a warning, so the empty-string
    // spelling silently never applied and the occluded layer stayed in the
    // a11y tree for the whole 930ms visibility delay.
    expect(HEADER).toMatch(/inert=\{hidden\}/);
    expect(HEADER).not.toMatch(/inert:\s*''/);
    expect(STRIP).not.toMatch(/inert:\s*''/);
  });

  it('renders the clock element its own drop ladder targets', () => {
    // `.lbc__gameclock` had a drop rung and no producer, so rung 4 of 6
    // dropped nothing and the header carried no clock at all.
    expect(HEADER).toMatch(/lbc__gameclock/);
    expect(CSS).toMatch(/\.lbc__gameclock/);
  });

  it('paints marks with the SWATCH and fields with the primary', () => {
    // Two different legibility problems: a 0.7vh bar on `--lbc-panel` and a
    // full-screen field on the darker ground. `toBroadcastPair` only darkens,
    // so it can make a colour safe to write on but never visible.
    expect(HEADER).toMatch(/--lbc-mine'.*\]:\s*matchup\.mine\.swatch/s);
    expect(BOARD).toMatch(/ensureFieldOn/);
    expect(BOARD).toMatch(/ensureContrastOn/);
  });

  it('resolves a franchise gradient and a real second stop', () => {
    // `toBroadcastPair(primary, primary)` made every "gradient" a flat field,
    // and a franchise declaring its own look never got it.
    expect(BOARD).toMatch(/resolveBroadcastGradient/);
    expect(BOARD).not.toMatch(/toBroadcastPair\(\s*rawPrimary,\s*rawPrimary\s*\)/);
  });

  it('mounts BOTH pages during a strip handoff', () => {
    // A transition never runs on mount, so a single swapped page lands at its
    // final state and every rotation is a hard cut.
    expect(STRIP).toMatch(/outgoing/);
    expect(CSS).toMatch(/@keyframes lbc-page-in/);
  });

  it('keeps the red-zone banner out of the live region', () => {
    // Its text carries down & distance, which changes every play — a live
    // region re-read the whole banner every few seconds for a whole drive.
    expect(BANNER).not.toMatch(/aria-live/);
    expect(BANNER).toMatch(/aria-hidden/);
  });

  it('never prints a score for a league whose feed it could not read', () => {
    // `0.0` is a real score. Printing it for a failed read says "nobody has
    // scored yet" — the same "no games" / "couldn't read it" merge the whole
    // live-scoring rule set exists to prevent, and on this board a dimmed
    // panel of zeros is exactly what a pre-kickoff Sunday morning looks like.
    expect(HEADER).toMatch(/const score = /);
    expect(HEADER).toMatch(/readable/);
    // The scores, the projections, the bar, the percentage and the leading
    // emphasis are ALL assertions about numbers we do not have.
    expect(HEADER).toMatch(/lbc__score">\{score\(/);
    expect(HEADER).toMatch(/matchup\.opponent && readable &&/);
    expect(HEADER).toMatch(/readable && mineLive >= theirsLive/);
    // And it says so, rather than only going quiet.
    expect(HEADER).toMatch(/Feed unavailable/);
  });

  it('gives the board a document shell, so it has a font and a title', () => {
    // Rendered bare, the whole board fell back to the UA serif — which has no
    // `tabular-nums`, so every score would jitter its column width on a tick —
    // with no lang and no title.
    expect(PAGE_CODE).toMatch(/TheLeagueLayout/);
    expect(CSS).toMatch(/font-family:/);
  });
});

describe('the page never fetches its own API', () => {
  it('assembles the board in process', () => {
    // A server that already knows the league's registry host has nothing to
    // gain by asking its own edge over the public internet for what it can
    // read directly — and that hop has silently stopped landing once already.
    expect(PAGE_CODE).toMatch(/assembleBroadcastBoard/);
    expect(PAGE_CODE).not.toMatch(/fetch\(/);
    expect(PAGE_CODE).not.toMatch(/\/api\/broadcast-live/);
  });

  it('leaves the polling to the island', () => {
    expect(ISLAND).toMatch(/\/api\/broadcast-live/);
  });
});

describe('the routes own the gate and the cookie', () => {
  it('redirects from the PAGE, never from the shared component', () => {
    // `Astro.redirect()` from a component's frontmatter merely stops rendering
    // it — the response is still a 200 with a blank body.
    for (const [path, src] of ROUTES) {
      expect(src, `${path} must gate`).toMatch(/getAuthUser/);
      expect(src, `${path} must redirect`).toMatch(/Astro\.redirect/);
    }
    expect(PAGE_CODE).not.toMatch(/Astro\.redirect/);
  });

  it('sends each league’s visitor to its OWN login', () => {
    // A correct href still bounces a user cross-league if the gate redirects
    // to the other league's sign-in.
    const [[, theleague], [, afl]] = ROUTES;
    expect(theleague).toMatch(/\/theleague\/login/);
    expect(theleague).not.toMatch(/\/afl-fantasy\/login/);
    expect(afl).toMatch(/\/afl-fantasy\/login/);
    expect(afl).not.toMatch(/\/theleague\/login/);
  });

  it('writes cookies only from the route', () => {
    // `Astro.cookies.set()` from an imported component runs after the headers
    // are committed and throws, blanking the page.
    for (const [path, src] of ROUTES) {
      expect(src, `${path} must remember choices`).toMatch(/rememberBroadcastChoices/);
    }
    expect(PAGE_CODE).not.toMatch(/cookies\.set/);
  });
});

describe('the island', () => {
  it('gates on the ok FLAG, not on the presence of a field', () => {
    // `res.ok` is not "the data is good" and `{}` is truthy: the route answers
    // 200 with ok:false and empty collections when MFL fails.
    expect(ISLAND).toMatch(/body\?\.ok === false/);
  });

  it('keeps the last good data when a poll fails', () => {
    // "The feed says nothing" and "we could not reach the feed" are different
    // facts all the way to the pixels.
    const cat = /catch \{[\s\S]*?setStatus\('error'\)/.exec(ISLAND_CODE)?.[0] ?? '';
    expect(cat).toBeTruthy();
    expect(cat).not.toMatch(/setPoll\(/);
  });

  it('carries both a fetch timeout and an independent watchdog', () => {
    // The loop is a self-chaining timeout, so a hung fetch does not delay the
    // chain — it breaks it, and the board freezes with no sign anything is
    // wrong. That froze the 2026 draft rehearsal board at pick 7.
    expect(ISLAND).toMatch(/AbortSignal\.timeout\(POLL_TIMEOUT_MS\)/);
    expect(ISLAND).toMatch(/POLL_WATCHDOG_MS/);
    expect(ISLAND).toMatch(/setInterval/);
  });

  it('hydrates exactly one island, on load', () => {
    // The TV is opened and walked away from: client:idle can be minutes and
    // client:visible is meaningless at full viewport. A second island would
    // mean two clocks and two queues.
    const directives = PAGE_CODE.match(/client:\w+/g) ?? [];
    expect(directives).toEqual(['client:load']);
  });
});
