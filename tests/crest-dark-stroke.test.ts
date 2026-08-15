import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  measureAllCrests,
  buildManifest,
  STROKE_THRESHOLD,
} from '../scripts/measure-crest-contrast.mjs';
import {
  buildCrestDarkStrokeCss,
  CREST_STROKE_FILTER,
  crestStrokeFilter,
  DEFAULT_CREST_STROKE_COLOR,
} from '../src/utils/crest-dark-stroke-css';

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(
  readFileSync(path.join(ROOT, 'src/data/crest-dark-stroke-manifest.json'), 'utf8'),
);

const theleagueConfig = JSON.parse(
  readFileSync(path.join(ROOT, 'src/data/theleague.config.json'), 'utf8'),
);
const aflConfig = JSON.parse(
  readFileSync(path.join(ROOT, 'data/afl-fantasy/afl.config.json'), 'utf8'),
);

describe('crest dark-mode stroke manifest', () => {
  it('matches what the committed crest assets actually measure', async () => {
    // The whole point of the manifest is that the stroke list is derived, not
    // hand-curated. If someone swaps a crest for a brighter/darker one, or adds
    // an iconDark, this fails until they re-run `pnpm measure:crest-contrast`.
    const measured = buildManifest(await measureAllCrests());
    expect(measured.needsStroke).toEqual(manifest.needsStroke);
    expect(measured.threshold).toBe(manifest.threshold);
  }, 60_000);

  it('never strokes a team that has a hand-authored iconDark', () => {
    // A team with real dark artwork swaps to it; stroking as well would put a
    // white ring around a logo already drawn for dark mode.
    const withDark = new Set<string>();
    for (const [slug, cfg] of [['theleague', theleagueConfig], ['afl', aflConfig]] as const) {
      for (const t of cfg.teams ?? []) {
        if (t.iconDark) withDark.add(`${slug}:${t.franchiseId}`);
      }
    }
    for (const entry of manifest.needsStroke) {
      expect(withDark.has(`${entry.league}:${entry.franchiseId}`)).toBe(false);
    }
  });

  it('only lists crests below the threshold', () => {
    for (const entry of manifest.needsStroke) {
      expect(entry.legible).toBeLessThan(STROKE_THRESHOLD);
      expect(entry.legible).toBeGreaterThanOrEqual(0);
    }
  });

  it('every listed icon resolves to a real team in that league config', () => {
    const configs: Record<string, any> = { theleague: theleagueConfig, afl: aflConfig };
    for (const entry of manifest.needsStroke) {
      const cfg = configs[entry.league];
      expect(cfg, `unknown league ${entry.league}`).toBeTruthy();
      const team = (cfg.teams ?? []).find((t: any) => t.franchiseId === entry.franchiseId);
      expect(team, `${entry.league} ${entry.franchiseId} not in config`).toBeTruthy();
      // The CSS selector is an exact src match — a drifted icon string silently
      // stops matching and the stroke just stops applying.
      expect(team.icon).toBe(entry.icon);
    }
  });
});

