/**
 * Pure helpers for the AFL live draft broadcast board.
 *
 * Split from the React components (same reason as `pick-reveal.ts`) so the
 * board-state derivation is unit-testable without a DOM. The components own
 * animation and layout; everything here is data → data.
 */

import type { DraftRoomPick, DraftRoomTeam } from '../types/draft-room';
import type { BroadcastPlayer, RosterHolding } from '../types/draft-broadcast';
import { getAllNFLTeamCodes, normalizeTeamCode } from './nfl-logo';
import { usesCollegeOrigin } from './pick-reveal';
import { resolveNflDarkLogoUrl } from './nfl-logo-dark-css';

/**
 * Where a player stood among what was ACTUALLY still on the board when he was
 * taken — the number the reveal leads with.
 *
 * Replaces an earlier STEAL/REACH meter that compared the pick number straight
 * against redraft ADP. That was wrong twice over in a keeper league. The AFL
 * keeps 7 per franchise, so 84 players are gone before 1.01 is called and the
 * AFL's 1.01 is really the 85th pick of a from-scratch draft — which made the
 * whole first round read as a reach. And once that scale was corrected the
 * deeper problem showed: past round one the AFL does not draft to redraft ADP
 * at all (its median pick is the ~84th-best available by ADP), so no rescaling
 * makes a verdict honest. A rank is a fact and needs no calibration: taking the
 * top man left still reads as a win, and taking the 90th-best available is
 * visibly a reach without the screen having to say so.
 *
 * Counts only players carrying a `boardRank`, so keepers — who never had one —
 * cannot inflate the position. Returns undefined when the player himself is
 * unranked, which is the honest answer rather than a fabricated placing.
 */
export function bestAvailableAt(
  picks: DraftRoomPick[],
  players: ReadonlyMap<string, BroadcastPlayer>,
  throughPickNumber: number,
  playerId: string
): number | undefined {
  const self = players.get(playerId);
  if (!self?.boardRank) return undefined;

  // Everyone taken BEFORE this pick is off the board. Anything at or after it
  // has not happened yet from this reveal's point of view — a queued reveal
  // must not be re-ranked by picks that landed while it waited its turn.
  const goneBefore = new Set(
    picks
      .filter((p) => p.playerId && p.overallPickNumber < throughPickNumber)
      .map((p) => p.playerId)
  );

  let better = 0;
  for (const p of players.values()) {
    if (!p.boardRank || p.id === playerId) continue;
    if (goneBefore.has(p.id)) continue;
    if (p.boardRank < self.boardRank) better += 1;
  }
  return better + 1;
}

/** English ordinal — 1st, 2nd, 3rd, 11th, 21st. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Room-facing copy. Short — it is read from ten feet away. */
export function formatBestAvailable(rank?: number): string | null {
  if (!rank || !Number.isFinite(rank) || rank < 1) return null;
  return rank === 1 ? 'BEST AVAILABLE' : `${ordinal(rank)} BEST AVAILABLE`;
}

/**
 * The next unfilled slot — who the room is waiting on.
 *
 * Scans for the first EMPTY slot rather than taking the last filled one + 1:
 * MFL lets a commissioner fill a slot out of order, and "one past the last
 * pick made" would then skip whoever is actually still on the clock.
 */
export function findOnTheClock(picks: DraftRoomPick[]): DraftRoomPick | null {
  return picks.find((p) => !p.playerId) ?? null;
}

/**
 * When MFL stamped the newest pick on this board, in epoch ms — or null when
 * nothing has been picked yet, or when every stamp is unusable.
 *
 * This is the anchor the idle screen's count-up hangs off: the team on the
 * clock has been on it since the pick before it landed, so "now minus this" is
 * literally how long the room has been waiting. MFL's own stamp is the anchor
 * rather than the moment this page first SAW the pick, because the board is
 * reloadable and re-openable mid-draft — a client-side "when we noticed"
 * anchor resets the clock to zero every time the laptop is refreshed, which is
 * the one thing the room would notice immediately.
 *
 * `null` rather than 0 for "no stamp": a board whose picks carry no usable
 * timestamp must show NO timer, not a timer counting up from 1970. Same
 * philosophy as `isRevealWorthy` — a missing stamp is a missing fact, and this
 * feature declines to invent one.
 *
 * The timestamp half of `boardAge` in DraftBroadcast.tsx is this function, on
 * purpose: the flap-rejection comparison and the clock on screen must never
 * disagree about which pick is the newest.
 */
export function lastPickAtMs(
  // The two fields it actually reads, not the whole pick — `boardAge`'s guard in
  // `tests/draft-broadcast-preflight.test.ts` builds boards out of exactly this
  // pair, and a `DraftRoomPick[]` signature is what forced that guard to
  // hand-copy the loop instead of calling it.
  picks: readonly Pick<DraftRoomPick, 'playerId' | 'timestamp'>[]
): number | null {
  let newest = 0;
  for (const p of picks) {
    if (!p.playerId) continue;
    const ts = Number.parseInt(p.timestamp, 10);
    if (Number.isFinite(ts) && ts > newest) newest = ts;
  }
  return newest > 0 ? newest * 1000 : null;
}

