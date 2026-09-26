/**
 * The roster header's conference row: ONE conference open at a time, each one
 * wearing its own colour, and still no client script.
 *
 * Two bugs, one row:
 *
 * 1. The AFL's twenty-four crests plus six division labels do not fit a
 *    desktop column, so the row scrolled sideways and the last division was
 *    simply off the screen — on the widest viewport the site has. Collapsing
 *    the other conference to its rail is what makes the row fit, and it is
 *    done with a radio per conference and `:has()` rather than a script,
 *    because this component ships no JavaScript (see
 *    tests/rosters-team-nav-clientrouter.test.ts) and radios are what enforce
 *    "exactly one open" without any.
 *
 * 2. Both rails were `--content-text-muted`, which is chrome. Two grey bands
 *    on either side of a row left the rotated two-letter code as the only
 *    thing telling the reader which half of the league they were looking at.
 *    The rail now carries the conference's own colour, sampled from its MARK
 *    (`getConferenceColor`) so the rail and the logo above it cannot drift.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getConferenceColor, getConferenceLogo } from '../src/utils/afl-conference';
import { buildTeamGroups } from '../src/utils/roster-header-data';
import { contrastRatio, AA_LARGE_TEXT_RATIO } from '../src/utils/team-color-contrast';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');

const TEAM_ROW = read('src/components/shared/roster-header/TeamDivisionRow.astro');

/** The component's `<style>` block with comments stripped — the prose in there
 *  quotes the code it replaced, so an unstripped scan matches its own note. */
