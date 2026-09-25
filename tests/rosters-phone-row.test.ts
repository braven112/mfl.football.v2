/**
 * The phone roster card's extra line data (src/utils/rosters/phone-row.ts)
 * and the promise that lets it exist at all: it adds NOTHING to a cell's
 * text, so the desktop parity harness (which fingerprints `td.textContent`)
 * cannot see it.
 *
 * Plus the one piece of the card that lives in the page markup: every sort
 * header the phone hides must still be reachable from the Sort <select>
 * (docs/plans/rosters-mobile-layout.md § 2, "Controls above the rows").
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
    injuryStatus: 'Questionable',
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
    expect(html).toContain('class="rr-ph rr-ph--inj" data-t="Questionable"');
    expect(html).toContain('class="rr-ph rr-ph--kick" data-t="Sun 10:00 AM PT"');
    expect(html).toContain('class="rr-ph rr-ph--opp" data-t="CLE"');
  });

  it('emits nothing for a value that is empty', () => {
    expect(buildPhoneLineSpans({})).toBe('');
  });

  it('escapes what it interpolates into an attribute', () => {
    expect(buildPhoneLineSpans({ injuryStatus: 'Out"><script>' })).not.toContain('"><script>');
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

  it('offers every sort header in the phone Sort select', () => {
    const thead = PAGE.slice(PAGE.indexOf('<thead>'), PAGE.indexOf('</thead>'));
    const select = PAGE.slice(PAGE.indexOf('data-rr-sort-select'), PAGE.indexOf('</select>'));
    const headerKeys = [...thead.matchAll(/data-sort-key="([^"]+)"/g)].map((m) => m[1]);
    expect(headerKeys.length).toBeGreaterThan(8);
    for (const key of headerKeys) {
      expect(select, `sort key "${key}" has no option in the phone Sort select`).toContain(`value="${key}"`);
    }
    // The salary years are generated in both places from SALARY_YEARS.
    expect(thead).toContain('data-sort-key={`salary_${index}`}');
    expect(select).toContain('value={`salary_${index}`}');
  });
});
