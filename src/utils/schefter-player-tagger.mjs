/**
 * Schefter player tagger — attach MFL player ids to posts that only name
 * players in prose.
 *
 * Why: the transaction lanes stamp `playerIds` from MFL's own transaction
 * strings, but the ESPN wire (most of the feed), the rumor mill, articles and
 * Ask Roger only ever mention a player by name. My Watch List needs the id to
 * say "this post is about someone you watch", so this pass reads each post's
 * text and resolves full names against the league's players export.
 *
 * Rules (each one is a false positive that has bitten a name matcher here):
 *
 * - **Full names only, never a bare last name.** The wire scorer once matched
 *   last names and tagged coaches and executives who shared one with a
 *   rostered player (schefter-scan.mjs, `loadRosteredPlayerNames`). A first
 *   AND last name is the floor; a one-word name is never indexed.
 * - **Ambiguous names: filter by what the text says, else tag every match.**
 *   Two Josh Allens both get tagged unless the post names a position or an
 *   NFL team that rules one out ("Bills quarterback Josh Allen" tags the QB).
 *   Tagging both is the safe direction for a highlight: the owner watching
 *   the other one sees a post that is not about him, which is a shrug; a
 *   miss is a post he never sees.
 * - **Team defenses and team-slot pseudo-players are never indexed.** Their
 *   MFL "names" are NFL teams ("Bills, Buffalo"), which appear in prose
 *   constantly and would tag every Bills story with the Bills DEF.
 * - **Existing ids win.** A post that already carries `playerIds` from a
 *   transaction is only ever ADDED to, and its first id — the hero id the OG
 *   composite reads — stays first.
 * - **Omit the key when empty.** `writeJsonIfChanged` is semantic, so adding
 *   `playerIds: []` to 700 posts would be a 700-post diff for nothing.
 *
 * Plain .mjs: the tagging runs in a cron (`scripts/schefter-tag-players.mjs`)
 * and the same matcher backs the unit tests, so it has no TypeScript-only
 * imports.
 */

/** Positions whose MFL "players" are teams or slots, not people. */
const NON_PERSON_POSITIONS = new Set([
  'DEF', 'Def', 'ST', 'Off', 'Coach', 'XX',
  'TMQB', 'TMRB', 'TMWR', 'TMTE', 'TMPK', 'TMPN', 'TMDL', 'TMLB', 'TMDB',
]);

/** Words in a story that name a position. Keyed by the MFL position code. */
const POSITION_WORDS = {
  QB: ['qb', 'quarterback', 'quarterbacks'],
  RB: ['rb', 'running back', 'running backs', 'halfback', 'tailback'],
  WR: ['wr', 'wide receiver', 'wide receivers', 'receiver', 'wideout'],
  TE: ['te', 'tight end', 'tight ends'],
  PK: ['pk', 'kicker', 'placekicker'],
  PN: ['punter'],
  DE: ['de', 'defensive end', 'edge rusher', 'pass rusher'],
  DT: ['dt', 'defensive tackle', 'nose tackle'],
  LB: ['lb', 'linebacker', 'linebackers'],
  CB: ['cb', 'cornerback', 'cornerbacks', 'corner'],
  S: ['safety', 'safeties'],
};

/** NFL team code → the words a story uses for that team. Codes as MFL emits them. */
const TEAM_WORDS = {
  ARI: ['arizona', 'cardinals'], ATL: ['atlanta', 'falcons'], BAL: ['baltimore', 'ravens'],
  BUF: ['buffalo', 'bills'], CAR: ['carolina', 'panthers'], CHI: ['chicago', 'bears'],
  CIN: ['cincinnati', 'bengals'], CLE: ['cleveland', 'browns'], DAL: ['dallas', 'cowboys'],
  DEN: ['denver', 'broncos'], DET: ['detroit', 'lions'], GBP: ['green bay', 'packers'],
  HOU: ['houston', 'texans'], IND: ['indianapolis', 'colts'], JAC: ['jacksonville', 'jaguars'],
  KCC: ['kansas city', 'chiefs'], LAC: ['chargers'], LAR: ['rams'], LVR: ['las vegas', 'raiders'],
  MIA: ['miami', 'dolphins'], MIN: ['minnesota', 'vikings'], NEP: ['new england', 'patriots'],
  NOS: ['new orleans', 'saints'], NYG: ['giants'], NYJ: ['jets'], PHI: ['philadelphia', 'eagles'],
  PIT: ['pittsburgh', 'steelers'], SEA: ['seattle', 'seahawks'], SFO: ['san francisco', '49ers', 'niners'],
  TBB: ['tampa bay', 'tampa', 'buccaneers', 'bucs'], TEN: ['tennessee', 'titans'],
  WAS: ['washington', 'commanders'],
};

/** Alternate codes seen in MFL data, folded onto the keys above. */
const TEAM_ALIASES = {
  GB: 'GBP', KC: 'KCC', JAX: 'JAC', LV: 'LVR', NE: 'NEP', NO: 'NOS', SF: 'SFO', TB: 'TBB', WSH: 'WAS',
  OAK: 'LVR', SD: 'LAC', STL: 'LAR',
};

