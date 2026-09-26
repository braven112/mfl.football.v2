/**
 * The phone roster card's extra line data (src/utils/rosters/phone-row.ts)
 * and the promise that lets it exist at all: it adds NOTHING to a cell's
 * text, so the desktop parity harness (which fingerprints `td.textContent`)
 * cannot see it.
 *
 * Plus the controls above the rows (idea B, user 2026-09-26): every sort
 * header the phone hides is reachable from a chip of its OWN mode, the chip set
 * is derived from the thead rather than kept by hand, and the chip row never
 * widens the page (docs/plans/rosters-mobile-layout.md § 2, "Controls above
 * the rows").
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildPhoneLineSpans,
  contractThruLabel,
  designationLabel,
  formatKickoffCompact,
  phonePosKey,
} from '../src/utils/rosters/phone-row';
import {
  buildSortChips,
  headerMode,
  keepValidSort,
  nextSort,
  renderSortChips,
  type SortHeader,
} from '../src/utils/rosters/phone-sort';

describe('phonePosKey', () => {
  it('maps every roster position to its pill colour key', () => {
    expect(phonePosKey('QB')).toBe('QB');
    expect(phonePosKey('rb')).toBe('RB');
    expect(phonePosKey('Def')).toBe('DEF');
    expect(phonePosKey('K')).toBe('PK');
    expect(phonePosKey('PK')).toBe('PK');
  });

  it('answers "no colour" for anything else, so the page keeps the plain text', () => {
    expect(phonePosKey('LB')).toBe('');
    expect(phonePosKey(undefined)).toBe('');
  });
});

describe('contractThruLabel', () => {
  it('names the last contract year, counted from the league year', () => {
    expect(contractThruLabel(3, 2026)).toBe("thru '28");
    expect(contractThruLabel('1', '2026')).toBe("thru '26");
    expect(contractThruLabel(5, 2006)).toBe("thru '10");
  });

  it('prints nothing for an expired or unknown contract', () => {
    expect(contractThruLabel(0, 2026)).toBe('');
    expect(contractThruLabel(null, 2026)).toBe('');
    expect(contractThruLabel(2, undefined)).toBe('');
  });
});

describe('designationLabel', () => {
  it('keeps a real designation and drops a standard contract', () => {
    expect(designationLabel('RC')).toBe('RC');
    expect(designationLabel('to')).toBe('TO');
    expect(designationLabel('')).toBe('');
    expect(designationLabel('Standard')).toBe('');
  });
});

describe('formatKickoffCompact', () => {
  // Sunday 2026-09-27 17:00 UTC = 10:00 AM Pacific, 1:00 PM Eastern.
  const sundayOnePmEt = '2026-09-27T17:00:00Z';

  it('prints the weekday, time and the zone label, in the zone it is given', () => {
    expect(formatKickoffCompact(sundayOnePmEt, 'America/Los_Angeles', 'PT')).toBe('Sun 10:00 AM PT');
    expect(formatKickoffCompact(sundayOnePmEt, 'America/New_York', 'ET')).toBe('Sun 1:00 PM ET');
  });

  it('never carries ICU’s narrow no-break space into the DOM', () => {
    expect(formatKickoffCompact(sundayOnePmEt, 'America/Los_Angeles', 'PT')).not.toMatch(/ /);
  });

  it('prints nothing for a bye (no instant) or a bad value', () => {
    expect(formatKickoffCompact(null, 'America/Los_Angeles', 'PT')).toBe('');
    expect(formatKickoffCompact('not a date', 'America/Los_Angeles', 'PT')).toBe('');
    expect(formatKickoffCompact(sundayOnePmEt, 'Not/AZone', 'PT')).toBe('');
  });
});

describe('buildPhoneLineSpans', () => {
  const html = buildPhoneLineSpans({
    contractYears: 3,
    firstYear: 2026,
    contractInfo: 'RC',
    kickoffIso: '2026-09-27T17:00:00Z',
    kickoffZone: 'America/Los_Angeles',
    kickoffLabel: 'PT',
    opponent: 'cle',
  });

  it('adds no text at all — the desktop parity harness reads td.textContent', () => {
    // Everything the card prints rides in an attribute; strip the tags and
    // nothing is left.
    expect(html.replace(/<[^>]*>/g, '')).toBe('');
  });

  it('carries each value in its own kind of span', () => {
    expect(html).toContain(`class="rr-ph rr-ph--thru" data-t="thru '28"`);
    expect(html).toContain('class="rr-ph rr-ph--desig" data-t="RC"');
    expect(html).toContain('class="rr-ph rr-ph--kick" data-t="Sun 10:00 AM PT"');
    expect(html).toContain('class="rr-ph rr-ph--opp" data-t="CLE"');
  });

  it('emits only the line-1 break for a row with no values', () => {
    expect(buildPhoneLineSpans({})).toBe('<span class="rr-ph rr-ph--br" aria-hidden="true"></span>');
  });

  it('never spells out the injury status — the (Q) / (D) button after the name carries it', () => {
    // The input has no injury field at all; an extra property is ignored.
    const withInjury = buildPhoneLineSpans({ injuryStatus: 'Questionable' } as never);
    expect(withInjury).not.toContain('Questionable');
    expect(withInjury).not.toContain('rr-ph--inj');
  });

  it('escapes what it interpolates into an attribute', () => {
    expect(buildPhoneLineSpans({ opponent: 'x"><script>' })).not.toContain('"><script>');
  });
});

describe('the rosters page wires the card into BOTH row builders', () => {
  const PAGE = fs.readFileSync(
    path.join(process.cwd(), 'src/pages/theleague/rosters.astro'),
    'utf8',
  );

  it('calls buildPhoneLineSpans and phonePosKey in the SSR loop and in renderTableRows', () => {
    // A mismatch between the two shows as a layout jump on the first
    // client re-render (the harness only sees desktop).
    expect(PAGE.match(/buildPhoneLineSpans\(\{/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(PAGE).toContain('data-pos={phonePosKey(player.position)}');
    expect(PAGE).toContain('data-pos="${phonePosKey(phoneRow.position)}"');
  });

  it('opens the player from anywhere in the row on a phone', () => {
    expect(PAGE).toMatch(/initPlayerModalTrigger\(rosterTbody, \{[^}]*?rowTapMedia: '\(max-width: 767px\)'/);
  });

});

/**
 * The thead, read the way the page script reads it: every `th` with a
 * `data-sort-key`, its mode from the classes setMode() toggles, its text. The
 * salary columns are one templated `th` over SALARY_YEARS, expanded here.
 */
