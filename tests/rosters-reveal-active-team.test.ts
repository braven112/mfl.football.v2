/**
 * The roster header's team switcher scrolls the VIEWED club's crest into view
 * on a phone (src/utils/rosters/reveal-active-team.ts), and only when it is
 * not already visible — a crest the owner just tapped must not slide away.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { revealScrollDelta } from '../src/utils/rosters/reveal-active-team';

const scroller = { left: 0, right: 400 };

describe('revealScrollDelta', () => {
  it('leaves a fully visible crest alone', () => {
    expect(revealScrollDelta({ left: 100, right: 134 }, scroller)).toBe(0);
  });

  it('centres a crest past the right edge', () => {
    expect(revealScrollDelta({ left: 700, right: 734 }, scroller)).toBe(517);
  });

  it('centres a crest cut off at the left edge', () => {
    expect(revealScrollDelta({ left: -20, right: 14 }, scroller)).toBe(-203);
  });

  it('treats a crest touching the edge as hidden (the ring sits outside it)', () => {
    expect(revealScrollDelta({ left: 370, right: 400 }, scroller)).not.toBe(0);
  });
});

describe('both roster pages call it on every page load', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');

  it('the shared page, inside its per-page-load init', () => {
    const page = read('src/components/shared/rosters/RostersPage.astro');
    const init = page.slice(page.indexOf('function initAflRosterPage()'));
    expect(init).toMatch(/revealActiveTeamCrest\(pageRoot\);/);
  });

  it('TheLeague, wherever the header follows the viewed club', () => {
    const page = read('src/pages/theleague/rosters.astro');
    expect(page).toMatch(/applyRosterHeader\(currentTeam\);[\s\S]{0,300}revealActiveTeamCrest\(rosterHeader\);/);
  });
});
