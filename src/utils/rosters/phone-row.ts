/**
 * The phone roster row's extra line data (docs/plans/rosters-mobile-layout.md
 * § 2-3).
 *
 * Below 768px `src/styles/rosters-mobile.css` turns each roster `<tr>` into a
 * three-line card built from the row's EXISTING cells. The few things a card
 * shows that no cell carries — "thru '28", the contract designation, the
 * injury word, the kickoff time and the opponent's abbreviation — ride on
 * EMPTY spans emitted here, and the stylesheet prints them from a data
 * attribute with `::before`.
 *
 * Why empty spans and not text: `scripts/roster-parity-check.mjs` fingerprints
 * every cell's `textContent` and every `<img src>` at desktop width, and the
 * rule for every phase of this work is 0 diffs there. A span holding text
 * would add that text to the player cell on desktop even while hidden. An
 * attribute adds nothing to `textContent`, so the desktop fingerprint cannot
 * move, and the phone still reads the value (generated content is announced
 * by screen readers).
 *
 * BOTH row builders call `buildPhoneLineSpans`: the SSR loop in
 * `rosters.astro` (via `set:html`) and the client `renderTableRows`. One
 * function is what keeps the two from drifting, which would otherwise show as
 * a layout jump on the first client re-render.
 */

import { escapeHtml } from '../player-cell-html';

/** The position keys the pill has a colour for. Anything else gets the neutral pill. */
export type PhonePosKey = 'QB' | 'RB' | 'WR' | 'TE' | 'PK' | 'DEF' | '';

/**
 * Normalise a roster position to its pill colour key. MFL says `Def` in some
 * feeds and `DEF` in others, and a kicker can arrive as `K`.
 */
export function phonePosKey(position: string | null | undefined): PhonePosKey {
  const p = String(position ?? '').trim().toUpperCase();
  if (p === 'QB' || p === 'RB' || p === 'WR' || p === 'TE' || p === 'PK' || p === 'DEF') return p;
  if (p === 'K') return 'PK';
  if (p === 'D/ST' || p === 'DST') return 'DEF';
  return '';
}

/**
 * "thru '28" for a contract with `years` left, counted from the first salary
 * year shown (the league year). Empty for an expiring-to-nothing or unknown
 * contract, where the years chip already says 0.
 */
export function contractThruLabel(years: number | string | null | undefined, firstYear: number | string | null | undefined): string {
  const y = Number.parseInt(String(years ?? ''), 10);
  const first = Number.parseInt(String(firstYear ?? ''), 10);
  if (!Number.isFinite(y) || y <= 0 || !Number.isFinite(first)) return '';
  const last = first + y - 1;
  return `thru '${String(last % 100).padStart(2, '0')}`;
}

/**
 * The contract designation worth printing (RC, TO, …). A standard contract
 * carries no code, and printing "Standard" on 20 of 25 rows is noise.
 */
export function designationLabel(contractInfo: string | null | undefined): string {
  const c = String(contractInfo ?? '').trim();
  if (!c || /^(std|standard|none|-)$/i.test(c)) return '';
  return c.toUpperCase();
}

/**
 * A compact kickoff: "Sun 10:00 AM PT", in ONE zone.
 *
 * The zone is resolved by the route (`viewerClockZone`, the viewer's own clock
 * with the league's as the floor) and handed down, because a browser has no
 * registry and a module-load capture would outlive a ClientRouter swap. One
 * clock, not the league's PT appended: `viewerClockZone` exists for compact
 * surfaces where two clocks do not fit, and a row line is one.
 *
 * Empty for a missing or unparseable instant, so a BYE week prints nothing.
 */
export function formatKickoffCompact(
  iso: string | null | undefined,
  zone: string | null | undefined,
  label: string | null | undefined,
): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone || undefined,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).formatToParts(at);
  } catch {
    return '';
  }
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // Assembled from parts: ICU puts a narrow no-break space before the day
  // period, which a joined string would carry into the DOM (viewer-clock.ts).
  const time = `${part('hour')}:${part('minute')} ${part('dayPeriod')}`.trim();
  return [part('weekday'), time, label ?? ''].filter(Boolean).join(' ');
}

export interface PhoneLineInput {
  /** Effective contract years (after declarations / simulated extensions). */
  contractYears?: number | string | null;
  /** The first salary year column (the league year). */
  firstYear?: number | string | null;
  contractInfo?: string | null;
  injuryStatus?: string | null;
  /** ISO kickoff instant from the row's `gameOdds.date`. */
  kickoffIso?: string | null;
  kickoffZone?: string | null;
  kickoffLabel?: string | null;
  /** The opponent's team code from `gameOdds.opponent`. */
  opponent?: string | null;
}

const span = (kind: string, text: string): string =>
  text ? `<span class="rr-ph rr-ph--${kind}" data-t="${escapeHtml(text)}"></span>` : '';

/**
 * The empty carrier spans for one roster row. Order in the markup does not
 * matter (the phone stylesheet places each one with `order`), and a value that
 * is empty emits nothing at all.
 */
export function buildPhoneLineSpans(input: PhoneLineInput): string {
  return [
    span('thru', contractThruLabel(input.contractYears, input.firstYear)),
    span('desig', designationLabel(input.contractInfo)),
    span('inj', String(input.injuryStatus ?? '').trim()),
    span('kick', formatKickoffCompact(input.kickoffIso, input.kickoffZone, input.kickoffLabel)),
    span('opp', String(input.opponent ?? '').trim().toUpperCase()),
  ].join('');
}
