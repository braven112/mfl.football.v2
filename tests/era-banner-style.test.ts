import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { eraBannerStyle } from '../src/utils/era-banner-style';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import theleagueConfig from '../src/data/theleague.config.json';

const configs = [
  ['afl', (aflConfig as any).teams as any[]],
  ['theleague', (theleagueConfig as any).teams as any[]],
] as const;

const erasOf = (teams: any[]) =>
  teams.flatMap((t) => (t.history ?? []).map((e: any) => ({ team: t, era: e })));

/**
 * The banner slots live in two components now — the owner-facing picker
 * (shared by `/throwback-settings` and `/preferences`) and the commissioner
 * panel that stayed on the settings page. Find each class wherever it is
 * DEFINED, and insist it is defined exactly once: a second copy of one of
 * these rules is the fork this split was made to avoid.
 */
const BANNER_SOURCES = [
  'src/components/shared/ThrowbackEraPicker.astro',
  'src/components/shared/ThrowbackSettingsPage.astro',
] as const;

function bannerRule(cls: string): string {
  const owners = BANNER_SOURCES.map((f) => [f, readFileSync(f, 'utf8')] as const).filter(
    ([, src]) => src.includes(`.${cls} {`),
  );
  expect(
    owners.map(([f]) => f),
    `.${cls} must be styled in exactly one component`,
  ).toHaveLength(1);
  const block = owners[0][1].slice(owners[0][1].indexOf(`.${cls} {`));
  return block.slice(0, block.indexOf('}'));
}

describe('era banner backdrop', () => {
  it('paints the letterbox with the era palette', () => {
    expect(eraBannerStyle({ colorPrimary: '#123456', colorSecondary: '#abcdef' })).toBe(
      'background: linear-gradient(180deg, #123456 0%, #abcdef 100%)',
    );
  });

  it('runs top-to-bottom so both flanks match', () => {
    // The art is centered in the box, so a diagonal gradient puts the primary
    // on one flank and the secondary on the other — two mismatched slabs
    // bolted to a logo rather than one field. Verified in the browser at
    // 135deg before it was changed.
    const css = eraBannerStyle({ colorPrimary: '#111111', colorSecondary: '#222222' })!;
    expect(css).toContain('180deg');
    expect(css).not.toContain('135deg');
  });

  it('falls back to one flat color when an era has only a primary', () => {
    expect(eraBannerStyle({ colorPrimary: '#ff0000' })).toBe(
      'background: linear-gradient(180deg, #ff0000 0%, #ff0000 100%)',
    );
  });

  it('returns undefined without a palette, leaving the themed CSS fallback', () => {
    // Not a hardcoded grey: the stylesheet's `var(--content-border)` is
    // theme-aware and an inline literal would beat it in both themes.
    expect(eraBannerStyle({})).toBeUndefined();
    expect(eraBannerStyle(null)).toBeUndefined();
    expect(eraBannerStyle(undefined)).toBeUndefined();
    expect(eraBannerStyle({ colorSecondary: '#00ff00' })).toBeUndefined();
  });

  for (const [name, teams] of configs) {
    it(`every ${name} era with a banner has a palette to back it`, () => {
      // The gradient is the whole treatment for the 21 legacy "banners" that
      // are really a 100px franchise logo. An era added without colors gets
      // the grey box those were rescued from, so this is a ratchet, not a
      // preference.
      const naked = erasOf(teams)
        .filter(({ era }) => era.banner && !eraBannerStyle(era))
        .map(({ team, era }) => `${team.franchiseId} ${era.yearStart} ${era.name}`);
      expect(naked, `eras missing colorPrimary:\n${naked.join('\n')}`).toEqual([]);
    });
  }

  it('the banner slots stay object-fit: contain', () => {
    // `cover` is the tempting fix and it is wrong: a 92x180 portrait cropped
    // to a ~6:1 strip is a horizontal sliver with no way to tell whose it is.
    // The gradient exists so `contain` no longer looks unfinished — if a slot
    // ever flips to `cover`, the gradient is decoration on top of a crop.
    for (const cls of ['tbw-imposed__banner', 'tbw-card__banner', 'tbw-cg__banner']) {
      expect(bannerRule(cls), `${cls} must letterbox, not crop`).toContain('object-fit: contain');
    }
  });

  it('the imposed banner is height-capped, not auto', () => {
    // `height: auto` on a full-width img renders an 850x589 legacy logo as a
    // 589px-tall page header. The Throwback Rebrand is reassigned every year
    // and the next assignment may be any shape at all.
    expect(bannerRule('tbw-imposed__banner')).toMatch(/height:\s*\d+px/);
  });
});
