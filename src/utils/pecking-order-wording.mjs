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
  return sayWindowOnce(dropRecordTheStreakCovers(out));
}

/**
 * True when a streak already says everything the last-three record would:
 * a 3-game winning streak IS a 3-0 last three, and a 4-game one covers it too
 * (Brandon, Nov 2026: "if they're on a four-game winning streak or anything
 * larger than 3, we don't want to talk about their 3-0 record over the last
 * 3"). Ties break a streak, so a record with one never matches.
 *
 * @param {{ type: 'W'|'L'|null, length: number } | null | undefined} streak
 * @param {{ wins: number, losses: number, ties?: number } | null | undefined} rec
 */
export function streakCoversRecord(streak, rec) {
  if (!streak || !rec || streak.length < 2) return false;
  const ties = rec.ties || 0;
  const games = rec.wins + rec.losses + ties;
  if (games === 0 || ties > 0 || games > streak.length) return false;
  return streak.type === 'W' ? rec.losses === 0 : streak.type === 'L' ? rec.wins === 0 : false;
}

// The redundant pairing as the writer phrases it, in either order:
//   "on a 3-game winning streak and a 3-0 mark over the last three weeks"
//   "a 7-game winning streak, the longest in the league, and a 3-0 mark over the last three weeks"
//   "after a perfect 4-0 performance over the last few weeks and 4-game winning streak"
//   "with a 4-0 mark over the last three, a 6-game winning streak, and 69.6% all-play"
//   "going 6-0 over the last three weeks with a 6-game winning streak"
// The record clause drops and the streak, the stronger claim, stays, with the
// sentence around it mended (list commas, the article, the verb). Anything
// riskier is left alone: the fact sheet stops new issues from saying it.
const STREAK_RE = /\b(\d+)-game (winning|losing) streak\b/;
const WINDOW = String.raw`over (?:the|their) last (?:three|four|five|six|few|\d)(?:\s+(?:weeks|games))?`;
const SCORE = String.raw`(?<w>\d+)-(?<l>\d+)(?:-(?<t>\d+))?`;
const REC_NOUN = String.raw`(?:\s+(?:record|mark|run|stretch|performance|finish|showing))?`;
// One describing word ("perfect", "ugly", "nightmare"), never a verb.
const ADJ = String.raw`(?:(?!(?:went|go|goes|going|is|are|was|were)\s)[a-z]+\s+)?`;
const STREAK_AHEAD = String.raw`(?=(?<own>(?:an?|the|their)\s+)?(?:active\s+)?\d+-game (?:winning|losing) streak)`;

// Before the streak, as a noun: "a 3-0 mark over the last three and ".
const RECORD_BEFORE = new RegExp(String.raw`\b(?<art>an?|the|their)\s+${ADJ}${SCORE}${REC_NOUN}\s+${WINDOW}(?<comma>,)?\s+(?<and>and|with|plus)?\s*${STREAK_AHEAD}`, 'g');
// Before the streak, bare in a list: "20.0% all-play, 0-5 over the last three, and ".
const LISTED_BEFORE = new RegExp(String.raw`(?<=,\s)${SCORE}\s+${WINDOW},\s+and\s+${STREAK_AHEAD}`, 'g');
// Before the streak, on a verb: "going 6-0 over the last three weeks with " → "on ".
const VERB_BEFORE = new RegExp(String.raw`\b(?<verb>going|is|are)\s+${SCORE}\s+${WINDOW}\s+(?:with|on|riding)\s+${STREAK_AHEAD}`, 'g');
// After the streak, as a noun: ", and a 3-0 mark over the last three weeks".
const RECORD_AFTER = new RegExp(String.raw`(?<lead>,?\s+(?:and|with|after|plus)\s+)(?:(?:an?|the|their)\s+)?${ADJ}${SCORE}${REC_NOUN}\s+${WINDOW}(?![\w-])`, 'g');
// After the streak, on a verb, only where the clause ends cleanly:
// ", going 6-0 over the last three weeks." / "and went 0-3 over the last three weeks,".
const VERB_AFTER = new RegExp(String.raw`(?<lead>,?\s+(?:and\s+)?)(?:went|going)\s+${SCORE}\s+${WINDOW}(?=\s*[,.;!?—]|\s*$|\s+and\b)`, 'g');

