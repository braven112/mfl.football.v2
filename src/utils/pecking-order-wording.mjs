/**
 * Pecking Order shorthand → plain English.
 *
 * The fact sheet the writer reads used box-score shorthand ("W2", "L3", "PPG
 * L3"), and the writer echoed it into published blurbs: "a 2-1 L3 with a W2
 * streak". Owners read that as a puzzle (Brandon, Oct 2026: say "a 2-game
 * winning streak", and if you mean last three, say last three). New issues
 * are generated without the shorthand (nor "rolling record", which nobody
 * says either); this rewrites any that slips through,
 * and is applied at render time so issues already published read the same.
 *
 * "L3" here always means the rolling last-three-WEEKS window (a week can hold
 * two games), never a three-game losing streak — that one is "L3 streak".
 */

const NUMBER_WORDS = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine' };

// a score: 2-2, 3-1-1
const REC = '\\d+-\\d+(?:-\\d+)?';
// every name the writer has used for the window
const WIN = 'L3|rolling|last[- ]three(?: weeks)?';

const STREAK_KIND = { W: 'winning', L: 'losing' };

// "an" before the streak lengths spoken with a leading vowel: an 8-, 11-, 18-game.
const takesAn = (n) => /^(8|11|18)$/.test(n);

export function spellOutShorthand(text) {
  if (typeof text !== 'string' || !text) return text;
  // One pick per blurb, stable across renders, different from blurb to blurb.
  let turn = hash(text);
  const noun = () => NOUN_PHRASES[turn++ % NOUN_PHRASES.length];
  const bare = () => BARE_PHRASES[turn++ % BARE_PHRASES.length];
  const out = text
    // "a W2 streak" / "an L3 active streak" → "a 3-game losing streak"
    // also "an L7 losing streak" and a bare "a W5 active"
    .replace(/\b(?:(an?)\s+)?([WL])(\d{1,2})(?=\s+(?:active|streak|winning|losing)\b)(?:\s+active)?(?:\s+(?:winning|losing))?(?:\s+streak)?\b/g, (_m, article, kind, n) => {
      const phrase = `${n}-game ${STREAK_KIND[kind]} streak`;
      if (!article) return phrase;
      const a = takesAn(n) ? 'an' : 'a';
      return `${article[0] === 'A' ? a[0].toUpperCase() + a.slice(1) : a} ${phrase}`;
    })
    // The three-week window, however the writer named it, becomes a proper
    // phrase, rotated so a column doesn't say the same words 24 times
    // (Brandon, Oct 2026: "2-2 record", "a 2-2 mark over the last three",
    // "2-2 performance over the last few weeks", "2-2 over the last three
    // weeks" — never "a 2-2 last three weeks").
    // "a 3-1 rolling record" / "3-0 L3 record" / "a 6-0 last-three record"
    .replace(new RegExp(`\\b(${REC})\\s+(?:${WIN})\\s+record\\b`, 'g'), (_m, rec) => `${rec} ${noun()}`)
    // "a 2-2 last three weeks" / "a perfect 4-0 L3" — a score used as a noun needs one
    .replace(new RegExp(`\\b(an?|the|their|perfect|pristine|ugly|brutal|crisp|dominant)\\s+(${REC})\\s+(?:${WIN})\\b(?!\\s+(?:record|stretch|run))`, 'g'), (_m, lead, rec) => `${lead} ${rec} ${noun()}`)
    // "going 2-1 L3" → "going 2-1 over the last three weeks"
    .replace(new RegExp(`\\b(${REC})\\s+(?:L3|last[- ]three weeks)\\b`, 'g'), (_m, rec) => `${rec} ${bare()}`)
    // "131.5 PPG L3" / "151.9 PPG rolling average" / "82.1 PPG rolling"
    .replace(/\bPPG\s+(?:L3|rolling(?:\s+average)?)\b/g, () => `PPG ${bare()}`)
    // "131.3 PPG over L3" → "131.3 PPG over the last three"
    .replace(/\bover\s+(?:L3|last-three)\b/g, 'over the last three')
    // anything left: "their L3 window" → "their last-three window"
    .replace(/\bL3\b/g, 'last-three')
    // "over their last 3" → "over their last three"
    .replace(/\blast ([2-9])\b(?![.\d])/g, (_m, n) => `last ${NUMBER_WORDS[n]}`);
  return sayWindowOnce(out);
}

// What follows a score used as a noun ("a 2-2 ___").
const NOUN_PHRASES = [
  'record over the last three weeks',
  'mark over the last three',
  'performance over the last few weeks',
];
// What follows a score or a PPG figure that needs no noun ("went 2-2 ___").
const BARE_PHRASES = ['over the last three weeks', 'over the last three'];

// Any name for the window after the first is a stutter: "a 3-1 record over the
// last three weeks and 124.4 PPG over the last three weeks". The first mention
// sets the frame; later ones drop. "over their last three games" is a
// different claim and stays.
const WINDOW_RE = /\s+over (?:the|their) last (?:three|few)(?: weeks)?\b(?!\s+games)/g;
function sayWindowOnce(text) {
  let seen = false;
  return text.replace(WINDOW_RE, (m) => {
    if (!seen) { seen = true; return m; }
    return '';
  });
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}