/**
 * The instant the idle screen's count-up should count from, or null for no
 * timer at all.
 *
 * Live, that is simply `lastPickAtMs`. The SSR board is a deployed feed
 * snapshot up to a few minutes old, and counting from ITS newest stamp is not a
 * bug — the pick really did land then, and the first accepted poll corrects the
 * anchor the moment a fresher board arrives.
 *
 * A REHEARSAL needs a floor, and this is the whole reason this function exists.
 * `applyRehearsal` restamps the picks the replay has rolled forward but
 * deliberately leaves the SEEDED ones — the `?rehearse=N` history the operator
 * asked to start from — carrying the finished season's own timestamps. That is
 * right for `isRevealWorthy`, whose answer for months-old history is "don't
 * reveal it". It is wrong here: measured on a dry run at `?rehearse=8`, the
 * board opened on `ELAPSED 2859:49:54` and sat there until the first replayed
 * pick landed sixteen seconds later. The dry run is the screen someone checks
 * this feature on before draft night, so it is the last place it should show a
 * five-digit hour count.
 *
 * `replayStartedMs` is when this board started watching. Flooring to it says
 * the honest thing — the dry run has been running for eight seconds, so eight
 * seconds is how long this team has been on the clock in the fiction being
 * replayed — and lifts the moment a restamped pick overtakes it.
 *
 * NOT applied live, on purpose. A reload mid-draft would floor the anchor to
 * the reload, so refreshing the laptop would silently reset a clock the room
 * has been watching — the exact failure `lastPickAtMs` anchors off MFL's stamp
 * to avoid.
 */
export function clockAnchorMs(
  picks: DraftRoomPick[],
  rehearsing: boolean,
  replayStartedMs: number
): number | null {
  const last = lastPickAtMs(picks);
  if (last === null) return null;
  return rehearsing ? Math.max(last, replayStartedMs) : last;
}

/**
 * Whole seconds as a wall clock — `4:12`, and `1:04:12` once it runs past an
 * hour.
 *
 * Minutes are unpadded below an hour and padded above it, which is how every
 * scoreboard and stopwatch a room has ever read one writes it: `9:07` alone,
 * but `1:09:07` in a three-part clock.
 *
 * Clamps negatives to zero rather than rendering `-0:03`. That is not
 * theoretical — the anchor comes from MFL's server clock and the count-up from
 * the browser's, so a laptop running a few seconds slow makes the newest pick
 * land in its future. A count-up that briefly sits at `0:00` is invisible; a
 * negative one on a TV is a bug everyone in the room can see.
 */
