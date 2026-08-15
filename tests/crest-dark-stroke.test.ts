import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  measureAllCrests,
  buildManifest,
  STROKE_THRESHOLD,
} from '../scripts/measure-crest-contrast.mjs';
import { buildCrestDarkStrokeCss, CREST_STROKE_FILTER } from '../src/utils/crest-dark-stroke-css';

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
  it('scopes to crest-only cells under html.dark and applies the stroke', () => {
    const css = buildCrestDarkStrokeCss([{ icon: '/assets/x.png', franchiseId: '0001' }]);
    expect(css).toContain('html.dark img.team-icon-cell[src="/assets/x.png"]');
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
});