describe('buildCrestDarkStrokeCss', () => {
  it('applies to every crest img under html.dark, not just one component', () => {
    // Keyed on src alone (like the dark swap) so the stroke reaches all ~20
    // crest call sites — Astro, React islands, and client-built HTML — without
    // touching any of them. A per-component selector left the same franchise
    // ringed on one page and bare on another.
    const css = buildCrestDarkStrokeCss([{ icon: '/assets/x.png', franchiseId: '0001' }]);
    expect(css).toContain('html.dark img[src="/assets/x.png"]');
    expect(css).not.toContain('team-icon-cell');
    expect(css).toContain(CREST_STROKE_FILTER);
  });

  it('emits a franchise-id alias rule when given a directory', () => {
    const css = buildCrestDarkStrokeCss(
      [{ icon: '/assets/afl/icons/smokane.png', franchiseId: '0001' }],
      { franchiseIconDir: '/assets/afl/icons' },
    );
    expect(css).toContain('[src="/assets/afl/icons/smokane.png"]');
    expect(css).toContain('[src="/assets/afl/icons/0001.png"]');
  });

  it('handles absolute AFL icon URLs unchanged', () => {
    const url = 'https://mflfootballv2.vercel.app/assets/afl/icons/badd_boys.png';
    expect(buildCrestDarkStrokeCss([{ icon: url }])).toContain(`[src="${url}"]`);
  });

  it('returns empty string when nothing qualifies', () => {
    expect(buildCrestDarkStrokeCss([])).toBe('');
  });

  it('honors a per-team stroke color and groups the rest under the default', () => {
    const css = buildCrestDarkStrokeCss([
      { icon: '/a.png', strokeColor: '#ffcd00' },
      { icon: '/b.png' },
      { icon: '/c.png' },
    ]);
    expect(css).toContain(crestStrokeFilter('#ffcd00'));
    expect(css).toContain(crestStrokeFilter(DEFAULT_CREST_STROKE_COLOR));
    // b and c share the default color, so they collapse into one rule.
    expect(css.match(/filter:/g)).toHaveLength(2);
    expect(css).toContain('[src="/b.png"],\nhtml.dark img[src="/c.png"]');
  });
});

describe('iconStrokeDark overrides', () => {
  const configs: Record<string, any> = { theleague: theleagueConfig, afl: aflConfig };

  it('only sets iconStrokeDark on teams that actually get a stroke', () => {
    // An override on a team that is never stroked is dead config — it reads as
    // if it were doing something, and nothing would reveal that it isn't.
    const stroked = new Set(manifest.needsStroke.map((e: any) => `${e.league}:${e.franchiseId}`));
    for (const [slug, cfg] of Object.entries(configs)) {
      for (const t of cfg.teams ?? []) {
        if (t.iconStrokeDark === undefined) continue;
        expect(
          stroked.has(`${slug}:${t.franchiseId}`),
          `${slug} ${t.name} sets iconStrokeDark but is not in the stroke manifest`,
        ).toBe(true);
      }
    }
  });

  it('opting out with false removes the crest from the emitted CSS', () => {
    const css = buildCrestDarkStrokeCss([
      { icon: '/keep.png' },
      { icon: '/optout.png', strokeColor: false },
    ]);
    expect(css).toContain('[src="/keep.png"]');
    expect(css).not.toContain('/optout.png');
  });

  it('matches both the absolute and same-origin form of an AFL icon', () => {
    // TeamIconCell renders the same-origin path; other surfaces render the raw
    // absolute config value. A rule that only covered one would silently skip
    // the other.
    const css = buildCrestDarkStrokeCss([
      { icon: 'https://mflfootballv2.vercel.app/assets/afl/icons/badd_boys.png' },
    ]);
    expect(css).toContain('[src="https://mflfootballv2.vercel.app/assets/afl/icons/badd_boys.png"]');
    expect(css).toContain('[src="/assets/afl/icons/badd_boys.png"]');
  });

  it('every override color itself clears 3:1 on the dark card', () => {
    // A stroke that doesn't contrast with the card cannot separate the logo
    // from it — the whole point of the override is legibility, not decoration.
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bg = lum([0x26, 0x26, 0x26]);

    for (const [slug, cfg] of Object.entries(configs)) {
      for (const t of cfg.teams ?? []) {
        // `false` is an opt-out, not a color — nothing to contrast-check.
        if (!t.iconStrokeDark || t.iconStrokeDark === false) continue;
        const hex = String(t.iconStrokeDark).trim();
        expect(hex, `${slug} ${t.name}: expected a #rrggbb color`).toMatch(/^#[0-9a-f]{6}$/i);
        const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const l = lum(rgb);
        const ratio = (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05);
        expect(ratio, `${slug} ${t.name}: ${hex} is ${ratio.toFixed(2)}:1 on #262626`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
