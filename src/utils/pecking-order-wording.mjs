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

const STREAK_KIND = { W: 'winning', L: 'losing' };

// "an" before the streak lengths spoken with a leading vowel: an 8-, 11-, 18-game.
const takesAn = (n) => /^(8|11|18)$/.test(n);

export function spellOutShorthand(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    // "a W2 streak" / "an L3 active streak" → "a 3-game losing streak"
    // also "an L7 losing streak" and a bare "a W5 active"
    .replace(/\b(?:(an?)\s+)?([WL])(\d{1,2})(?=\s+(?:active|streak|winning|losing)\b)(?:\s+active)?(?:\s+(?:winning|losing))?(?:\s+streak)?\b/g, (_m, article, kind, n) => {
      const phrase = `${n}-game ${STREAK_KIND[kind]} streak`;
      if (!article) return phrase;
      const a = takesAn(n) ? 'an' : 'a';
      return `${article[0] === 'A' ? a[0].toUpperCase() + a.slice(1) : a} ${phrase}`;
    })
    // "a 3-1 rolling record" → "a 3-1 record over the last three weeks"
    .replace(/\b(\d+-\d+(?:-\d+)?)\s+rolling\s+record\b/g, '$1 record over the last three weeks')
    // "151.9 PPG rolling average" / "82.1 PPG rolling" → "… PPG over the last three weeks"
    .replace(/\bPPG\s+rolling(?:\s+average)?\b/g, 'PPG over the last three weeks')
    // "a perfect 4-0 L3" → "a perfect 4-0 record over the last three weeks"
    .replace(/\b(an?|the|their|perfect|ugly|brutal|crisp|dominant)\s+(\d+-\d+(?:-\d+)?)\s+L3\b(?!\s+record)/g, '$1 $2 record over the last three weeks')
    // "2-1 L3 record" → "2-1 record over the last three weeks"
    .replace(/\b(\d+-\d+(?:-\d+)?)\s+L3\s+record\b/g, '$1 record over the last three weeks')
    // "2-1 L3" → "2-1 over the last three weeks"
    .replace(/\b(\d+-\d+(?:-\d+)?)\s+L3\b/g, '$1 over the last three weeks')
    // "131.5 PPG L3" → "131.5 PPG over the last three weeks"
    .replace(/\bPPG\s+L3\b/g, 'PPG over the last three weeks')
    // anything left: "their L3 record" → "their last-three record"
    .replace(/\bL3\b/g, 'last-three')
    // "over their last 3" → "over their last three"
    .replace(/\blast ([2-9])\b(?![.\d])/g, (_m, n) => `last ${NUMBER_WORDS[n]}`)
    // "a 2-2 record over the last three weeks and 112.2 PPG over the last
    // three weeks" says it once: keep only the clause's last one.
    .split(/(?<=[.;!?—])(?=\s)/)
    .map(dedupeWindow)
    .join('');
}

const WINDOW = ' over the last three weeks';
function dedupeWindow(clause) {
  const last = clause.lastIndexOf(WINDOW);
  if (last < 0 || clause.indexOf(WINDOW) === last) return clause;
  return clause.slice(0, last).split(WINDOW).join('') + clause.slice(last);
}
