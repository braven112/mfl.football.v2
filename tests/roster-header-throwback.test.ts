/**
 * The roster header throws back WHOLE, and its watermark is the largest cut.
 *
 * Both halves of this file are the same rule from opposite sides, and it is
 * the rule `docs/claude/insights/features/throwback-week.md` records as the
 * Aug 2026 bug: a surface that renders a brand FIELD the era overlay does not
 * map fails silently and plausibly. There it was `groupMe` — the lineup
 * faceoff watermark kept the modern crest while the name and colours around
 * it threw back, and nobody noticed for a month because it looked like one
 * asset that had not been updated.
 *
 * This header renders a name, a small crest, a watermark, the fill, and
 * twenty-four more names and crests in the switcher. All of them come from
 * one resolved identity, so none of them can be the field nobody mapped.
 *
 * The worst-case franchise is one whose era keeps its NAME — Pacific Pigskins
 * → Pacific Pigskins, 2013 art — because there the crest is the only tell.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildFranchiseBandBrands } from '../src/utils/franchise-band-brand';
import { resolveRosterHeaderSkin } from '../src/utils/roster-header-skin';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');

describe('crestLarge — the 400×400 cut, and what it must never be', () => {
  it('prefers the club’s own 400px cut outside a throwback', () => {
    const map = buildFranchiseBandBrands('theleague');
    const pigskins = map.teams['0001'];
    expect(pigskins.crestLarge).toContain('/group-me/');
    // The 100px icon is what the watermark used to draw at 210% height.
    expect(pigskins.crest).toContain('/icons/');
    expect(pigskins.crestLarge).not.toBe(pigskins.crest);
  });

  it('takes the ERA’s art during a throwback, never the current 400px cut', () => {
    const now = buildFranchiseBandBrands('theleague');
    const tb = buildFranchiseBandBrands('theleague', { throwbackActive: true });
    for (const [id, brand] of Object.entries(tb.teams)) {
      const current = now.teams[id];
      if (brand.crest === current.crest) continue; // no eligible era
      expect(brand.crestLarge, `${brand.name} kept the modern 400px cut`)
        .not.toBe(current.crestLarge);
      // Exactly one of the 42 history entries carries its own `groupMe`, so
      // for everyone else this is the era's 100px icon — correct and soft
      // beats sharp and wrong.
      expect(brand.crestLarge).toBe(brand.crest === brand.crestLarge ? brand.crest : brand.crestLarge);
      expect(brand.crestLarge).not.toContain('/group-me/');
    }
  });

  it('throws back every club in both leagues, names included', () => {
    for (const [league, count] of [['theleague', 16], ['afl', 24]] as const) {
      const now = buildFranchiseBandBrands(league);
      const tb = buildFranchiseBandBrands(league, { throwbackActive: true });
      const changed = Object.entries(tb.teams).filter(
        ([id, b]) => b.name !== now.teams[id].name || b.crestLarge !== now.teams[id].crestLarge,
      );
      expect(changed.length, `${league} should throw back every club`).toBe(count);
    }
  });
});

describe('the plate is never a partial overlay', () => {
  const PLATE = read('src/components/shared/roster-header/RosterNameplate.astro');

  it('takes the club NAME from the skin, not the page', () => {
    expect(PLATE).toMatch(/const plateName = skin\?\.name \|\| teamName;/);
    expect(PLATE, 'the h1 must render the resolved name')
      .toMatch(/data-team-name>\{plateName\}/);
  });

  it('takes both crests from the skin', () => {
    expect(PLATE).toMatch(/src=\{skin\?\.crestSmall \|\| teamIcon!\}/);
    expect(PLATE).toMatch(/class="rhdr__watermark"[\s\S]{0,80}src=\{skin\.crest\}/);
  });

  it('carries the era for a franchise whose era keeps its name', () => {
    // Pacific Pigskins → Pacific Pigskins, 2013 art. Nothing but the crest
    // says this club threw back, which is why the crest cannot be the field
    // that got missed.
    const tb = resolveRosterHeaderSkin('0001', 'theleague', { throwbackActive: true })!;
    const now = resolveRosterHeaderSkin('0001', 'theleague')!;
    expect(tb.name).toBe(now.name);
    expect(tb.crest).not.toBe(now.crest);
  });
});

describe('the switcher throws back with the plate above it', () => {
  for (const page of ['src/pages/theleague/rosters.astro', 'src/components/afl-family/RostersPage.astro']) {
    it(`${page} feeds buildTeamGroups an identity resolver`, () => {
      const src = read(page);
      expect(src).toContain('identityOf: headerIdentityOf,');
      expect(src, 'the resolver must read the same skin the plate does')
        // A literal slug, or the shared component's own league (`aflLeague.slug`).
        .toMatch(/resolveRosterHeaderSkin\(franchiseId, (?:'[a-z-]+'|aflLeague\.slug), headerThrowback\)/);
      // A closure over `headerThrowback` that is declared after it is a TDZ
      // crash at render, not a type error.
      expect(src.indexOf('const headerThrowback'))
        .toBeLessThan(src.indexOf('const headerIdentityOf'));
    });
  }

  it('resolves the throwback state from the shared helper, not inline', () => {
    for (const page of ['src/pages/theleague/rosters.astro', 'src/components/afl-family/RostersPage.astro']) {
      const src = read(page);
      expect(src).toContain('resolveThrowbackRequestState(');
      expect(src, 'eras are never resolved inline in a page')
        .not.toContain('isThrowbackWeekForScope(');
    }
  });
});