export function formatElapsedClock(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const ss = String(seconds).padStart(2, '0');
  if (hours <= 0) return `${minutes}:${ss}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
}

/** The most recent selections, newest first, for the idle ticker. */
export function recentPicks(picks: DraftRoomPick[], limit = 4): DraftRoomPick[] {
  return picks
    .filter((p) => !!p.playerId)
    .sort((a, b) => b.overallPickNumber - a.overallPickNumber)
    .slice(0, limit);
}

/** The slots after the one on the clock — "next up" on the idle screen. */
export function upcomingPicks(picks: DraftRoomPick[], limit = 3): DraftRoomPick[] {
  const clock = findOnTheClock(picks);
  if (!clock) return [];
  return picks
    .filter((p) => !p.playerId && p.overallPickNumber > clock.overallPickNumber)
    .slice(0, limit);
}

/**
 * How many of `position` went in the last `window` picks — the "run" callout.
 *
 * Counts the window INCLUDING the pick just made, so the reveal can say "4th
 * RB in 6 picks" about itself. Returns 0 for an unknown position rather than
 * guessing.
 */
export function positionRunCount(
  picks: DraftRoomPick[],
  players: ReadonlyMap<string, BroadcastPlayer>,
  throughPickNumber: number,
  position: string,
  window = 8
): number {
  if (!position) return 0;
  const target = position.toUpperCase();
  const lowBound = throughPickNumber - window;
  return picks.filter((p) => {
    if (!p.playerId) return false;
    if (p.overallPickNumber > throughPickNumber || p.overallPickNumber <= lowBound) return false;
    return (players.get(p.playerId)?.position || '').toUpperCase() === target;
  }).length;
}

/** Index teams by franchise id for O(1) lookup during a reveal. */
export function teamMap(teams: DraftRoomTeam[]): Map<string, DraftRoomTeam> {
  return new Map(teams.map((t) => [t.franchiseId, t]));
}

/** Index players by MFL id. */
export function playerMap(players: BroadcastPlayer[]): Map<string, BroadcastPlayer> {
  return new Map(players.map((p) => [p.id, p]));
}

/**
 * How old a pick may be and still be worth REVEALING.
 *
 * A reveal owns the whole TV for up to eighteen seconds, so it has to be news.
 * Two things make a pick arrive late even when the poll is healthy:
 *
 *  - **Autopick bursts.** MFL fires a queued autopick the instant the clock
 *    expires, and the 2026 rehearsal produced four picks stamped in the SAME
 *    SECOND (`[Pick made based on ...]`). Four reveals at the rush duration is
 *    twenty-four seconds of narration for something the room saw happen at
 *    once.
 *  - **Stale backends.** A current snapshot may not answer for several polls
 *    (see `acceptedRef` in DraftBroadcast.tsx), so picks can surface well
 *    after they were made.
 *
 * Either way the board ends up showing an old pick, then the live idle board,
 * then another old pick — which reads exactly like it is bouncing around. Past
 * this age a pick is absorbed silently: it still lands on the board and in the
 * rails, it just does not take the screen.
 *
 * Generous on purpose. A pick made while the previous reveal was up is still
 * news, and 90s is comfortably longer than a reveal plus a slow poll.
 *
 * THIS GATE HAS ONE TRAP, and it has already sprung once: it judges a pick by
 * the CLOCK, so any board whose stamps are not "now" fails it wholesale and
 * silently. A rehearsal replays a finished season, so on the day this landed
 * the dry run stopped revealing anything at all while still advancing
 * perfectly — see `applyRehearsal`, which is what keeps the two in step.
 */
export const REVEAL_MAX_AGE_MS = 90_000;

/**
 * Is this pick recent enough to be worth the screen?
 *
 * A pick with no usable stamp IS revealed: the stamp is an optimisation for
 * suppressing history, and a board that silently swallowed picks because MFL
 * omitted a field would be the worse failure by far.
 *
 * Lives here rather than in the component because it is half of the rehearsal
 * contract — see `applyRehearsal`. With the gate hidden inside the board, a
 * dry run replaying a finished season failed it on EVERY pick and nothing
 * could pin that.
 */
export function isRevealWorthy(pick: DraftRoomPick, nowMs: number): boolean {
  const ts = Number.parseInt(pick.timestamp, 10);
  if (!Number.isFinite(ts) || ts <= 0) return true;
  return nowMs - ts * 1000 <= REVEAL_MAX_AGE_MS;
}

/**
 * Trim the board to the picks a rehearsal should have "already made".
 *
 * Used with `?rehearse=N` against a COMPLETED season so the page can be driven
 * end-to-end before draft night. Emptied slots keep their franchise and pick
 * numbers — only the player is cleared — so the board still knows who is on
 * the clock.
 *
 * RESTAMPS THE PICKS THE REPLAY HAS ROLLED FORWARD (those above `replayedFrom`)
 * to `nowMs`. The season being replayed is finished by definition, so its picks
 * carry stamps months old — and `isRevealWorthy` above, which the live board
 * applies to every fresh pick, rejects all of them. The rehearsal ran the whole
 * board without ever showing a single reveal, which is the one thing a dry run
 * exists to prove. A replayed pick IS happening now, so it is stamped now, and
 * the dry run goes through the real age gate rather than around it.
 *
 * `replayedFrom` defaults to Infinity — nothing is restamped — which is what
 * the initial trimmed board wants: those picks are history the operator asked
 * to start from, exactly like the SSR board on draft night.
 */
export function applyRehearsal(
  picks: DraftRoomPick[],
  upTo: number,
  replayedFrom = Number.POSITIVE_INFINITY,
  nowMs = Date.now()
): DraftRoomPick[] {
  const stamp = String(Math.floor(nowMs / 1000));
  return picks.map((p) => {
    if (p.overallPickNumber > upTo) return { ...p, playerId: '', timestamp: '' };
    if (p.overallPickNumber > replayedFrom) return { ...p, timestamp: stamp };
    return p;
  });
}

// ── Broadcast contrast ───────────────────────────────────────────────────────

/**
 * Minimum contrast ratio the reveal card's copy must hold against its own
 * background. 4.5 rather than the 3.0 WCAG allows for large text: this is read
 * from ten feet across a room, on a TV whose brightness and viewing angle we
 * do not control.
 */
const MIN_WHITE_CONTRAST = 4.5;

/** Relative luminance per WCAG 2.x, from a #rgb or #rrggbb string. */
function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseHex(hex: string): [number, number, number] | null {
  const c = hex.trim().replace(/^#/, '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Contrast ratio of white against this colour. */
export function contrastWithWhite(hex: string): number {
  const rgb = parseHex(hex);
  // 0, not the floor value. Returning MIN_WHITE_CONTRAST here reads as "passes"
  // to every caller, so an unparseable brand colour — `#e9e9e9ff`, an
  // `rgb(...)` string, a typo — sailed through the league-wide guard tests and
  // reached the card untouched. The runtime path still degrades gracefully
  // (darkenForWhiteText returns the input unchanged); this is what makes the
  // guards actually guard.
  if (!rgb) return 0;
  return 1.05 / (relativeLuminance(rgb) + 0.05);
}

/**
 * Darken a franchise colour just far enough that white copy stays legible on
 * it, leaving anything already dark enough completely untouched.
 *
 * Nine of the AFL's 24 franchises have a gradient stop that fails even the 3.0
 * WCAG bar for large text — six of them a near-white `#e9e9e9`, and
 * Midwestside's `#ffcd00` is worse still. Against the 4.5 this enforces, 21 of
 * the 24 need adjusting. On a laptop that is a squint; on the TV it is an
 * unreadable card in front of the whole league.
 *
 * Scales RGB toward black rather than mixing in grey, which holds the hue and
 * saturation — a light pink becomes a deeper pink, never a muddy one. Returns
 * the input unchanged when it cannot be parsed, so a malformed brand colour
 * degrades to today's behaviour instead of throwing on draft night.
 */
