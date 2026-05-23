/**
 * Schefter Lore Loader — shared helper for both scanner scripts.
 *
 * Loads the four lore files under data/schefter/ ONCE per scanner run and
 * assembles a single system prompt that can be appended to the legacy inline
 * prompt. Also owns post-history read/append/prune and opener/closer/bit
 * detection heuristics used to tag each post.
 *
 * Design goals:
 *   - Idempotent: load files once, cache on the module.
 *   - Graceful: if any file is missing/unreadable, log a warning and return
 *     a null section so the caller can fall back to legacy inline prompts.
 *   - Salt-not-sugar: the assembled prompt includes the explicit frequency
 *     ceiling directive so the LLM errs toward NO lore callback.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const LORE_DIR = path.join(projectRoot, 'data', 'schefter');
const PERSONALITY_PATH = path.join(LORE_DIR, 'personality.md');
const LEAGUE_LORE_PATH = path.join(LORE_DIR, 'league-lore.md');
const RUNNING_BITS_PATH = path.join(LORE_DIR, 'running-bits.md');
const POST_HISTORY_PATH = path.join(LORE_DIR, 'post-history.json');

const MAX_HISTORY_ENTRIES = 30;
const RECENT_POSTS_FOR_PROMPT = 5;

const SALT_NOT_SUGAR_DIRECTIVE = `\n## SALT-NOT-SUGAR RULE (read this first)

Most posts should be clean Schefter-voice reportage. Running bits are GARNISH,
not the meal. At most 1-in-8 posts overall should contain ANY lore callback
(founding father, office crew, ringless commish, Wabbit Index, camera's rolling,
etc.). When in doubt, SKIP THE BIT. A post with zero bits is a GOOD post.

Every running bit in the RUNNING BITS section has an explicit frequency
ceiling (1-in-15, 1-in-20, 1-in-25, 1-in-30, 1-in-40). Do NOT invoke a bit
unless it genuinely fits the tip data AND you roll under its ceiling. You
cannot "force" personality — it emerges over many posts, not within any one.

If you can't decide whether a bit fits, it doesn't fit. Write straight.
`;

// ── Personality catalog — phrase lists for detection heuristics ──
// Kept in sync with data/schefter/personality.md and running-bits.md. If those
// files gain new openers/closers/winks, update this table too. Detection is
// case-insensitive substring match — loose by design.

const OPENERS = [
  "I'm told",
  'Hearing',
  'Per source',
  'Sources tell me',
  'League sources',
  'Quietly',
  'Breaking:',
  'No surprise, but',
  'As expected',
  'One to watch',
  "File this under 'developing'",
  'Plenty of chatter about',
  'Plenty of noise around',
];

const CLOSERS = [
  'Developing.',
  'More to come.',
  'Stay tuned.',
  "We'll see.",
  'Here we go.',
  'One to watch.',
  'Hat tip to the tipster.',
  'Wow.',
  "That's the update.",
];

const BOT_WINKS = [
  'I see all the phones',
  'My sources have IP addresses',
  'read the group chat in 0.3 seconds',
  'ghost in the machine',
  "I don't sleep",
  'Half my sources are timestamps',
  "Can't hide from Claude",
  'Redis connection',
  'I remember everything',
  'The algorithm noticed',
  "Even Roger doesn't know",
  'My sources have sources',
  'Claude sees what Claude sees',
];

// Phrase fragments derived from running-bits.md. Loose substring match.
const LORE_CALLBACK_PHRASES = [
  'Wabbit Index',
  "Wabbit's back",
  'Wabbit workshopping',
  'Classic January behavior',
  'Classic February behavior',
  'Classic March behavior',
  'Classic April behavior',
  'Classic May behavior',
  'Classic June behavior',
  'Classic July behavior',
  'Classic August behavior',
  'Classic September behavior',
  'Classic October behavior',
  'Classic November behavior',
  'Classic December behavior',
  "commish's desk",
  'Commish clock',
  'Two bots, different beats',
  'Still new at this',
  'DCW learning',
  "Vit's still here",
  'One of the originals',
  '14 years in',
  'Back on camera',
  'cameras never really left',
  'Reigning champs',
  'Defending title',
  'Still looking for that first one',
  'Playoff ghosts',
  'shipped another feature',
  'built a trade-rumor bot',
  'rebuild mode',
  'Another rebuild year',
  'Monday meetings',
  'breakroom',
  'Fire Ready Aim',
  'Ready, Fire, Aim',
  'founding father',
  'Squeaky wheel gets the tampering fine',
  'style book',
  'Learning your style',
  'learning your patterns',
  'dossier compiles',
  'scouting report on',
  'Every denial is a data point',
  'file just got thicker',
  'algorithm\'s taking notes',
];

// Hostile-tip reframe detection — telemetry only. Records WHICH frame the
// LLM picked when working a hostile tip into the post, so we can spot
// overuse of any one mode after a few cycles of live output and tune the
// HARD RULES / running bits accordingly.
//
// Detection is by substring match on the post body. Priority order matters:
// style-book is the most structurally specific, then intra-division, then
// reverse-lens (the redirect-to-tipster framing), then rivalry (named beef),
// and finally league-office (the institutional softener). First match wins.
//
// Any line not matching any pattern returns reframeMode === '' — the typical
// case for a routine, non-hostile post. False positives are tolerated; the
// signal we care about is direction-of-trend across many posts, not perfect
// per-post classification.
const REFRAME_PATTERNS = [
  {
    mode: 'style-book',
    phrases: [
      'style book',
      'dossier',
      'the file grows',
      "file's getting thick",
      "scouting report on",
      'denial is a data point',
      "every shot's a data point",
      'adding that to the file',
      'algorithm noticed',
      "algorithm's taking notes",
      'every denial',
      'power user of the style book',
      'entries deep on',
      'first entry in the style book',
      'second entry in the style book',
      'third shot',
      'first shot',
      'noted, ',
      'filed.',
      'the file',
    ],
  },
  {
    mode: 'intra-division',
    phrases: [
      'developing some strong rivalries',
      'beef brewing inside',
      'rivalries heating up in',
      'most personal division',
      'most personal corner',
      'is the most personal',
    ],
  },
  {
    mode: 'reverse-lens',
    phrases: [
      "an owner in the northwest isn't",
      "an owner in the southwest isn't",
      "an owner in the central isn't",
      "an owner in the east isn't",
      'an owner in the northwest is fed up',
      'an owner in the southwest is fed up',
      'an owner in the central is fed up',
      'an owner in the east is fed up',
      'an owner in the northwest has opinions',
      'an owner in the southwest has opinions',
      'an owner in the central has opinions',
      'an owner in the east has opinions',
      'somebody in the northwest is fed up',
      'somebody in the southwest is fed up',
      'somebody in the central is fed up',
      'somebody in the east is fed up',
    ],
  },
  {
    mode: 'rivalry',
    phrases: [
      'bad blood between',
      'feud heats up',
      'feud escalates',
      'feud just got',
      'rivalry just got real',
      'rivalry escalates',
      'long memories',
      'the rivalry heats',
    ],
  },
  {
    mode: 'league-office',
    phrases: [
      'league office',
      'front office',
      "commissioner's office",
      "commissioner's patience",
      "the office is catching",
      "office has heat",
    ],
  },
];

// ── File loading (cached) ──

let _cache = null;

async function readLoreFile(filePath, label) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return { ok: true, text: raw, chars: raw.length, label };
  } catch (err) {
    return { ok: false, error: err.message, label };
  }
}

/**
 * Load personality + league-lore + running-bits once per run. Returns an
 * object describing what was loaded and (when successful) the assembled
 * system-prompt-suffix ready to append to legacy inline prompts.
 *
 * If ANY file fails to load we return { ok: false, warnings: [...] } so the
 * caller can fall back to their legacy inline prompt without crashing.
 */
