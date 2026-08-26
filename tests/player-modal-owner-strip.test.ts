/**
 * Player modal → "Rostered by" owner strip.
 *
 * Both Free Agents pages list rostered players too (the "Include rostered"
 * toggle, TheLeague's auction rows), and the modal they open had no way to say
 * so: the band fell back to NFL colors and the contract card stamped "FA ·
 * FREE AGENT" on a player under contract somewhere. The fix is one payload
 * field (`franchiseId`) plus a strip that names the franchise, so each case
 * below is a way that regresses back into a page that calls owned players
 * free. The AFL's answer is per-conference — the same player has two owners
 * there — so its wiring is guarded separately.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildFranchiseBandBrands } from '../src/utils/franchise-band-brand';
import { franchiseTintHue } from '../src/utils/player-modal-band';
import { pickBrandHue } from '../src/utils/franchise-hue';
import { chroma } from '../src/utils/nfl-team-colors';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

const playersPage = read('src/pages/theleague/players.astro');
const aflPlayersPage = read('src/pages/afl-fantasy/players.astro');
const modal = read('src/components/theleague/PlayerDetailsModal.astro');

describe('Free Agents → modal payload', () => {
  it('sends the owning franchise, so a rostered player wears his fantasy team', () => {
    // Without this the band silently falls back to the NFL palette and the
    // strip stays hidden — the exact pre-fix behavior, with no error anywhere.
    expect(playersPage).toMatch(/franchiseId: p\.franchiseId/);
  });

  it('sends the contract alongside it, so the card cannot say FA about an owned player', () => {
    expect(playersPage).toMatch(/salary: p\.salary/);
    expect(playersPage).toMatch(/contractYears: p\.contractYrs/);
  });

  it('carries the franchise from the roster feed rather than a bare rostered flag', () => {
    // `rosteredPlayers` is keyed by player id across all 16 franchises; drop
    // the franchise from its value and there is nothing to hand the modal.
    expect(playersPage).toMatch(/franchiseId: franchise\.id/);
    expect(playersPage).toMatch(/franchiseId: rosterInfo\?\.franchiseId \?\? null/);
  });
});

describe('AFL Free Agents → modal payload', () => {
  it('sends the owner for the VIEWED conference, not a league-wide one', () => {
    // The AFL is a duplicate-player league: the same player is held by one
    // franchise in the AL and a different one in the NL. Sending either
    // unconditionally names the wrong team for half the league.
    expect(aflPlayersPage).toMatch(/franchiseId: ownerForView\(p\)/);
    expect(aflPlayersPage).toMatch(/p\.owners\[activeConf \|\| ''\]/);
  });

  it('reads the conference at render time, so the switcher re-owns the rows', () => {
    // `activeConf` is reassigned by the conference switcher without a
    // reload. Capturing it once would leave every row named by the
    // conference the page happened to open on.
    expect(aflPlayersPage).toMatch(/function ownerForView\(p\) \{[\s\S]*?activeConf/);
  });
});

describe('PlayerDetailsModal → owner strip', () => {
  it('hides the strip when there is no franchise, so free agents read as before', () => {
    expect(modal).toContain('id="pdm-owner"');
    expect(modal).toMatch(/ownerRow\.style\.display = 'none'/);
  });

  it('keeps the "Free Agent" contract fallbacks behind a no-franchise check', () => {
    // Both fallbacks are correct for an unowned player and a flat lie for an
    // owned one; each must stay gated on `ownerBrand`.
    expect(modal).toMatch(/\} else if \(ownerBrand\) \{[\s\S]*?setText\('metric-contract-label', 'Contract'\)/);
    expect(modal).toMatch(/ownerBrand \? '\\u2014' : 'Free Agent'/);
  });

  it('tints with the accent hue, not the band anchor', () => {
    expect(modal).toContain("franchiseTintHue(ownerBrand)");
  });
});

describe('franchiseTintHue', () => {
  const { teams } = buildFranchiseBandBrands('theleague');

  it('names a color for every franchise in every league', () => {
    for (const league of ['theleague', 'afl', 'bb1'] as const) {
      const map = buildFranchiseBandBrands(league);
      for (const [id, brand] of Object.entries(map.teams)) {
        const hue = franchiseTintHue(brand);
        expect(hue, `${league} ${id}`).toMatch(/^#[0-9a-fA-F]{6}$/);
        // A neutral tint is the failure this helper exists to prevent — it is
        // only allowed when the franchise genuinely has no hue at all.
        if (chroma(brand.primary) >= 20 || chroma(brand.secondary) >= 20) {
          expect(chroma(hue), `${league} ${id}`).toBeGreaterThanOrEqual(20);
        }
      }
    }
  });

  it('skips a near-black lead for the accent (Vitside leads with black, wears red)', () => {
    const vitside = teams['0012'];
    expect(chroma(vitside.primary)).toBeLessThan(20);
    expect(franchiseTintHue(vitside)).toBe(vitside.secondary);
  });

  it('keeps the lead when the lead is the color (Pigskins lead with red)', () => {
    const pigskins = teams['0001'];
    expect(chroma(pigskins.primary)).toBeGreaterThanOrEqual(20);
    expect(franchiseTintHue(pigskins)).toBe(pigskins.primary);
  });

  it('re-tests the pair AFTER the band art direction, in both leagues', () => {
    // BAND_ART_DIRECTION overwrites the pair AFTER the automatic hue pick, so
    // a franchise the builder resolved to red can still ship a near-black
    // `primary`. Vitside is that franchise, and it is the same franchise in
    // two leagues under two different ids — a tint reading `primary` is grey
    // in both. (Midwestside is art-directed the same way and is deliberately
    // NOT here: its black is tinted far enough toward its gold to clear the
    // hue test on its own, so its tint is that black, exactly as its band is.)
    for (const [league, id] of [['theleague', '0012'], ['afl', '0009']] as const) {
      const brand = buildFranchiseBandBrands(league).teams[id];
      expect(chroma(brand.primary), `${league} ${id} lead`).toBeLessThan(20);
      expect(franchiseTintHue(brand), `${league} ${id} tint`).toBe(brand.secondary);
    }
  });

  it('is the band map\'s own pick, not a second copy of the threshold', () => {
    for (const brand of Object.values(teams)) {
      expect(franchiseTintHue(brand)).toBe(pickBrandHue(brand.primary, brand.secondary));
    }
  });
});