export function darkenForWhiteText(hex: string, minRatio = MIN_WHITE_CONTRAST): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  if (contrastWithWhite(hex) >= minRatio) return hex;

  // Binary search the scale factor, evaluating the ROUNDED colour at each step.
  // Searching on the float and rounding once at the end lands just under the
  // target (4.47 against a 4.5 bar) because the 8-bit round can only lighten;
  // scoring what we will actually emit makes the floor a real guarantee.
  const scaledHex = (f: number) => toHex(rgb.map((v) => v * f) as [number, number, number]);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (contrastWithWhite(scaledHex(mid)) >= minRatio) lo = mid;
    else hi = mid;
  }
  return scaledHex(lo);
}


/** How much to push saturation before darkening. Dialled for a TV across a
 *  room, where a merely-correct colour reads as washed out. */
const TV_SATURATION_BOOST = 1.3;

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rr ? ((gg - bb) / d + (gg < bb ? 6 : 0))
    : max === gg ? (bb - rr) / d + 2
    : (rr - gg) / d + 4;
  return [h / 6, sat, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255];
}

/**
 * The colour treatment the broadcast card paints franchise brands with.
 *
 * Saturate, then floor the contrast. Both halves are for the same reason: a TV
 * across a lit room eats subtlety, so a merely-accurate colour reads washed
 * out, and a light one makes the copy unreadable outright. Saturating BEFORE
 * darkening matters — darkening a colour costs saturation, so boosting after
 * would be partly undone.
 *
 * A greyscale brand (saturation 0) is left un-saturated rather than being given
 * an arbitrary hue; it still gets the contrast floor.
 */
export function toBroadcastColor(hex: string, minRatio = MIN_WHITE_CONTRAST): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [h, sat, l] = rgbToHsl(rgb);
  const punched =
    sat === 0 ? rgb : hslToRgb([h, Math.min(1, sat * TV_SATURATION_BOOST), l]);
  return darkenForWhiteText(toHex(punched), minRatio);
}


/** Below this saturation a brand stop is "grey" — no hue of its own to keep. */
const GREY_SATURATION = 0.08;
/**
 * Saturation and lightness handed to a tinted grey.
 *
 * The grey's OWN lightness is deliberately discarded. Rebuilding #e9e9e9 in
 * hue at its native 0.91 lightness gives a pale wash whose channels sit within
 * a few points of each other, and the contrast floor then scales it back down
 * to something indistinguishable from the grey we were trying to escape. A
 * mid lightness is what actually reads as the colour on a TV.
 */
const TINT_SATURATION = 0.52;
const TINT_LIGHTNESS = 0.45;

/**
 * The gradient the reveal card actually paints, resolved as a PAIR.
 *
 * Six AFL franchises pair a real brand colour with the near-white #e9e9e9, and
 * three more pair one with a mid grey. Treated stop-by-stop that grey has no hue to preserve,
 * so it can only ever darken to grey — Suh Girls' warm brown faded into a dead
 * slate halfway across the card. Resolving the pair together lets a greyscale
 * stop borrow the hue of whichever stop HAS one, so the gradient stays in the
 * franchise's colour from end to end.
 *
 * A franchise that is greyscale on BOTH stops has no hue to borrow and stays
 * grey, which is correct — that is genuinely its brand.
 */
export function toBroadcastPair(
  primary: string,
  secondary: string
): { primary: string; secondary: string } {
  const hueOf = (hex: string): number | null => {
    const rgb = parseHex(hex);
    if (!rgb) return null;
    const [h, sat] = rgbToHsl(rgb);
    return sat >= GREY_SATURATION ? h : null;
  };
  const hue = hueOf(primary) ?? hueOf(secondary);

  const tint = (hex: string): string => {
    if (hue === null) return hex;
    const rgb = parseHex(hex);
    if (!rgb) return hex;
    const [, sat] = rgbToHsl(rgb);
    if (sat >= GREY_SATURATION) return hex;
    // Greyscale AND already legible means near-BLACK, which is a brand colour
    // in its own right here — ten franchises pair a colour with #181818. The
    // tint exists to rescue a LIGHT grey that would otherwise darken to slate;
    // applied to black it repainted Vitside Mafia's black half red and flattened
    // the gradient to colour-on-colour.
    if (contrastWithWhite(hex) >= MIN_WHITE_CONTRAST) return hex;
    return toHex(hslToRgb([hue, TINT_SATURATION, TINT_LIGHTNESS]));
  };

  return {
    primary: toBroadcastColor(tint(primary)),
    secondary: toBroadcastColor(tint(secondary)),
  };
}

/**
 * Characters a franchise's `broadcastGradient` may contain.
 *
 * The value is painted verbatim into an inline `style`, so a stray `;` or `}`
 * does not "look wrong" — it silently ends the declaration and the card renders
 * with NO background at all, on a TV, in front of the league. Colons and
 * semicolons are what make that possible, so neither is on the list. Quotes and
 * backslashes go too, since the value is also serialized into the page.
 */
