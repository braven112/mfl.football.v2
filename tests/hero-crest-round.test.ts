/**
 * A crest that is a CROP of the team's MFL banner (a square picture, not a
 * drawn mark) is drawn as a circle on the homepage hero — the owner's call
 * (Sep 2026). The flag is per TEAM (`iconCroppedFromBanner`), set by the
 * branding seed and cleared the moment a commissioner uploads a real icon, so
 * the circle follows the artwork rather than a league setting.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import archies from '../data/archies/archies.config.json';
import { resolveHeroCrest } from '../src/utils/hero-crest';
import { isCroppedBannerCrest, resolveHeroFranchiseBackdrop } from '../src/utils/hero-franchise-backdrop';
import { crestLeagueKey } from '../src/utils/dark-surface-crest';
import { applyBrandingEdit } from '../src/utils/branding-edit.mjs';

describe('banner-crop crests are drawn round', () => {
  it("every Archie's crest is a seeded banner crop today", () => {
    for (const t of archies.teams as Array<{ franchiseId: string; icon: string; iconCroppedFromBanner?: boolean }>) {
      expect(t.iconCroppedFromBanner, t.franchiseId).toBe(true);
      expect(t.icon).toBe(`/assets/archies/icons/${t.franchiseId}.webp`);
    }
  });

  it('the composite watermark and the franchise card both say round for a crop', () => {
    expect(resolveHeroCrest({ franchiseId: '0001', league: 'archies' })?.round).toBe(true);
    const team = (archies.teams as any[]).find((t) => t.franchiseId === '0001');
    expect(resolveHeroFranchiseBackdrop(team, crestLeagueKey('archies'))?.crestRound).toBe(true);
  });

  it('a drawn mark stays as it is (TheLeague, the AFL)', () => {
    expect(resolveHeroCrest({ franchiseId: '0001', league: 'theleague' })?.round).toBeUndefined();
    expect(resolveHeroCrest({ franchiseId: '0001', league: 'afl-fantasy' })?.round).toBeUndefined();
  });

  it('only the seeded icon counts — another artwork on a flagged team is a real mark', () => {
    const team = { iconCroppedFromBanner: true, icon: '/a.webp' } as any;
    expect(isCroppedBannerCrest(team, '/a.webp')).toBe(true);
    expect(isCroppedBannerCrest(team, '/uploaded-dark.webp')).toBe(false);
  });

  it('uploading a new icon clears the flag; other edits keep it', () => {
    const config = { teams: [{ franchiseId: '0001', name: 'Rhinos', icon: '/a.webp', iconCroppedFromBanner: true }] };
    const renamed = applyBrandingEdit(config, '0001', { name: 'Rhinoceroses' });
    expect(renamed.teams[0].iconCroppedFromBanner).toBe(true);
    const uploaded = applyBrandingEdit(config, '0001', { icon: 'https://blob.example/branding/archies/0001/icon.webp' });
    expect(uploaded.teams[0].iconCroppedFromBanner).toBeUndefined();
  });

  it('every hero crest renderer honours the flag', () => {
    expect(readFileSync('src/components/shared/CompositeHero.astro', 'utf8')).toContain("'cmh__crest--round': crest.round");
    for (const f of [
      'src/components/shared/AflEventHero.astro',
      'src/components/theleague/EventHeroShell.astro',
      'src/components/shared/schedule/SchedulePage.astro',
    ]) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/'hero-fb__crest--round': \w+\.crestRound/);
    }
    expect(readFileSync('src/styles/composite-hero.css', 'utf8')).toMatch(/\.cmh__crest\.cmh__crest--round \{[^}]*border-radius: 50%/);
    expect(readFileSync('src/styles/hero-franchise-backdrop.css', 'utf8')).toMatch(/\.hero-fb__crest\.hero-fb__crest--round \{[^}]*border-radius: 50%/);
  });
});