export async function loadLore({ log = console.log, warn = console.warn } = {}) {
  if (_cache) return _cache;

  const [personality, lore, bits] = await Promise.all([
    readLoreFile(PERSONALITY_PATH, 'personality.md'),
    readLoreFile(LEAGUE_LORE_PATH, 'league-lore.md'),
    readLoreFile(RUNNING_BITS_PATH, 'running-bits.md'),
  ]);

  const warnings = [];
  for (const f of [personality, lore, bits]) {
    if (!f.ok) warnings.push(`[schefter-lore] ${f.label} unreadable: ${f.error}`);
  }

  if (!personality.ok || !lore.ok || !bits.ok) {
    for (const w of warnings) warn(w);
    warn('[schefter-lore] falling back to legacy inline prompt (one or more lore files missing)');
    _cache = { ok: false, warnings };
    return _cache;
  }

  const assembledSuffix =
    '\n\n## PERSONALITY\n\n' + personality.text.trim() +
    '\n\n## LEAGUE LORE\n\n' + lore.text.trim() +
    '\n\n## RUNNING BITS\n\n' + bits.text.trim() +
    SALT_NOT_SUGAR_DIRECTIVE;

  log(
    `[prompt] loaded personality (${formatChars(personality.chars)}), ` +
      `lore (${formatChars(lore.chars)}), bits (${formatChars(bits.chars)})`,
  );

  _cache = {
    ok: true,
    personality,
    lore,
    bits,
    assembledSuffix,
    totalChars: personality.chars + lore.chars + bits.chars + SALT_NOT_SUGAR_DIRECTIVE.length,
  };
  return _cache;
}