const GRADIENT_CHARSET = /^[a-zA-Z0-9#%.,()\-+/ ]+$/;

/** Every layer must be a gradient function — no `url()`, no `image-set()`. */
const GRADIENT_LAYER = /^(repeating-)?(linear|radial|conic)-gradient\(/;

/**
 * Split a `background` value into its comma-separated LAYERS.
 *
 * Depth-aware, because a gradient's own stop list is full of commas —
 * `linear-gradient(115deg, #000 0%, #fff 100%)` is ONE layer containing two.
 * Only a comma at paren depth 0 separates layers.
 *
 * Returns null on an unbalanced string, which is itself a rejection: an
 * unclosed paren swallows whatever the browser finds next.
 */
function splitLayers(value: string): string[] | null {
  const layers: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return null;
    } else if (ch === ',' && depth === 0) {
      layers.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth !== 0) return null;
  layers.push(value.slice(start).trim());
  return layers;
}

/**
 * Is this config string safe (and plausible) to paint as a `background`?
 *
 * Config is repo-authored, not user input, so this is not a security boundary —
 * it is the guard that makes a raw-CSS config field survivable. `broadcastGradient`
 * was chosen over structured stops for the flexibility (multi-layer, radial,
 * conic), and the cost of that flexibility is that nothing else can catch a
 * typo. A value that fails here is IGNORED rather than thrown on, so the card
 * degrades to the derived `toBroadcastPair` gradient instead of going blank.
 *
 * `tests/broadcast-gradient-config.test.ts` runs every franchise in both league
 * configs through this, which is what turns a free-text field into a checked one.
 */
export function isSafeCssGradient(value: string | undefined | null): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 600) return false;
  if (!GRADIENT_CHARSET.test(trimmed)) return false;
  // `url(` and `image-set(` are already unreachable — `:` is off the charset so
  // no scheme can be written — but a relative `url(x.png)` is not, and it has no
  // business in a franchise's brand gradient.
  if (/\b(url|image-set|element|expression)\s*\(/i.test(trimmed)) return false;

  // EVERY layer must be a gradient, not just the first. Checking only the head
  // of the string let `linear-gradient(…), lnear-gradient(…)` validate — one
  // transposed letter in a second layer, which invalidates the whole `background`
  // declaration and blanks the card exactly like the `;` this function was
  // written to stop. A trailing comma slipped through the same way, since it
  // leaves an empty final layer. (Copilot caught this on PR #640.)
  //
  // This also rejects a trailing plain colour (`linear-gradient(…), #000`),
  // which is legal CSS. That is deliberate: this field paints franchise
  // gradients, and being stricter than CSS costs nothing here.
  const layers = splitLayers(trimmed);
  if (!layers) return false;
  return layers.every((layer) => GRADIENT_LAYER.test(layer));
}

/**
 * The franchise's configured broadcast background, or nothing.
 *
 * Returns `undefined` — not a derived fallback — on purpose: the caller leaves
 * `--dbc-gradient` unset, and the stylesheet's own `var()` fallback paints the
 * `toBroadcastPair` gradient exactly as it did before this field existed. One
 * painting path, not two.
 */
export function resolveBroadcastGradient(team?: {
  broadcastGradient?: string;
}): string | undefined {
  return isSafeCssGradient(team?.broadcastGradient) ? team!.broadcastGradient : undefined;
}

// ── The origin line ──────────────────────────────────────────────────────────

/** The origin line: what it reads, and the mark that goes to its left. */
export interface BroadcastOrigin {
  /** "Georgia" / "KC" — the words. Empty when the player has no origin at all. */
  label: string;
  /** Logo for that origin, or null when we have no mark to show for it. */
  logo: string | null;
}

/** The 32 canonical ESPN codes, as a set — `normalizeTeamCode` passes an
 *  unrecognised code through verbatim, so membership is the only proof that a
 *  logo file exists for it. */
const NFL_LOGO_CODES: ReadonlySet<string> = new Set(getAllNFLTeamCodes());

/**
 * The origin line's text and its logo, resolved together.
 *
 * One function for both halves so the mark can never contradict the words: the
 * label picks college-or-NFL, and the logo is whichever of the two it picked.
 *
 * DARK CUTS, wherever one exists. Every other surface on the site ships the
 * light logo and lets `buildNflLogoDarkCss` / `buildCollegeLogoDarkCss` swap it
 * under `html.dark`, because with theme preference 'auto' the server cannot
 * know which the reader resolved. This card is the exception those helpers describe
 * and the Sunday Ticket multi-view already takes: it paints a franchise-colour
 * gradient in BOTH themes, so the background is dark no matter what the viewer
 * picked, and the marks that vanish against it (Raiders, Steelers, Jets,
 * Bengals…) would vanish for the half of the room on the light theme. Shipping
 * the dark URL as the `src` also means no swap rule is keyed on it, so nothing
 * double-swaps it back.
 *
 * The college half arrives pre-resolved on the player (`collegeLogo`) — that
 * lookup needs an 80 KB table the island must not carry, and it is the half
 * that can hand back a LIGHT mark: a few NCAA dark cuts 404 upstream, and there
 * the light logo beats no logo. Every NFL code has a dark cut, so that half is
 * always dark. The NFL half is built
 * here from `nflTeam`, which every player already ships, rather than sent as a
 * ~45-byte string per player for a pool of hundreds.
 *
 * Returns `logo: null` — never a substitute mark — for a free agent, a retiree
 * (both of which `normalizeTeamCode` folds to the NFL shield), an unrecognised
 * team code, or a school the logo table does not carry. A wrong crest beside a
 * player's name is worse than no crest.
 */
