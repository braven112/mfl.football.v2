/**
 * Player-cell chip sizing guard.
 *
 * `BroadcastFace` renders the site's shared player cell — a `<span
 * class="player-cell__avatar <caller's class>">` wrapping the `<img>` — and
 * player-cell.css documents ONE extension point for its size:
 * `--player-avatar-size`. A caller that instead sets `width`/`height` on its
 * own class is relying on stylesheet ORDER, because `.lbc__face` and
 * `.player-cell__avatar` tie on specificity (0,1,0). player-cell.css is
 * imported from BroadcastFace.tsx and live-broadcast.css from
 * LiveBroadcastPage.astro, so the component's sheet lands last, its
 * `width: var(--player-avatar-size)` finds no property to resolve, computes
 * to `auto`, and the chip grows to the ESPN cutout's intrinsic 352x256. The
 * row's `overflow: hidden` then crops that into a full-bleed band of face —
 * which is how the live broadcast board shipped to a TV on a Sunday with
 * every player cell a letterboxed pair of eyes (Sept 2026).
 *
 * The bug is invisible in the diff that causes it: the CSS reads perfectly,
 * and the rule it loses to lives in another file. So this pins the shape
 * instead — every BroadcastFace call site sizes through the property, and
 * none of them declares width/height on the chip class.
 *
 * If this fails on a NEW call site: replace `width`/`height` in that class
 * with `--player-avatar-size: <the same value>`. `.dbc-idle__row-avatar` and
 * `.dbc-panel__face-chip` are the worked examples.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Every class handed to `<BroadcastFace className="…">`, with its source. */
function faceClassNames(): { cls: string; file: string }[] {
  const found: { cls: string; file: string }[] = [];
  for (const file of walk(join(ROOT, 'src')).filter((f) => /\.(tsx|astro)$/.test(f))) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('<BroadcastFace')) continue;
    // Each element, then the className literal inside it — the prop is written
    // on its own line at every call site, so the element match keeps a stray
    // `className` from a neighbouring component out of the set.
    for (const el of source.match(/<BroadcastFace[\s\S]*?\/>/g) ?? []) {
      const cls = el.match(/className=["']([^"']+)["']/)?.[1];
      if (cls) for (const one of cls.trim().split(/\s+/)) {
        found.push({ cls: one, file: file.slice(ROOT.length + 1) });
      }
    }
  }
  return found;
}

/** The body of `.<cls> { … }` wherever a stylesheet declares it. */
function ruleBodies(cls: string): { body: string; file: string }[] {
  const bodies: { body: string; file: string }[] = [];
  for (const file of walk(join(ROOT, 'src/styles')).filter((f) => f.endsWith('.css'))) {
    const css = readFileSync(file, 'utf8');
    // Comments stripped first: the rules this guard reads are heavily
    // commented, and a `width:` inside prose is not a declaration.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const re = new RegExp(`(^|[,}])\\s*\\.${cls}\\s*\\{([^}]*)\\}`, 'g');
    for (const m of bare.matchAll(re)) bodies.push({ body: m[2], file: file.slice(ROOT.length + 1) });
  }
  return bodies;
}

describe('player-cell chip sizing', () => {
  const callSites = faceClassNames();

  it('finds the BroadcastFace call sites', () => {
    // A rename that silently emptied the set would make every check below
    // vacuous. Three today: the strip, the idle rail, the screensaver panel.
    expect(callSites.length).toBeGreaterThanOrEqual(3);
  });

  it.each(callSites)('$cls sizes through --player-avatar-size', ({ cls, file }) => {
    const rules = ruleBodies(cls);
    expect(rules.length, `${cls} (${file}) has no CSS rule in src/styles`).toBeGreaterThan(0);
    const all = rules.map((r) => r.body).join('\n');
    expect(all, `${cls} (${file}) must set --player-avatar-size`).toMatch(/--player-avatar-size\s*:/);
  });

  it.each(callSites)('$cls does not override the chip width/height', ({ cls }) => {
    for (const { body, file } of ruleBodies(cls)) {
      expect(
        /(^|[;{\s])(width|height)\s*:/.test(body),
        `.${cls} in ${file} declares width/height on a player-cell chip — that ties ` +
          `with .player-cell__avatar on specificity and is decided by stylesheet ` +
          `order. Size it with --player-avatar-size instead.`
      ).toBe(false);
    }
  });
});