function formatChars(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k chars`;
  return `${n} chars`;
}

// ── Post history ──

/**
 * Read post-history.json. Always returns a valid structure; if the file is
 * missing or malformed we log once and return an empty list.
 */
export async function loadPostHistory({ log = console.log, warn = console.warn } = {}) {
  try {
    const raw = await fs.readFile(POST_HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.posts)) {
      warn('[schefter-lore] post-history.json has no posts array — treating as empty');
      return { raw: parsed ?? {}, posts: [] };
    }
    return { raw: parsed, posts: parsed.posts };
  } catch (err) {
    warn(`[schefter-lore] post-history.json unreadable (${err.message}) — treating as empty`);
    return { raw: null, posts: [] };
  }
}

/**
 * Build the "RECENT POSTS" block for the user prompt. Returns a string
 * suitable for concatenation into the user message. Empty string when history
 * is empty.
 */
export function buildRecentPostsPromptBlock(posts, { limit = RECENT_POSTS_FOR_PROMPT } = {}) {
  if (!posts || posts.length === 0) return '';

  const recent = posts.slice(-limit);
  const openers = new Set();
  const closers = new Set();
  const bodies = [];

  for (const p of recent) {
    if (p.openerUsed) openers.add(p.openerUsed);
    if (p.closerUsed) closers.add(p.closerUsed);
    if (p.body) bodies.push(`- (${p.subject ?? 'post'}) ${p.body.replace(/\s+/g, ' ').trim()}`);
  }

  const forbiddenOpeners = Array.from(openers).filter(Boolean);
  const forbiddenClosers = Array.from(closers).filter(Boolean);

  const sections = [];
  sections.push(
    `RECENT POSTS (do not repeat these openers, closers, or bits):\n${bodies.join('\n')}`,
  );
  if (forbiddenOpeners.length > 0) {
    sections.push(
      `Do not use these openers (recently used): ${forbiddenOpeners.map((o) => `"${o}"`).join(', ')}`,
    );
  }
  if (forbiddenClosers.length > 0) {
    sections.push(
      `Do not use these closers (recently used): ${forbiddenClosers.map((c) => `"${c}"`).join(', ')}`,
    );
  }
  return sections.join('\n\n');
}

// ── Detection heuristics ──

function firstSubstringMatch(haystack, needles) {
  if (!haystack) return '';
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    if (lower.includes(n.toLowerCase())) return n;
  }
  return '';
}

function anySubstringMatch(haystack, needles) {
  return Boolean(firstSubstringMatch(haystack, needles));
}

/**
 * Detect which hostile-tip reframe (if any) the LLM used in the body. Returns
 * the highest-priority match or '' if no frame phrase was found. See
 * REFRAME_PATTERNS for the priority order and the per-mode phrase list.
 *
 * Telemetry only — used by tagPost() to write `reframeMode` into post-history
 * so we can spot overuse and tune frequencies after enough live output.
 */
export function detectReframeMode(body) {
  if (!body || typeof body !== 'string') return '';
  const lower = body.toLowerCase();
  for (const { mode, phrases } of REFRAME_PATTERNS) {
    for (const p of phrases) {
      if (lower.includes(p.toLowerCase())) return mode;
    }
  }
  return '';
}

/**
 * Tag a generated post against the personality catalogs. Returns detection
 * fields ready to merge into a post-history entry. All detections are best-
 * effort; an empty string / false means "we didn't recognize this" — that's
 * fine and not an error.
 */
export function tagPost(body) {
  if (!body || typeof body !== 'string') {
    return {
      openerUsed: '',
      closerUsed: '',
      hadBotWink: false,
      hadLoreCallback: false,
      reframeMode: '',
    };
  }

  // Opener: look at the first sentence only.
  const firstSentence = body.split(/(?<=[.!?])\s+/)[0] ?? body;
  const openerUsed = firstSubstringMatch(firstSentence, OPENERS);

  // Closer: look at the last sentence only.
  const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
  const lastSentence = sentences[sentences.length - 1] ?? body;
  const closerUsed = firstSubstringMatch(lastSentence, CLOSERS);

  return {
    openerUsed,
    closerUsed,
    hadBotWink: anySubstringMatch(body, BOT_WINKS),
    hadLoreCallback: anySubstringMatch(body, LORE_CALLBACK_PHRASES),
    reframeMode: detectReframeMode(body),
  };
}

/**
 * Append one post entry to post-history.json, prune to MAX_HISTORY_ENTRIES
 * (keeping the most recent). Writes the file with trailing newline for git
 * friendliness.
 *
 * Never throws — on any failure, logs a warning and returns false. The
 * scanner should not crash because history couldn't be written.
 */
export async function appendPostHistory(entry, { log = console.log, warn = console.warn } = {}) {
  try {
    const { raw, posts } = await loadPostHistory({ log, warn });
    const next = Array.isArray(posts) ? [...posts, entry] : [entry];
    // Keep newest MAX_HISTORY_ENTRIES
    const pruned = next.slice(-MAX_HISTORY_ENTRIES);

    const output = {
      ...(raw && typeof raw === 'object' ? raw : {}),
      posts: pruned,
    };
    // Preserve schema doc fields if present but ensure posts is last for readability
    if (output._description === undefined) {
      output._description =
        "Rolling history of Claude Schefter's recent posts. Used to prevent repetition and enable callbacks.";
    }

    await fs.writeFile(POST_HISTORY_PATH, JSON.stringify(output, null, 2) + '\n');
    log(`[history] appended post to post-history.json (total: ${pruned.length})`);
    return true;
  } catch (err) {
    warn(`[schefter-lore] appendPostHistory failed: ${err.message}`);
    return false;
  }
}

/**
 * Convenience: build a complete post-history entry from the generated body
 * plus caller-supplied metadata. Detection heuristics are applied here.
 */
export function buildHistoryEntry({ id, timestamp, body, subject, tipSources }) {
  const tags = tagPost(body);
  return {
    id,
    timestamp: timestamp ?? new Date().toISOString(),
    body,
    subject: subject ?? '',
    openerUsed: tags.openerUsed,
    closerUsed: tags.closerUsed,
    hadBotWink: tags.hadBotWink,
    hadLoreCallback: tags.hadLoreCallback,
    reframeMode: tags.reframeMode,
    tipSources: Array.isArray(tipSources) ? tipSources : [],
  };
}

export const _internals = {
  OPENERS,
  CLOSERS,
  BOT_WINKS,
  LORE_CALLBACK_PHRASES,
  REFRAME_PATTERNS,
  MAX_HISTORY_ENTRIES,
  RECENT_POSTS_FOR_PROMPT,
  SALT_NOT_SUGAR_DIRECTIVE,
  PATHS: { PERSONALITY_PATH, LEAGUE_LORE_PATH, RUNNING_BITS_PATH, POST_HISTORY_PATH },
};
