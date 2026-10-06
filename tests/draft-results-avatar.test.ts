import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The Draft Results player avatar used to be a bare <img src={p.headshot}>.
// A player with no ESPN id resolves to an MFL photo URL that 404s once he
// retires, and a defense has no photo at all — so every pre-2011 board
// rendered broken-image icons, including the Patriots' DEF row.
const src = readFileSync('src/components/shared/draft-results/DraftResultsPage.astro', 'utf8');

describe('Draft Results avatars', () => {
  it('every avatar img carries an onerror fallback', () => {
    const imgs = src.match(/<img[\s\S]*?\/>/g) ?? [];
    const avatars = imgs.filter((tag) => tag.includes('dr__headshot'));
    expect(avatars.length).toBeGreaterThan(0);
    for (const tag of avatars) expect(tag).toMatch(/onerror=/);
  });

  it('a defense is drawn with its club logo, not a player photo', () => {
    expect(src).toMatch(/p\.position === 'DEF' \? nflLogoUrl\(p\.nflTeam\)/);
  });
});