// The verb that followed "a streak and a record" now has one subject.
const SINGULAR = { show: 'shows', make: 'makes', say: 'says', suggest: 'suggests', have: 'has', leave: 'leaves', put: 'puts', keep: 'keeps', are: 'is' };

const asStreak = (n, kind) => ({ type: kind === 'winning' ? 'W' : 'L', length: Number(n) });
const asRecord = (g) => ({ wins: Number(g.w), losses: Number(g.l), ties: Number(g.t || 0) });
const groupsOf = (args) => args[args.length - 1];
const offsetOf = (args) => args[args.length - 3];

export function dropRecordTheStreakCovers(text) {
  if (typeof text !== 'string' || !text) return text;
  // Sentence by sentence, so a record is only ever weighed against the streak
  // it shares a sentence with. A decimal point ("134.1 PPG") is not a break.
  return text.replace(/(?:[^.!?]|[.!?](?!\s|$))+[.!?]*/g, (sentence) => {
    const s = sentence.match(STREAK_RE);
    if (!s) return sentence;
    const streak = asStreak(s[1], s[2]);
    const covers = (g) => streakCoversRecord(streak, asRecord(g));
    const article = `${takesAn(s[1]) ? 'an' : 'a'} `;
    let out = sentence;
    let unlist = false; // a list lost an item: "A, B, and C" → "B and C"

    out = out.replace(RECORD_BEFORE, (...args) => {
      const g = groupsOf(args);
      if (offsetOf(args) > s.index || !covers(g)) return args[0];
      const before = out.slice(0, offsetOf(args));
      if (g.comma && !g.and) unlist = true;
      // "mark, a 3-0 stretch …, and a 5-game streak" → "mark and a 5-game streak"
      const join = g.and === 'and' && /,\s$/.test(before) ? '\u0000' : '';
      return join + (g.own ? '' : article);
    });
    out = out
      .replace(/,\s\u0000/g, ' and ')
      .replace(LISTED_BEFORE, (...args) => (covers(groupsOf(args)) ? '' : args[0]))
      .replace(VERB_BEFORE, (...args) => {
        const g = groupsOf(args);
        return covers(g) ? (g.verb === 'going' ? 'on ' : `${g.verb} on `) : args[0];
      });

    const at = out.match(STREAK_RE);
    if (!at) return out;
    const end = at.index + at[0].length;
    let head = out.slice(0, end);
    let tail = out.slice(end);
    let dropped = false;
    const drop = (...args) => {
      const g = groupsOf(args);
      if (!covers(g)) return args[0];
      dropped = true;
      if (/^,\s+and\s/.test(g.lead)) {
        // "mark, a 7-game streak, and an 0-3 mark" → "mark and a 7-game streak"
        head = head.replace(/,\s+((?:an?|the|their)\s+(?:active\s+)?\d+-game (?:winning|losing) streak)$/, ' and $1');
      }
      return '';
    };
    tail = tail.replace(RECORD_AFTER, drop).replace(VERB_AFTER, drop);
    if (dropped) {
      tail = tail
        // the record's own noun, stranded behind the streak: "streak and a 0-6 run … mark"
        .replace(/^\s+mark\b/, '')
        .replace(/^(\s+)([a-z]+)\b/, (m, sp, verb) => (SINGULAR[verb] ? `${sp}${SINGULAR[verb]}` : m));
    }
    if (unlist) tail = tail.replace(/^(\s*[^,]*?),\s+and\s/, '$1 and ');
    return head + tail;
  });
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