export function resolveOrigin(player?: {
  isRookie?: boolean;
  college?: string;
  collegeLogo?: string;
  nflTeam?: string;
}): BroadcastOrigin {
  if (!player) return { label: '', logo: null };

  if (usesCollegeOrigin(player)) {
    return { label: player.college!, logo: player.collegeLogo ?? null };
  }

  const label = player.nflTeam || '';
  const code = normalizeTeamCode(label);
  const logo = NFL_LOGO_CODES.has(code) ? resolveNflDarkLogoUrl(code) : null;
  return { label, logo };
}

// ── The screensaver ──────────────────────────────────────────────────────────

/**
 * How long the idle board may sit unchanged before the board starts replaying
 * the draft to itself.
 *
 * An EMAIL draft is the case this exists for: eight hours per pick is inside
 * the rules, so the TV can hold one crest and one count-up for an entire
 * evening, and a screen that never changes is a screen nobody looks at. Ten
 * minutes is long enough that a room drafting at any normal pace never sees
 * this at all — the live board is always the better screen when there is
 * anything happening on it — and short enough that a stalled draft turns into
 * a highlight reel while people are still in the room.
 */
export const SCREENSAVER_IDLE_MS = 10 * 60_000;

/**
 * How long one replayed pick owns the screen.
 *
 * Shorter than the live `REVEAL_MS` (18s) on purpose, and for the same reason
 * the rehearsal step is: a live reveal is the only thing on screen for the
 * eighteen seconds it owns the TV BECAUSE the idle board fills the rest of the
 * night around it. In the reel there is no rest — it is reveal to reveal — so
 * the hold is the entire pace. At 8s a 108-pick AFL board is a ~14-minute reel,
 * which is about as long as anyone will watch one.
 */
export const SCREENSAVER_STEP_MS = 8_000;

/**
 * The reel: every pick actually made, in draft order.
 *
 * Draft ORDER, not recency — the reel is the night told from the beginning, so
 * 1.01 opens it. Sorted rather than trusted, because the board array is MFL's
 * and a commissioner filling a slot out of order is a thing that happens; the
 * pick numbers are the truth about sequence.
 *
 * Unfilled slots are dropped, so the reel is naturally empty before the draft
 * starts — which is what stops the screensaver arming on a pre-draft board
 * that has nothing to replay.
 */
export function screensaverReel(picks: DraftRoomPick[]): DraftRoomPick[] {
  return picks
    .filter((p) => !!p.playerId)
    .sort((a, b) => a.overallPickNumber - b.overallPickNumber);
}

/**
 * The instant the idle countdown runs from — the latest of three clocks.
 *
 * `lastPickAtMs` is the one that matters on draft night: the room has been
 * looking at this screen since that pick landed, which is exactly what the
 * count-up beside it already says. Sharing that scanner is deliberate — the
 * "Elapsed" number the room is reading and the trigger that starts the reel
 * must never disagree about which pick is the newest.
 *
 * `boardOpenedMs` is a floor for the RELOAD case, and it is not cosmetic.
 * Someone reloads the board mid-draft precisely because they want to see the
 * live state; on a stalled email draft the last pick is already hours old, so
 * without this floor the reload would be answered by the reel starting
 * instantly and the on-the-clock screen never appearing at all. Ten minutes of
 * live board first, then the reel, on a fresh load exactly as at any other
 * time.
 *
 * `quietSinceMs` is the CLIENT-clock instant from which the room has had
 * nothing new: the end of the last cycle, or the arrival of a fresh pick. It
 * covers two holes the other two cannot.
 *
 * Without the cycle-end half, the anchor is still the same hours-old pick the
 * moment the cycle ends, so the screensaver would re-arm into a permanent loop
 * with no idle board between passes — and the idle board is the half that says
 * whose turn it is.
 *
 * Without the fresh-pick half, a pick MFL stamped unusably would not move the
 * anchor at all — `lastPickAtMs` skips an unparseable stamp, though
 * `isRevealWorthy` deliberately still reveals that pick — so the board would
 * hand the room its reveal and then re-arm the cycle the instant the reveal
 * drained, instead of the ten minutes of on-the-clock board a pick has just
 * earned. On a board where NO pick carries a stamp that is not an edge case,
 * it is every pick.
 */
export function screensaverAnchorMs(
  picks: DraftRoomPick[],
  boardOpenedMs: number,
  quietSinceMs = 0
): number {
  return Math.max(lastPickAtMs(picks) ?? 0, boardOpenedMs, quietSinceMs);
}

