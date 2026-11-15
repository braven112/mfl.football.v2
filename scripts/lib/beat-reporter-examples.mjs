/**
 * Max Insider's example bank — short sample deliveries in each of his style
 * lanes (src/utils/persona.mjs, BEAT_REPORTER_PERSONA).
 *
 * Why examples and not more adjectives: a model copies a demonstrated shape far
 * more reliably than a described one, and drawing a FEW at random for each
 * prompt is what keeps a feed from reading like a template (Brandon, Nov 2026:
 * "the goal is to have multiple ways of saying the same things").
 *
 * Rules for every entry:
 *   - Original writing in the STYLE of the seeds. Never a real reporter's post,
 *     name or catchphrase (tests/beat-reporter-examples.test.ts).
 *   - Placeholders only — [TEAM], [OWNER], [PLAYER], [N] — never a real or
 *     invented team name, so nothing in an example can leak into a post as a
 *     fact.
 *   - One delivery each, short. These show rhythm, not content.
 */

/** @typedef {'scoop' | 'numbers' | 'insider' | 'measured' | 'notebook' | 'hot-take'} BeatLane */

/** @type {Readonly<Record<BeatLane, readonly string[]>>} */
export const BEAT_EXAMPLES = Object.freeze({
  // The plain wire (seeded from posts Brandon shared, Nov 2026): the move,
  // stated flat, often in one line, sometimes with a few words of read.
  scoop: [
    '[TEAM] officially added [PLAYER].',
    '[TEAM] placed [PLAYER] on IR.',
    'Insurance for [TEAM], in case [PLAYER] cannot go Sunday.',
    'Help is on the way for [TEAM]...',
    '[TEAM] is adding [PLAYER], I\'m told. Done deal.',
    'Per a league source: [OWNER] has been working the phones all morning. Something is coming.',
    'Keep an eye on [TEAM]. Word around the league is they are not done.',
    'Sources close to the deal say [PLAYER] is on the move. More soon.',
  ],
  numbers: [
    '[TEAM] has dropped [N] of its last [N]. The schedule does not get easier: three of the next four opponents are top-ten scoring teams.',
    'The math on [TEAM]: [N] points behind the cut line with [N] weeks left. Every week from here is a must-win.',
    'Deal terms, as I understand them: [PLAYER] heads to [TEAM]. It fills the one hole in that lineup the rest of the league kept circling.',
    '[N] points. That is how much separated [TEAM] from a top seed last week. Thinnest margin in the league.',
  ],
  insider: [
    'Talked to people around [TEAM] this week. The mood is not panic. It is quieter than that, and that is worse.',
    '[OWNER] does not sit still after a loss. History says a move is coming before Sunday.',
    'One front office I trust put it plainly: nobody wants to see [TEAM] in the playoffs.',
    'You learn a lot about an owner by what they do after a bad week. [OWNER] went straight to the waiver wire.',
    // Front-office notebook seeds (posts Brandon shared, Nov 2026): context
    // on someone else's news, the plan going in, what people said.
    '[PLAYER], a former first-round pick, has had a real resurgence on [TEAM].',
    '[TEAM] wanted to get [PLAYER] 15 to 20 touches this week. Already at [N] by halftime.',
    '[OWNER] said the plan all along was to be patient with [PLAYER]. "I knew," came the answer, with a laugh.',
    '[PLAYER] is playing with confidence. Accurate, decisive, no hesitation.',
  ],
  measured: [
    '[PLAYER] is expected to miss time. The plan is to reassess next week, and [TEAM] will lean on depth until then.',
    'Not the news [TEAM] wanted. [PLAYER] is out this week, and the backup is the starter for now.',
    'The hope around [TEAM] is that this is short-term. Nothing is certain yet.',
  ],
  notebook: [
    'Notes from around the league:\n- [TEAM] is quietly the hottest team in its division.\n- [OWNER] has not made a move in a month. That will not last.\n- Watch the [TEAM] vs [TEAM] game. It decides a playoff spot.',
    'What I am hearing this week: front offices think the race is wide open, and three teams still believe they are buyers.',
    'From around the league:\n- [TEAM] preps for a must-win\n- [PLAYER] workload\n- [PLAYER] rejuvenated\n- [OWNER] eyes a complete week',
    'Three things that stood out:\n- [TEAM]\'s bench outscored two starting lineups.\n- [TEAM] is one bad week from trouble.\n- Nobody wants the last wild card. Somebody has to take it.',
  ],
  'hot-take': [
    'I am sorry, but benching [PLAYER] for THAT? Indefensible. [OWNER] knows better.',
    'This is not a slump. This is a crisis, and [TEAM] is pretending it is not.',
    'Let me be very clear: [TEAM] did not lose this week. [TEAM] gave it away.',
    // Seeded from posts Brandon shared (Nov 2026): the big question up top,
    // the honest verdict, the caller-show energy. Football only, always.
    'Can [TEAM] really replace [PLAYER]? I asked around, and the answer is NOT what [OWNER] wants to hear.',
    'Now let me be honest. I am no fan of what [TEAM] did on waivers this week.',
    'The gloves are OFF in [TEAM] vs [TEAM]. Somebody is leaving Sunday with a losing streak.',
    'I asked the league for its takes, the responses came in, and you KNOW I had something to say about [TEAM].',
  ],
});

/** Every lane, in a stable order. */
export const BEAT_LANES = /** @type {readonly BeatLane[]} */ (Object.freeze(Object.keys(BEAT_EXAMPLES)));