const STYLE = TEAM_ROW.slice(TEAM_ROW.indexOf('<style>')).replace(/\/\*[\s\S]*?\*\//g, '');

const AFL_CONFERENCES = [
  { name: 'American League', code: '00', divisions: ['AL North', 'AL South'] },
  { name: 'National League', code: '01', divisions: ['NL North', 'NL South'] },
];

const aflTeam = (franchiseId: string, conference: string, division: string) => ({
  franchiseId,
  name: `Club ${franchiseId}`,
  nameShort: `C${franchiseId}`,
  conference,
  division,
  colorPrimary: '#181818',
});

describe('the rail carries the conference, not chrome', () => {
  it('takes its colour from the conference MARK, so the two cannot drift', () => {
    // Not a configured value: the hue is asserted to be IN the logo the row
    // renders above it. A palette edit that changes one without the other
    // fails here rather than shipping a red rail over a blue crest.
    for (const id of ['00', '01'] as const) {
      const svg = read(`public${getConferenceLogo(id)}`).toLowerCase();
      expect(svg, `${getConferenceLogo(id)} must carry ${getConferenceColor(id)}`)
        .toContain(getConferenceColor(id).toLowerCase());
    }
  });

  it('picks the hue that DISTINGUISHES the two marks, not one they share', () => {
    // Both marks carry the same navy and the same silver, which is exactly why
    // neither can stand for a conference: a rail in a shared colour says
    // "AFL", not "AL" or "NL".
    const hexes = (id: '00' | '01') =>
      new Set((read(`public${getConferenceLogo(id)}`).toLowerCase().match(/#[0-9a-f]{6}/g) ?? []));
    const al = hexes('00');
    const nl = hexes('01');
    expect(getConferenceColor('00')).not.toBe(getConferenceColor('01'));
    expect(nl.has(getConferenceColor('00').toLowerCase()), 'AL red must not appear in the NL mark')
      .toBe(false);
    expect(al.has(getConferenceColor('01').toLowerCase()), 'NL blue must not appear in the AL mark')
      .toBe(false);
  });

  it('clears white ink at AA large text — the rail is a label, not a stripe', () => {
    for (const id of ['00', '01'] as const) {
      expect(contrastRatio(getConferenceColor(id), '#ffffff')).toBeGreaterThanOrEqual(
        AA_LARGE_TEXT_RATIO,
      );
    }
  });

  it('reaches the row as `conferenceColor` on each group, AL red and NL blue', () => {
    const groups = buildTeamGroups({
      teams: [aflTeam('0001', '00', 'AL North'), aflTeam('0013', '01', 'NL North')],
      conferences: AFL_CONFERENCES,
    });
    expect(groups.map((group) => group.conferenceColor)).toEqual([
      getConferenceColor('00'),
      getConferenceColor('01'),
    ]);
  });

  it('is null in a single-table league, which has no rail to colour', () => {
    const groups = buildTeamGroups({
      teams: [aflTeam('0001', '', 'Northwest')],
      conferences: null,
      divisions: ['Northwest'],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].conferenceColor).toBeNull();
  });

  it('paints the rail from that value rather than hardcoding a hue', () => {
    expect(TEAM_ROW, 'the group supplies the colour; the component only forwards it')
      .toMatch(/--rhdr-conf:\s*\$\{group\.conferenceColor\}/);
    expect(STYLE).toMatch(/background:\s*var\(--rhdr-conf,/);
    // Grey survives only as the fallback for a league whose conference the
    // colour helper does not know; it must not be the value itself.
    expect(STYLE, 'a grey rail is the bug this row was fixed for')
      .not.toMatch(/background:\s*var\(--content-text-muted\)/);
    expect(STYLE.match(/#[0-9a-f]{6}/gi) ?? [], 'no conference hue inlined in the stylesheet')
      .not.toContain(getConferenceColor('00'));
  });
});

describe('one conference at a time, with no client script', () => {
  it('collapses the other conference with radios, not JavaScript', () => {
    expect(TEAM_ROW, 'a scriptless row cannot go dead after a ClientRouter swap')
      .not.toMatch(/<script/);
    expect(TEAM_ROW, 'one radio per conference is what enforces "exactly one open"')
      .toMatch(/type="radio"[\s\S]*?name=\{radioName\}/);
    // Rendered ONLY where there is more than one conference: TheLeague's
    // single table must keep its divisions visible.
    expect(TEAM_ROW).toMatch(/\{showConferences && groups\.map/);
    expect(TEAM_ROW).toMatch(/const showConferences = groups\.length > 1;/);
  });

  it('hides the divisions only in a row that HAS radios', () => {
    // Scoped through `:has()` rather than a class the server guessed, so a
    // single-table league — which renders no radios — never hides anything.
    expect(STYLE).toMatch(
      /\.rhdr-teams:has\(\.rhdr-teams__radio\)\s*\.rhdr-teams__divisions\s*\{\s*display:\s*none;/,
    );
    expect(STYLE, 'an unscoped rule would blank TheLeague’s switcher entirely')
      .not.toMatch(/^\s*\.rhdr-teams__divisions\s*\{[^}]*display:\s*none/m);
    expect(STYLE, 'the checked conference re-shows its divisions').toMatch(
      /:checked\s*~\s*\.rhdr-teams__conf:nth-of-type\(1\)\s*\.rhdr-teams__divisions/,
    );
  });

  it('gives a collapsed conference its rail width and nothing more', () => {
    // `flex: 1 0 auto` on both left a dead band between the two rails, because
    // the collapsed one kept its share of the row while showing nothing.
    expect(STYLE).toMatch(/\.rhdr-teams:has\(\.rhdr-teams__radio\)\s*\.rhdr-teams__conf\s*\{\s*flex:\s*none;/);
    expect(STYLE).toMatch(/:checked\s*~\s*\.rhdr-teams__conf:nth-of-type\(2\)\s*\{\s*\n?\s*flex:\s*1 0 auto;/);
  });

  it('opens exactly one, and it is the viewer’s own', () => {
    // `groups` arrives in the viewer's order (`conferenceOrder`), so the first
    // group IS theirs — which is why the open index is a constant rather than
    // a second resolution of the same fact.
    expect(TEAM_ROW).toMatch(/checked=\{index === openIndex\}/);
    expect(TEAM_ROW).toMatch(/const openIndex = 0;/);
  });

  it('keeps the radios reachable by keyboard', () => {
    // Visually hidden, never `display: none` — that drops them from the tab
    // order and makes the rails unreachable without a mouse.
    const radio = STYLE.slice(STYLE.indexOf('.rhdr-teams__radio {'));
    const block = radio.slice(0, radio.indexOf('}'));
    expect(block).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(block).not.toMatch(/display:\s*none/);
    expect(STYLE, 'the focused radio must show on its rail, which is the visible control')
      .toMatch(/\.rhdr-teams__radio:focus-visible/);
  });

  it('labels each rail so the radio has a name and a hit target', () => {
    expect(TEAM_ROW).toMatch(/for=\{`\$\{radioName\}-\$\{index\}`\}/);
    expect(TEAM_ROW).toMatch(/aria-label=\{`Show \$\{group\.conferenceName\}`\}/);
  });

  it('names the radio group per render, so two headers cannot share one', () => {
    expect(TEAM_ROW).toMatch(/const radioName = `rhdr-conf-\$\{Math\.random\(\)/);
  });
});

describe('the plate says what the page IS, per league', () => {
  const AFL_PAGE = read('src/components/afl-family/RostersPage.astro');
  const TL_PAGE = read('src/pages/theleague/rosters.astro');
  const NAMEPLATE = read('src/components/shared/roster-header/RosterNameplate.astro');

  it('does not advertise keepers on the AFL roster page', () => {
    // The AFL's keepers have their OWN page (/afl-fantasy/keepers, plus the
    // Keeper Report Card), so a pill reading "Roster & Keepers" pointed at a
    // page that does not hold them. TheLeague's "Roster & Cap" is the shape
    // to copy: name the second thing only where this page IS it.
    const label = AFL_PAGE.match(/^\s*label="([^"]+)"/m)?.[1];
    expect(label, 'the AFL header needs a label').toBeTruthy();
    expect(label, 'keepers live on /afl-fantasy/keepers, not here').not.toMatch(/keeper/i);
    expect(TL_PAGE).toMatch(/^\s*label="Roster & Cap"/m);
  });

  it('centres the background crest where the featured card is gone', () => {
    // The right-hand anchor exists to sit the mark behind the featured player
    // card. That card is hidden below 900px, so the same offset parked a
    // half-cropped crest on the right edge; both rules move together or the
    // band is lopsided at the width most owners read it on.
    const style = NAMEPLATE.slice(NAMEPLATE.indexOf('<style>')).replace(/\/\*[\s\S]*?\*\//g, '');
    const mobile = style.match(/@media \(max-width: 900px\) \{[\s\S]*?\n  \}/g) ?? [];
    const watermark = mobile.find((block) => block.includes('.rhdr__watermark'));
    expect(watermark, 'the watermark needs a rule at the width the card disappears').toBeTruthy();
    expect(watermark).toMatch(/left:\s*50%/);
    expect(watermark, 'the desktop rule sets `right`; leaving it stretches the mark')
      .toMatch(/right:\s*auto/);
    expect(watermark).toMatch(/transform:\s*translate\(-50%,\s*-50%\)/);
    expect(mobile.some((block) => block.includes('.rhdr__feature')), 'the featured card hides at this same width')
      .toBe(true);
  });
});