function theadSortHeaders(page: string): SortHeader[] {
  const thead = page.slice(page.indexOf('<thead>'), page.indexOf('</thead>'));
  const out: SortHeader[] = [];
  for (const m of thead.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)) {
    const attrs = m[1];
    const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? '';
    const classList = { contains: (c: string) => cls.split(/\s+/).includes(c) };
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').trim();
    const literal = /data-sort-key="([^"]+)"/.exec(attrs)?.[1];
    if (literal) out.push({ key: literal, mode: headerMode(classList), text });
    if (attrs.includes('data-sort-key={`salary_${index}`}')) {
      for (let i = 0; i < 5; i++) out.push({ key: `salary_${i}`, mode: headerMode(classList), text: String(2026 + i) });
    }
  }
  return out;
}

describe('the phone sort chips (idea B)', () => {
  const PAGE = fs.readFileSync(path.join(process.cwd(), 'src/pages/theleague/rosters.astro'), 'utf8');
  const CSS = fs.readFileSync(path.join(process.cwd(), 'src/styles/rosters-mobile.css'), 'utf8');
  const headers = theadSortHeaders(PAGE);
  const gm = buildSortChips(headers, 'gm').map((c) => c.key);
  const coach = buildSortChips(headers, 'coach').map((c) => c.key);

  it('reads a real thead', () => {
    expect(headers.length).toBeGreaterThan(12);
    expect(headers.find((h) => h.key === 'salary_0')?.mode).toBe('gm');
    expect(headers.find((h) => h.key === 'projectedPoints')?.mode).toBe('coach');
    expect(headers.find((h) => h.key === 'position')?.mode).toBe('both');
  });

  it('every sortable header has a chip in its own mode, and only there', () => {
    for (const h of headers) {
      if (h.mode !== 'coach') expect(gm, `${h.key} missing from the GM chips`).toContain(h.key);
      if (h.mode !== 'gm') expect(coach, `${h.key} missing from the Coach chips`).toContain(h.key);
      if (h.mode === 'gm') expect(coach).not.toContain(h.key);
      if (h.mode === 'coach') expect(gm).not.toContain(h.key);
    }
  });

  it('leads with the mockup’s order: GM Pos · Salary · Years · My Rank; Coach Proj · Opp rank · Avg … Pos', () => {
    expect(gm.slice(0, 4)).toEqual(['position', 'salary_0', 'contractYears', 'topRanking']);
    expect(coach.slice(0, 3)).toEqual(['projectedPoints', 'oppRank', 'avgSeason']);
    expect(coach[coach.length - 1]).toBe('position');
    const labels = buildSortChips(headers, 'gm').map((c) => c.label);
    expect(labels.slice(0, 4)).toEqual(['Pos', 'Salary', 'Years', 'My Rank']);
    expect(labels).toContain('2027 salary');
  });

  it('drops My Rank while the owner has no board', () => {
    const noBoard = headers.map((h) => (h.key === 'topRanking' ? { ...h, available: false } : h));
    expect(buildSortChips(noBoard, 'gm').map((c) => c.key)).not.toContain('topRanking');
  });

  it('a header added to the thead gets a chip with no other change', () => {
    const more = [...headers, { key: 'byeWeek', mode: 'coach' as const, text: 'Bye' }];
    expect(buildSortChips(more, 'coach')).toContainEqual({ key: 'byeWeek', label: 'Bye' });
  });

  it('the page derives the chips from the thead — no hand-kept list, no <select>', () => {
    expect(PAGE).toContain("thead th[data-sort-key]");
    expect(PAGE).toContain('buildSortChips(readSortHeaders(), phoneSortMode())');
    expect(PAGE).not.toContain('data-rr-sort-select');
    expect(PAGE).not.toContain('data-rr-sort-dir');
    // The markup ships an empty group; only the renderer writes chips.
    expect(PAGE).toMatch(/<div class="rr-chips" data-rr-sort>\s*<div class="rr-chips__row" role="group" aria-label="Sort the roster by" data-rr-chips><\/div>/);
  });

  it('a chip tap IS a header click, and the header uses the shared nextSort rule', () => {
    expect(PAGE).toMatch(/th\[data-sortable\]\[data-sort-key="\$\{CSS\.escape\(key\)\}"\]`\)\s*\?\.click\(\)/);
    expect(PAGE).toContain('const next = nextSort(sortKey,');
    // A mode switch swaps the set.
    expect(PAGE).toMatch(/setMode\(mode\) \{[\s\S]*?syncPhoneSortChipsForMode\(mode\);/);
  });

  it('nextSort: Pos resets, the active key flips, My Rank starts ascending', () => {
    expect(nextSort('position', { key: 'salary_0', dir: 'desc' })).toEqual({ key: 'position', dir: 'asc' });
    expect(nextSort('salary_0', { key: 'position', dir: 'asc' })).toEqual({ key: 'salary_0', dir: 'desc' });
    expect(nextSort('salary_0', { key: 'salary_0', dir: 'desc' })).toEqual({ key: 'salary_0', dir: 'asc' });
    expect(nextSort('topRanking', { key: 'position', dir: 'asc' })).toEqual({ key: 'topRanking', dir: 'asc' });
  });

  it('a mode switch keeps a sort only if its chip is still offered', () => {
    const coachChips = buildSortChips(headers, 'coach');
    expect(keepValidSort({ key: 'salary_0', dir: 'desc' }, coachChips)).toEqual({ key: 'position', dir: 'asc' });
    expect(keepValidSort({ key: 'projectedPoints', dir: 'asc' }, coachChips)).toEqual({ key: 'projectedPoints', dir: 'asc' });
  });

  it('chips are toggle buttons; the active one shows and SAYS its direction', () => {
    const html = renderSortChips(buildSortChips(headers, 'gm'), { key: 'salary_0', dir: 'desc' });
    expect(html).toContain('data-rr-chip="salary_0" aria-pressed="true"><span class="rr-chip__label">Salary</span><span class="rr-chip__dir" aria-hidden="true">↓</span><span class="rr-chip__sr">, sorted descending</span>');
    expect(html).toContain('data-rr-chip="position" aria-pressed="false"');
    // The default sort has no direction to flip.
    expect(renderSortChips([{ key: 'position', label: 'Pos' }], { key: 'position', dir: 'asc' })).not.toContain('rr-chip__dir');
    expect(renderSortChips([{ key: 'x"><b>', label: '<i>' }], { key: 'position', dir: 'asc' })).not.toMatch(/<b>|<i>/);
  });

  it('the chip row scrolls within itself and cannot widen the page', () => {
    const rule = (sel: string) => {
      const at = CSS.indexOf(`${sel} {`);
      expect(at, `${sel} has no rule`).toBeGreaterThan(-1);
      return CSS.slice(at, CSS.indexOf('}', at));
    };
    expect(rule('.rr-chips__row')).toMatch(/overflow-x:\s*auto;/);
    expect(rule(".roster-page[data-league='theleague'] .rr-chips")).toMatch(/min-width:\s*0;/);
    expect(rule(".roster-page[data-league='theleague'] .rr-chips")).toMatch(/flex:\s*1 1 100%;/);
    expect(rule('.rr-chip')).toMatch(/flex:\s*0 0 auto;/);
    expect(rule('.rr-chip')).toMatch(/min-height:\s*44px;/);
    // Hidden on desktop: the headers are the control there.
    expect(CSS).toMatch(/^\.rsim-bar,\s*\.rr-chips,\s*\.rr-ph \{\s*display: none;/m);
  });

  it('My Rank is an icon on a phone, named for what it opens', () => {
    expect(PAGE).toContain('<MyRankEditor league="theleague" accessibleName="My Rank sources" />');
    const editor = fs.readFileSync(path.join(process.cwd(), 'src/components/shared/rankings/MyRankEditor.astro'), 'utf8');
    expect(editor).toContain('aria-label={accessibleName}');
    expect(editor).toContain('<span class="mre-trigger__label">{label}</span>');
  });
});

/**
 * The card's layout decisions (user, 2026-09-26), pinned on the stylesheet
 * itself — the parity harness only sees desktop, and these are phone-only.
 */
describe('the phone card layout (rosters-mobile.css)', () => {
  const CSS = fs.readFileSync(path.join(process.cwd(), 'src/styles/rosters-mobile.css'), 'utf8');
  /**
   * The declarations of every rule with a selector that ENDS in `needle`
   * (so `.player-meta` does not also collect `.player-meta__logo`).
   */
  const rulesFor = (needle: string) =>
    [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => m[1].split(',').some((sel) => sel.trim().endsWith(needle)))
      .map((m) => m[2])
      .join('\n');

  it('leaves the NFL logo in PlayerCell’s meta line, first on line 2 — never moved onto the avatar', () => {
    const logo = rulesFor('#rosterTableBody .player-meta__logo');
    expect(logo).toMatch(/order:\s*21;/);
    expect(logo).not.toMatch(/position:\s*absolute/);
    expect(logo).not.toMatch(/\b(top|left):/);
    // The meta row dissolves so the logo and the pill can part ways.
    expect(rulesFor('#rosterTableBody .player-meta')).toMatch(/display:\s*contents/);
  });

  it('puts the position pill under the headshot, centred on it', () => {
    const pos = rulesFor('#rosterTableBody .player-meta__pos');
    expect(pos).toMatch(/position:\s*absolute/);
    expect(pos).toMatch(/top:\s*calc\(0\.625rem \+ var\(--rr-avatar\)/);
    expect(pos).toMatch(/left:\s*calc\(0\.625rem \+ var\(--rr-avatar\) \/ 2\)/);
    // The card is tall enough for the avatar plus the pill.
    expect(rulesFor('#rosterTableBody > tr.roster-row')).toMatch(/min-height:\s*calc\(var\(--rr-avatar\) \+ var\(--rr-pill\)/);
  });

  it('has no rule for a spelled-out injury word', () => {
    expect(CSS).not.toContain('rr-ph--inj');
  });

  it('reserves no fixed right column on line 1, so a trade-block tag stays beside a name that fits', () => {
    expect(CSS).not.toContain('--rr-right');
    expect(rulesFor('#rosterTableBody .player-cell__name')).toMatch(/flex:\s*1 1 0;/);
    const br = rulesFor('.rr-ph.rr-ph--br');
    expect(br).toMatch(/order:\s*12;/);
    expect(br).toMatch(/flex:\s*0 0 100%/);
  });

  it('splits the (Q) and trade-block hit areas where they sit side by side', () => {
    expect(rulesFor('.injury-indicator:has(+ .trade-bait-link)::after')).toMatch(/right:\s*-2px/);
    expect(rulesFor('.injury-indicator + .trade-bait-link::after')).toMatch(/left:\s*-2px/);
  });
});

describe('the cap card is one button into Cap by year', () => {
  const CARD = fs.readFileSync(path.join(process.cwd(), 'src/components/theleague/RosterCapStrip.astro'), 'utf8');
  const markup = CARD.slice(CARD.lastIndexOf('---') + 3);

  it('is a single <button> that opens the review sheet, named by its own visible text', () => {
    expect(markup.match(/<button\b/g)).toHaveLength(1);
    expect(markup).toMatch(/<button\s+type="button"\s+class="rcap"[^>]*data-rsim-open/);
    expect(markup).toContain('aria-labelledby="rcapTitle rcapSpace rcapHint"');
    for (const id of ['rcapTitle', 'rcapSpace', 'rcapHint']) expect(markup).toContain(`id="${id}"`);
  });

  it('holds only phrasing content (no heading, list or link inside a button)', () => {
    expect(markup).not.toMatch(/<(h[1-6]|ul|ol|li|a|div|section)\b/);
  });

  it('keeps the cap space, the bar and the legend; the chips are gone', () => {
    expect(markup).toContain('data-rcap-space');
    expect(markup).toContain('data-rcap-bar');
    for (const key of ['Active', 'Practice', 'IR', 'Dead', 'Sims']) expect(markup).toContain(`>${key}</span>`);
    expect(markup).not.toMatch(/rcap__chip|data-rcap-trade|data-rcap-tags|Dead \$/);
  });

  it('has a visible focus ring and a real target size', () => {
    const CSS = fs.readFileSync(path.join(process.cwd(), 'src/styles/rosters-mobile.css'), 'utf8');
    expect(CSS).toMatch(/\.rcap:focus-visible\s*\{[^}]*outline:\s*2px solid/);
  });
});

describe('the pill centres on the headshot', () => {
  it('sizes the phone avatar border-box, so --rr-avatar / 2 is its true centre', () => {
    const CSS = fs.readFileSync(path.join(process.cwd(), 'src/styles/rosters-mobile.css'), 'utf8');
    const rule = CSS.match(/#rosterTableBody \.player-cell__avatar \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/box-sizing:\s*border-box/);
    expect(rule).toMatch(/width:\s*var\(--rr-avatar\)/);
  });
});

describe('the roster header week tiles on a phone', () => {
  const BAR = fs.readFileSync(
    path.join(process.cwd(), 'src/components/shared/roster-header/GamedayBar.astro'),
    'utf8',
  );

  it('start collapsed behind a toggle beside the Full schedule link', () => {
    expect(BAR).toMatch(/data-weeks=\{railMarks\.length > 0 \? 'collapsed' : undefined\}/);
    expect(BAR).toMatch(/<button type="button" class="rhdr-rail__weeks" data-rhdr-weeks-toggle aria-expanded="false">/);
  });

  it('collapse only below 768px; wider screens always show both tiles', () => {
    const phone = BAR.match(/@media \(max-width: 767px\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(phone).toMatch(/\.rhdr-bar\[data-weeks='collapsed'\] > \.rhdr-tile \{ display: none; \}/);
    expect(BAR).toMatch(/\.rhdr-rail__weeks \{ display: none; \}/);
    const outside = BAR.replace(phone, '');
    expect(outside).not.toMatch(/data-weeks='collapsed'\][^{]*\{[^}]*display:\s*none/);
  });

  it('toggles through one delegated listener that keeps aria-expanded in step', () => {
    expect(BAR).toMatch(/closest\?\.\('\[data-rhdr-weeks-toggle\]'\)/);
    expect(BAR).toMatch(/toggle\.setAttribute\('aria-expanded', String\(expand\)\)/);
  });
});