/**
 * Has the board been idle long enough to start replaying?
 *
 * `idleMs <= 0` means the screensaver is switched off (`?screensaver=off`), and
 * is checked here rather than at the call site so every caller — component,
 * test, a future one — reads "off" the same way.
 */
export function isScreensaverDue(
  anchorMs: number,
  nowMs: number,
  idleMs: number = SCREENSAVER_IDLE_MS
): boolean {
  if (!Number.isFinite(idleMs) || idleMs <= 0) return false;
  return nowMs - anchorMs >= idleMs;
}

/**
 * `?screensaver=` → the idle threshold in ms.
 *
 * Takes SECONDS, because the only reason to pass it is to watch the thing
 * work without sitting in front of a TV for ten minutes (`?screensaver=20`).
 * `off` disables it — for the night somebody wants the on-the-clock screen and
 * nothing else, which is a legitimate way to run this page.
 *
 * Anything unparseable falls back to the default rather than to "off": a typo
 * in a debug parameter must not silently remove a feature from draft night.
 */
export function resolveScreensaverIdleMs(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') return SCREENSAVER_IDLE_MS;
  const value = raw.trim().toLowerCase();
  if (value === 'off' || value === 'no' || value === 'false' || value === '0') return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : SCREENSAVER_IDLE_MS;
}

/**
 * How long one PANEL owns the screen — the roster and position screens.
 *
 * Longer than a replayed pick (8s), because a panel is read rather than
 * recognised: a reveal is one name at 8vh that lands in a second, while a
 * roster panel is a dozen faces and a count per position. Fifteen seconds is
 * about two unhurried passes across a TV from ten feet.
 */
export const SCREENSAVER_PANEL_MS = 15_000;

/**
 * The order of the positions on the panels, and the only ones they draw.
 *
 * Fixed rather than sorted by count, so the row a viewer wants is always in the
 * same place across the four panels a cycle shows — a board that re-sorts
 * itself makes the room re-read it every time. `PK` is MFL's kicker code (the
 * pool normalizes to it), and `DEF` covers every team unit.
 */
export const BROADCAST_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'] as const;
export type BroadcastPosition = (typeof BROADCAST_POSITIONS)[number];

/** Anything else — an unranked oddity or a position the pool spells its own
 *  way — is folded here rather than dropped, so a roster's count always adds
 *  up to the roster. */
const OTHER_POSITION = 'OTHER';

function positionBucket(raw: string | undefined): string {
  const pos = (raw || '').toUpperCase();
  if ((BROADCAST_POSITIONS as readonly string[]).includes(pos)) return pos;
  // The pool has spelled kickers both ways over the years, and a K row that
  // silently became OTHER would be a row the room reads as a bug.
  if (pos === 'K') return 'PK';
  return OTHER_POSITION;
}

/** One position's row on the "off the board" panel. */
export interface PositionTally {
  position: string;
  count: number;
  /** The players taken there, MOST RECENT FIRST — the faces the row draws. */
  players: BroadcastPlayer[];
}

/**
 * How many of each position are off the board, with the faces to prove it.
 *
 * The number nobody tracks in an email draft and everybody argues about: the
 * run happened three hours ago and the only record of it is a scrollback. Rows
 * come back in `BROADCAST_POSITIONS` order — see the note there on why they are
 * not sorted by count — and a position nobody has taken is omitted entirely
 * rather than drawn as a zero, since an empty row on a TV reads as a loading
 * state.
 *
 * Most recent first inside a row, so the faces a viewer sees first are the ones
 * they might not have seen land.
 */
export function positionTallies(
  picks: DraftRoomPick[],
  players: ReadonlyMap<string, BroadcastPlayer>
): PositionTally[] {
  const byPosition = new Map<string, BroadcastPlayer[]>();
  const made = [...picks]
    .filter((p) => !!p.playerId)
    .sort((a, b) => b.overallPickNumber - a.overallPickNumber);

  for (const pick of made) {
    const player = players.get(pick.playerId);
    // A pick whose player the pool cannot name still COUNTS — the position is
    // unknowable without him, so he lands in OTHER rather than vanishing and
    // making the panel's total disagree with the board's.
    const bucket = positionBucket(player?.position);
    const row = byPosition.get(bucket);
    if (row) row.push(player as BroadcastPlayer);
    else byPosition.set(bucket, [player as BroadcastPlayer]);
  }

  const order = [...BROADCAST_POSITIONS, OTHER_POSITION];
  return order
    .filter((pos) => byPosition.has(pos))
    .map((pos) => ({
      position: pos,
      count: byPosition.get(pos)!.length,
      players: byPosition.get(pos)!.filter((p): p is BroadcastPlayer => !!p),
    }));
}

/** One player on a roster panel: what he is, and whether he was taken tonight. */
export interface RosterEntry {
  id: string;
  name: string;
  position: string;
  nflTeam: string;
  espnId?: string;
  /**
   * The cutout the SERVER already resolved, when this entry came from the
   * shipped pool — i.e. for a pick, never for a holding (a `RosterHolding` is a
   * thin record and deliberately carries none).
   *
   * Passed through rather than dropped so the chip starts on the URL that is
   * known to work instead of rebuilding one and walking a 404 to get back to it
   * (Copilot, #668). `mflId` rides along for the same reason: it is the id the
   * fallback hops are built from, and it is not always the MFL id on `id`.
   */
  headshot?: string;
  mflId?: string;
  /** "2.07" when this player was drafted tonight; absent for a holding. */
  pickLabel?: string;
}