/** Lowercase, drop punctuation except hyphens, collapse whitespace, drop suffixes. */
export function normalizeProse(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/g, ' ')
    .replace(/[’‘`']/g, '')
    .replace(/[^a-z0-9\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Last, First" → normalized "first last", minus generational suffixes. */
export function normalizeMflName(mflName) {
  const raw = String(mflName ?? '');
  const parts = raw.split(', ');
  const display = parts.length === 2 ? `${parts[1]} ${parts[0]}` : raw;
  return normalizeProse(display).replace(/\s+(jr|sr|ii|iii|iv|v)$/, '').trim();
}

/**
 * Build the name index from a players export (`players.player[]`).
 *
 * @returns {{ byName: Map<string, Array<{id:string, position:string, team:string}>>, maxWords: number }}
 */
export function buildPlayerNameIndex(players) {
  const rows = Array.isArray(players) ? players : players ? [players] : [];
  const byName = new Map();
  let maxWords = 2;
  for (const p of rows) {
    if (!p?.id || !p?.name) continue;
    const position = String(p.position ?? '');
    if (NON_PERSON_POSITIONS.has(position)) continue;
    const key = normalizeMflName(p.name);
    // A person has a first and a last name; anything shorter is not indexed.
    const words = key.split(' ').filter(Boolean);
    if (words.length < 2) continue;
    maxWords = Math.max(maxWords, words.length);
    const list = byName.get(key) ?? [];
    list.push({ id: String(p.id), position, team: String(p.team ?? '') });
    byName.set(key, list);
  }
  return { byName, maxWords };
}

function canonicalTeam(code) {
  const upper = String(code ?? '').toUpperCase();
  return TEAM_ALIASES[upper] ?? upper;
}

/** Which position codes and team codes the (normalized) text mentions. */
function detectHints(normalized) {
  const padded = ` ${normalized} `;
  const positions = new Set();
  for (const [code, words] of Object.entries(POSITION_WORDS)) {
    if (words.some((w) => padded.includes(` ${w} `))) positions.add(code);
  }
  const teams = new Set();
  for (const [code, words] of Object.entries(TEAM_WORDS)) {
    if (words.some((w) => padded.includes(` ${w} `))) teams.add(code);
  }
  return { positions, teams };
}

/**
 * Resolve every player named in `text`.
 *
 * Ambiguity: when one name maps to several players, keep only those whose
 * position OR team the text also mentions; if that rules out everyone, or
 * the text mentions neither, keep them all.
 *
 * @returns {string[]} MFL ids in order of first mention
 */
export function findPlayerIdsInText(text, index) {
  const normalized = normalizeProse(text);
  if (!normalized) return [];
  const words = normalized.split(' ');
  const hints = detectHints(normalized);
  const found = [];
  const seen = new Set();

  for (let i = 0; i < words.length; i++) {
    for (let len = index.maxWords; len >= 2; len--) {
      if (i + len > words.length) continue;
      const candidate = words.slice(i, i + len).join(' ');
      const matches = index.byName.get(candidate);
      if (!matches) continue;
      let chosen = matches;
      if (matches.length > 1 && (hints.positions.size || hints.teams.size)) {
        const narrowed = matches.filter(
          (m) => hints.positions.has(m.position) || hints.teams.has(canonicalTeam(m.team)),
        );
        if (narrowed.length > 0) chosen = narrowed;
      }
      for (const m of chosen) {
        if (!seen.has(m.id)) { seen.add(m.id); found.push(m.id); }
      }
      i += len - 1; // consume the name
      break;
    }
  }
  return found;
}

/** The prose a post carries, in one string. Articles keep `content` as HTML. */
export function postText(post) {
  return [post?.headline, post?.body, post?.content].filter(Boolean).join(' \n ');
}

/**
 * Tag one post. Returns a NEW post object when ids were added, or the same
 * object when nothing changed — callers diff by identity.
 */
export function tagPost(post, index) {
  if (!post || typeof post !== 'object') return post;
  // GroupMe messages are owner chatter, not news; leave them alone.
  if (post.type === 'groupme') return post;
  const existing = Array.isArray(post.playerIds) ? post.playerIds.map(String) : [];
  const named = findPlayerIdsInText(postText(post), index);
  const merged = [...existing];
  for (const id of named) if (!merged.includes(id)) merged.push(id);
  if (merged.length === existing.length) return post;
  return { ...post, playerIds: merged };
}

/**
 * Tag every post in a feed. Returns `{ feed, changed }` where `feed` is the
 * same object when nothing changed.
 */
export function tagFeed(feed, index) {
  const posts = Array.isArray(feed?.posts) ? feed.posts : [];
  let changed = 0;
  const next = posts.map((p) => {
    const tagged = tagPost(p, index);
    if (tagged !== p) changed++;
    return tagged;
  });
  if (changed === 0) return { feed, changed };
  return { feed: { ...feed, posts: next }, changed };
}
