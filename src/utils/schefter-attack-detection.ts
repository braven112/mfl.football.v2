/**
 * Schefter attack detection — TypeScript port for the web tip API surface.
 *
 * Mirrors `detectAttackOnSchefter` in scripts/schefter-groupme-listen.mjs so
 * web tips and GroupMe mentions run through identical classification. A
 * parity test (`tests/schefter-attack-detection-parity.test.ts`) pins the
 * two copies to each other — if one side changes, the test fails.
 *
 * Intentionally duplicated (not imported) because the .mjs listener is a
 * pure-Node script that can't reach into `src/utils/*.ts` without a build
 * step. Small enough that duplication + parity test beats the complexity
 * of shared tooling.
 *
 * Keep the pejorative list, subject patterns, negation tokens, and Roger
 * disambiguation rules IN SYNC with the .mjs version. If you add a new
 * keyword or rule here, add it there too — the parity test will tell you
 * if you forgot.
 */

const ATTACK_PEJORATIVES = [
  'sucks',
  'suck',
  'bitch',
  'hack',
  'trash',
  'garbage',
  'dumb',
  'stupid',
  'fake',
  'wrong',
  'useless',
  'lame',
  'clown',
  'joke',
  'idiot',
  'moron',
  'fraud',
  'bullshit',
  'bullshitter',
  'liar',
  'lies',
  'worst',
  'terrible',
  'awful',
  'pathetic',
];

const ATTACK_SUBJECT_PATTERNS = [
  /\bclaude\s+schefter\b/i,
  /\bschefter\b/i,
  /\bschefty\b/i,
  /\bclaude\b/i,
  /\bthe\s+bot\b/i,
  /\bthis\s+bot\b/i,
  /\bthat\s+bot\b/i,
];

const NEGATION_WINDOW_WORDS = 2;
const NEGATION_TOKENS = new Set([
  'not',
  "isn't",
  "ain't",
  'aint',
  'never',
  "wasn't",
  'no',
  "doesn't",
  'doesnt',
]);

// Roger disambiguation — if the only bot mention is a generic "the bot" /
// "this bot" / "that bot" AND Roger is named anywhere in the message, we
// punt. Same rule as the GroupMe listener.
const ROGER_GUARD_RE = /\b(?:roger|ask\s+roger|the\s+roger\s+bot|roger's\s+bot)\b/i;
const EXPLICIT_SCHEFTER_RE = /\b(?:claude|schefter|schefty)\b/i;
const GENERIC_BOT_RE = /\b(?:the|this|that)\s+bot\b/i;

export type AttackDetectionResult =
  | { attack: true; keyword: string; reason: 'pejorative-match' }
  | { attack: false; reason: string };

export function detectAttackOnSchefter(rawText: string | null | undefined): AttackDetectionResult {
  if (!rawText || typeof rawText !== 'string') {
    return { attack: false, reason: 'no-text' };
  }
  const text = rawText.trim();
  if (text.length < 5) {
    return { attack: false, reason: 'too-short' };
  }

  const subjectMatch = ATTACK_SUBJECT_PATTERNS.some((re) => re.test(text));
  if (!subjectMatch) {
    return { attack: false, reason: 'no-subject' };
  }

  const mentionsRoger = ROGER_GUARD_RE.test(text);
  const explicitSchefterRef = EXPLICIT_SCHEFTER_RE.test(text);
  const mentionsGenericBot = GENERIC_BOT_RE.test(text);
  if (mentionsRoger && mentionsGenericBot && !explicitSchefterRef) {
    return { attack: false, reason: 'generic-bot-with-roger-context' };
  }

  const lowerTokens = text
    .toLowerCase()
    .replace(/[^\w'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (let i = 0; i < lowerTokens.length; i++) {
    const tok = lowerTokens[i];
    if (!ATTACK_PEJORATIVES.includes(tok)) continue;

    let negated = false;
    for (let j = Math.max(0, i - NEGATION_WINDOW_WORDS); j < i; j++) {
      if (NEGATION_TOKENS.has(lowerTokens[j])) {
        negated = true;
        break;
      }
    }
    if (negated) continue;

    return { attack: true, keyword: tok, reason: 'pejorative-match' };
  }

  return { attack: false, reason: 'no-pejorative' };
}

export const _internals = {
  ATTACK_PEJORATIVES,
  ATTACK_SUBJECT_PATTERNS,
  NEGATION_TOKENS,
  ROGER_GUARD_RE,
  EXPLICIT_SCHEFTER_RE,
  GENERIC_BOT_RE,
};