/** One position's row on a roster panel. */
export interface RosterRow {
  position: string;
  count: number;
  players: RosterEntry[];
}

/**
 * What a franchise has at each position — holdings plus tonight's picks.
 *
 * The panel's whole job is "what does he still need?", which is only answerable
 * against the WHOLE roster: in the AFL the seven keepers are most of it, and in
 * TheLeague's rookie draft the standing dynasty roster is nearly all of it.
 *
 * Tonight's picks go FIRST inside a row and carry their pick label, because
 * they are the half that changed while the room was watching.
 *
 * Deduped by player id, and that is not defensive tidiness: `rosters.json` is a
 * cron snapshot that starts gaining tonight's picks partway through the draft,
 * so the same man legitimately arrives from both sides. The live board wins,
 * since it is the side that knows which pick he was.
 */
export function rosterRows(
  holdings: readonly RosterHolding[] | undefined,
  picks: DraftRoomPick[],
  players: ReadonlyMap<string, BroadcastPlayer>,
  franchiseId: string
): RosterRow[] {
  const entries: RosterEntry[] = [];
  const seen = new Set<string>();

  for (const pick of picks) {
    if (pick.franchiseId !== franchiseId || !pick.playerId) continue;
    const player = players.get(pick.playerId);
    if (!player?.name) continue;
    seen.add(player.id);
    entries.push({
      id: player.id,
      name: player.name,
      position: player.position || '',
      nflTeam: player.nflTeam || '',
      ...(player.espnId ? { espnId: player.espnId } : {}),
      // See RosterEntry: the pool's own resolved cutout, so the chip does not
      // rebuild a URL it was handed.
      ...(player.headshot ? { headshot: player.headshot } : {}),
      ...(player.mflId ? { mflId: player.mflId } : {}),
      pickLabel: `${pick.round}.${String(pick.pickInRound).padStart(2, '0')}`,
    });
  }

  for (const held of holdings ?? []) {
    if (seen.has(held.id)) continue;
    seen.add(held.id);
    entries.push({ ...held });
  }

  const byPosition = new Map<string, RosterEntry[]>();
  for (const entry of entries) {
    const bucket = positionBucket(entry.position);
    const row = byPosition.get(bucket);
    if (row) row.push(entry);
    else byPosition.set(bucket, [entry]);
  }

  const order = [...BROADCAST_POSITIONS, OTHER_POSITION];
  return order
    .filter((pos) => byPosition.has(pos))
    .map((pos) => ({
      position: pos,
      count: byPosition.get(pos)!.length,
      // Tonight's picks first, then the holdings, each side in the order it
      // arrived — draft order for the picks, roster order for the rest.
      players: byPosition
        .get(pos)!
        .slice()
        .sort((a, b) => Number(!!b.pickLabel) - Number(!!a.pickLabel)),
    }));
}

/**
 * One screen in the screensaver's cycle.
 *
 * The reel was the first of these and is now just the tail: a `pick` scene per
 * selection. The panels in front of it are about NOW — who is up, what he
 * holds, what is gone — which is why they come first. In a draft this slow the
 * room's questions are all present-tense; the reel is the nostalgia after.
 */
export type ScreensaverScene =
  | { kind: 'roster'; franchiseId: string; role: 'clock' | 'deck' }
  | { kind: 'positions' }
  | { kind: 'pick'; pick: DraftRoomPick };

/**
 * The whole cycle, built ONCE when the screensaver arms.
 *
 * Built once rather than derived per frame so the cycle cannot reshuffle
 * underneath the room — and it never needs to, because the one event that
 * changes any of this (a pick landing) ends the screensaver outright.
 *
 * Empty when there is nothing to say: a pre-draft board has no reel, no
 * position tally and no roster worth showing, and an empty cycle is what stops
 * the screensaver arming on it at all.
 */
export function buildScreensaverPlaylist(picks: DraftRoomPick[]): ScreensaverScene[] {
  const reel = screensaverReel(picks);
  if (reel.length === 0) return [];

  const scenes: ScreensaverScene[] = [];
  const clock = findOnTheClock(picks);
  if (clock) scenes.push({ kind: 'roster', franchiseId: clock.franchiseId, role: 'clock' });

  const deck = upcomingPicks(picks, 1)[0];
  // Back-to-back picks are ordinary once a pick has been traded, and the same
  // roster twice in a row is a cycle that looks stuck.
  if (deck && deck.franchiseId !== clock?.franchiseId) {
    scenes.push({ kind: 'roster', franchiseId: deck.franchiseId, role: 'deck' });
  }

  scenes.push({ kind: 'positions' });
  for (const pick of reel) scenes.push({ kind: 'pick', pick });
  return scenes;
}

/** How long this scene holds the screen. */
export function screensaverSceneMs(scene: ScreensaverScene): number {
  return scene.kind === 'pick' ? SCREENSAVER_STEP_MS : SCREENSAVER_PANEL_MS;
}