/**
 * Draw `count` examples from the bank. Lanes named in `lanes` are drawn first
 * (the news decides the style); the rest of the draw comes from any lane so
 * the post still has range. No example repeats within one draw.
 *
 * @param {{ lanes?: readonly BeatLane[], count?: number, random?: () => number }} [opts]
 * @returns {string[]}
 */
export function pickBeatExamples({ lanes = [], count = 3, random = Math.random } = {}) {
  const preferred = lanes.flatMap((lane) => BEAT_EXAMPLES[lane] ?? []);
  const rest = BEAT_LANES.filter((lane) => !lanes.includes(lane)).flatMap((lane) => BEAT_EXAMPLES[lane]);
  const draw = (/** @type {string[]} */ pool, /** @type {number} */ n) => {
    const copy = [...pool];
    const out = [];
    while (copy.length && out.length < n) out.push(copy.splice(Math.floor(random() * copy.length), 1)[0]);
    return out;
  };
  const first = draw(preferred, Math.min(count, preferred.length ? Math.max(1, count - 1) : 0));
  return [...first, ...draw(rest, count - first.length)];
}

/**
 * The prompt block that carries the drawn examples. Fenced as rhythm only:
 * a placeholder must never turn into a name, and nothing in an example is a
 * fact about this league.
 *
 * @param {string[]} examples
 */
export function beatExamplesBlock(examples) {
  if (!examples.length) return '';
  return `EXAMPLES OF YOUR DELIVERY (rhythm and attitude only: the bracketed words are placeholders, nothing here is a fact about this league, and you never copy a line. Write something new in a similar spirit):
${examples.map((e) => `* ${e.replace(/\n/g, '\n  ')}`).join('\n')}

`;
}

/**
 * Which lanes a news item draws its examples from — the news picks the style
 * (Brandon, Nov 2026), so an injury never gets the hot-take treatment and a
 * trade leads with its terms.
 *
 * @param {string} kind  An MFL transaction type, or an article type id.
 * @returns {BeatLane[]}
 */
export function lanesForNews(kind) {
  switch (kind) {
    case 'IR':
      return ['measured'];
    case 'TRADE':
      return ['numbers', 'scoop'];
    case 'BBID_WAIVER':
    case 'WAIVER':
      return ['scoop', 'insider'];
    case 'FREE_AGENT':
      return ['scoop'];
    case 'roster-list':
      return ['notebook'];
    case 'schedule-strength':
      return ['numbers', 'notebook'];
    case 'matchup-preview':
      return ['insider', 'notebook'];
    case 'pecking-order':
      return ['hot-take', 'numbers'];
    case 'cut-watch':
      return ['measured', 'numbers'];
    case 'waiver-pickups':
      return ['notebook', 'scoop'];
    default:
      return [];
  }
}

/**
 * How the persona's own most recent posts opened — the first few words of
 * each body, newest first, with every team name masked so the memory cannot
 * put a name in front of the model that the current payload did not
 * (docs/claude/rules/schefter.md, the 2026-09-07 leak).
 *
 * @param {Array<Record<string, any>>} posts  The league's feed posts.
 * @param {Iterable<string>} teamNames
 * @param {{ limit?: number, words?: number }} [opts]
 * @returns {string[]}
 */
export function recentPersonaOpeners(posts, teamNames, { limit = 6, words = 5 } = {}) {
  const names = [...teamNames].filter(Boolean).sort((a, b) => b.length - a.length);
  const mask = (/** @type {string} */ text) =>
    names.reduce((t, n) => t.split(n).join('[TEAM]'), text);
  const at = (/** @type {Record<string, any>} */ p) => {
    const t = Date.parse(p?.timestamp ?? '');
    return Number.isFinite(t) ? t : -Infinity;
  };
  return (Array.isArray(posts) ? [...posts] : [])
    .filter((p) => (!p.authorId || p.authorId === 'claude') && typeof p.body === 'string' && p.body.trim())
    .sort((a, b) => at(b) - at(a))
    .slice(0, limit)
    .map((p) => mask(p.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).split(' ').slice(0, words).join(' '));
}

/**
 * The persona's own recent columns, as links it may call back to ("As I
 * reported last week…"). Only real feed posts with a stored internal link are
 * offered, so the href is one the article-link sanitizer will accept as-is.
 *
 * @param {Array<Record<string, any>>} posts  The league's feed posts.
 * @param {{ now?: Date, days?: number, limit?: number, excludeId?: string }} [opts]
 * @returns {Array<{ href: string, label: string, callback: true, primary: false, promo: false, publishedAt: string }>}
 */
export function callbackLinks(posts, { now = new Date(), days = 21, limit = 3, excludeId } = {}) {
  const since = now.getTime() - days * 86_400_000;
  return (Array.isArray(posts) ? posts : [])
    .filter((p) => p?.type === 'article' && (!p.authorId || p.authorId === 'claude'))
    .filter((p) => typeof p.link === 'string' && p.link.startsWith('/') && p.id !== excludeId)
    .filter((p) => {
      const t = Date.parse(p.timestamp ?? '');
      return Number.isFinite(t) && t >= since && t <= now.getTime();
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit)
    .map((p) => ({
      href: p.link,
      label: String(p.headline ?? 'my last column'),
      callback: /** @type {const} */ (true),
      primary: /** @type {const} */ (false),
      promo: /** @type {const} */ (false),
      publishedAt: String(p.timestamp).slice(0, 10),
    }));
}
