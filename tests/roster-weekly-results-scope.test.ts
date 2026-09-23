/**
 * `#weekly-player-results` is scoped to the page that ships it.
 *
 * The island feeds the player modal's Season Results table, and the loader
 * that builds it covers the WHOLE league — ~490 players. The AFL rosters page
 * shipped it whole: 849 KB of a 1.48 MB document, 57% of the page, downloaded
 * and re-parsed on every team switch, to serve a modal that shows ONE player.
 * Scoped to the franchise on screen it is 30 KB, and the page is 659 KB.
 *
 * The reachable set is not a guess. The modal opens only from
 * `[data-player-modal]`, bound to this page's own root, and all three views
 * (roster, planner, analytics) render those for this franchise's roster and
 * nothing else — measured, not assumed. A player outside the set degrades to a
 * hidden Season Results section rather than an error.
 *
 * TheLeague's copy is deliberately NOT scoped this way, and this file pins
 * that too: its page switches team IN PLACE from a payload holding all sixteen
 * rosters, so its reachable set is every club's players rather than the
 * markup's. Scoping it to what the server rendered would blank the Season
 * Results table for every club the viewer switched to.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
const AFL = read('src/pages/afl-fantasy/rosters.astro');
const TL = read('src/pages/theleague/rosters.astro');

describe('the AFL rosters page ships only its own players’ weekly results', () => {
  it('filters the league-wide payload down to the rendered roster', () => {
    expect(AFL, 'the loader still supplies the whole league')
      .toMatch(/const weeklyPlayerResultsAll = /);
    // The filter keys on `roster`, which IS the rendered set.
    expect(AFL).toMatch(/for \(const entry of roster\) \{[\s\S]{0,400}weeklyPlayerResults\[entry\.id\] = weeks;/);
  });

  it('never emits the unfiltered payload into the island', () => {
    const island = AFL.slice(AFL.indexOf('id="weekly-player-results"'));
    const tag = island.slice(0, island.indexOf('</script>'));
    expect(tag, 'the island must carry the SCOPED object').toContain('JSON.stringify(weeklyPlayerResults)');
    expect(tag, 'shipping the league-wide payload is the 849 KB regression')
      .not.toContain('weeklyPlayerResultsAll');
  });

  it('copies rather than trimming the loader’s cached payload', () => {
    // loadWeeklyPlayerResults caches per league-season, so mutating what it
    // returns would trim it for every later render in the same process.
    expect(AFL).not.toMatch(/delete weeklyPlayerResultsAll\[/);
    expect(AFL).toMatch(/const weeklyPlayerResults: typeof weeklyPlayerResultsAll = \{\};/);
  });
});

describe('TheLeague’s copy stays league-wide, because its page switches in place', () => {
  it('does not filter by the rendered franchise', () => {
    const island = TL.slice(TL.indexOf('id="weekly-player-results"'));
    const tag = island.slice(0, island.indexOf('</script>'));
    expect(tag).toContain('JSON.stringify(weeklyPlayerResults)');
    // If someone ever scopes this one, the switcher below must stop switching
    // in place first — otherwise the modal goes blank on every club but the
    // one the server rendered.
    expect(TL, 'the in-place switcher is what makes the wide payload necessary')
      .toContain('const applyRosterHeader = (teamId: string) => {');
  });
});
