/**
 * Franchise-name masking for the LLM's MEMORY block.
 *
 * The rolling "RECENT POSTS" block exists for one purpose: stop Schefter
 * reusing an opener, closer or bit he just used. It never needed the names in
 * those posts — and carrying them was a live leak. On 2026-09-07 a trade-offer
 * post named "Fire Ready Aim" beside Cyrus Allen, who is and always has been a
 * Bring the Pain player. The `exposure` payload could not have produced that
 * pairing: `buildExposure` only lists players off the named team's own side,
 * and `escalatedPlayer` is re-picked from that same side. The name came from
 * the memory block, where the previous three trade posts had all named Fire
 * Ready Aim, and nothing downstream checks the franchise a post actually
 * prints.
 *
 * Both scanners read ONE `post-history.json` — the transaction scanner writes
 * posts that name teams legitimately (a completed trade is public), and the
 * rumor scanner then reads them back as memory. So masking has to live in the
 * shared block builder rather than in either lane, or the rumor lane keeps
 * seeing names the transaction lane wrote.
 *
 * This masker is deliberately BLUNTER than the scanner's
 * `redactFranchiseNamesInText`. That one is scope-aware and has a
 * `keepFranchise` escape hatch, because a post is sometimes allowed to name
 * one team. The memory block is allowed to name NONE, so there is no keep
 * parameter here and nothing to get wrong at a call site.
 *
 * Over-matching is the safe direction: a false hit costs one word of an
 * anti-repetition hint, a miss puts another team's name in front of the model.
 */

/**
 * Build a list of EVERY name a franchise answers to — current forms
 * (long/medium/short/abbrev), config `aliases`, and the same four forms on
 * each retired name in `history[]`.
 *
 * Retired names count because a reader identifies a team by them just as
 * well as by the current name — and in the AFL better, since the punitive
 * last-place rebrands are recent and memorable. Harvesting only the current
 * four fields is what let a tipster's "Cock Gobbler" (The Show's 2025
 * rebrand) survive redaction and land in a post that was not allowed to name
 * a second team.
 *
 * Keeps tokens length-sorted descending so a regex alternation matches the
 * longest form first (e.g. "Nashville Geeks" wins over "Geeks").
 *
 * Lives here rather than in the rumor scanner so the scanner, the transaction
 * scanner and the memory-block masker all harvest names the same way. Five
 * copies of the ownership walk once existed in this repo and two silently
 * disagreed; one harvest is the lesson from that.
 */
export function collectFranchiseNameTokens(teams) {
  const tokens = new Set();
  const add = (v) => {
    if (typeof v === 'string' && v.trim().length >= 2) tokens.add(v.trim());
  };
  for (const team of teams.values()) {
    const history = Array.isArray(team?.history) ? team.history : [];
    // A history entry carries its own aliases — "Heavy Chevy" retired with
    // aliases ["Heavy", "Chevy"], and a nickname for a retired name identifies
    // the franchise exactly as well as the retired name itself. Reading them
    // off `team` only (the original shape) left those invisible to the
    // redactor, so a tip saying "Chevy" reached the prompt intact.
    for (const form of [team, ...history]) {
      for (const field of ['name', 'nameMedium', 'nameShort', 'abbrev']) {
        add(form?.[field]);
      }
      for (const alias of Array.isArray(form?.aliases) ? form.aliases : []) {
        add(alias);
      }
    }
  }
  return [...tokens].sort((a, b) => b.length - a.length);
}

/** What a masked franchise name becomes. Matches the scanner's redactor. */
export const MASKED_TEAM = '[a team]';

/**
 * A masker for `buildRecentPostsPromptBlock`'s `maskNames` option, or
 * `undefined` when this caller cannot mask safely.
 *
 * `redact` is INJECTED rather than implemented here, and that is the whole
 * point. The first cut of this file carried its own `\b`-anchored alternation,
 * which was wrong in both directions against the real config:
 *
 *   - It over-fired on ordinary prose, because it dropped the scanner's
 *     ambiguous-token relaxation. "Dead cap hell" became "[a team] hell",
 *     "a fire sale" became "a [a team] sale", "plenty of pain" became "plenty
 *     of [a team]" — turning the anti-repetition memory into noise and showing
 *     the model its own posts full of placeholders.
 *   - It under-fired on names with punctuation edges, because a plain `\b`
 *     cannot anchor against them. "The Blunt Bros." and "Lucky Buck$" — both
 *     real AFL history names — passed through unmasked, which is the leak this
 *     file exists to stop.
 *
 * `redactFranchiseNamesInText` already handles both (conditional edge guards,
 * flexible separators, `readsAsOrdinaryProse`, and a per-map cache). A second
 * implementation of name-matching is exactly the "five copies, two silently
 * disagreed" failure this repo already learned once.
 *
 * Returns `undefined` on an empty team map so the block builder DROPS the
 * bodies. `schefter-scan`'s `loadTeams` returns an empty Map on any config
 * read error, and an identity masker there would ship unmasked bodies — the
 * exact opposite of the fail-safe.
 */
export function memoryNameMasker(teams, redact) {
  if (!teams || typeof teams.size !== 'number' || teams.size === 0) return undefined;
  if (typeof redact !== 'function') return undefined;
  return (text) => redact(text, teams);
}

// ── Team tokens: the model never sees a franchise name ──
//
// Masking the memory block removed the leak PATH for the 2026-09-07 incident.
// This removes the CAPABILITY. The payload hands the model a token instead of
// "Bring the Pain", and the real name is substituted in code after generation
// — so naming the wrong franchise stops being forbidden and becomes
// unwritable. It cannot substitute a name it was never given.
//
// EVERY TOKEN CARRIES ITS FRANCHISE ID, and a former name carries a year as
// well. That is not decoration: a franchise identity in this league IS
// (franchiseId, year). Franchise 0003 is "Maverick" now, was "Generals" in
// 2014 and "Poker in the Rear" in 2012 and again in 2015 — the config's
// `history[]` entries are keyed by `yearStart`/`yearEnd` precisely so that
// pair resolves to exactly one name.
//
// The first cut used a bare `{{TEAM}}`, reasoning that only one team is ever
// nameable per post (HARD RULE 26) so there was only one substitution target.
// True for `exposure.team`, and it made the former-name callback impossible to
// tokenize: `formerName` is built for `scope.franchise` at two of its three
// call sites, which is not necessarily the exposure team, so a bare token
// there would have resolved to the WRONG franchise — inventing a fresh
// misattribution while closing an old one. Self-identifying tokens dissolve
// that: the token says which franchise it means, so correctness no longer
// rests on an invariant holding somewhere else in the file.
//
// Verification stays exact either way. A leftover `{{...}}` is a string match;
// checking whether prose names the right franchise means fuzzy-matching every
// name form, alias and retired name against text where `balls`, `feelers`,
// `herd`, `chat` and `swift` are all somebody's real short name.

/** `{{TEAM:0008}}` → that franchise's current full name. */
export const teamToken = (fid) => `{{TEAM:${fid}}}`;
/** `{{TEAM_SHORT:0008}}` → its short form, falling back to the full name. */
export const teamShortToken = (fid) => `{{TEAM_SHORT:${fid}}}`;
/** `{{TEAM_FORMER:0003:2014}}` → the name that franchise wore in that year. */
export const formerTeamToken = (fid, year) => `{{TEAM_FORMER:${fid}:${year}}}`;

/**
 * What `exposure.team` becomes in the LLM-facing payload.
 *
 * Two registers because the voice needs both — real posts read "Pain's been
 * shopping a tight end", not "Bring the Pain's been shopping a tight end".
 * One token would force a single form and flatten the cadence.
 */
export function tokenizedTeam(fid) {
  return { name: teamToken(fid), nameShort: teamShortToken(fid) };
}

/**
 * Tokenize a `buildFormerNameCallback` result in place, keeping `lastSeason`,
 * `punitive` and `phase` — those are facts the model reasons about, not names
 * it prints. `current` and `former` are the two it prints, so they become
 * tokens keyed to the franchise and (for the old name) the season it wore it.
 */
export function tokenizedFormerName(callback, fid, team) {
  if (!callback || fid == null) return callback;
  // Preserve the REGISTER the caller chose. `buildFormerNameCallback` takes
  // `currentName` as a parameter, and its call sites pass different forms —
  // the scope's franchise label is often the short one. Always emitting the
  // full-name token would silently rewrite "Dead Cap — the former Heavy Chevy"
  // into "Dead Cap Walking — the former Heavy Chevy": still the right
  // franchise, but not the words the caller picked.
  const current = String(callback.current ?? '').trim().toLowerCase();
  const short = String(team?.nameShort ?? '').trim().toLowerCase();
  const useShort = short.length > 0 && current === short;
  return {
    ...callback,
    current: useShort ? teamShortToken(fid) : teamToken(fid),
    former: formerTeamToken(fid, callback.lastSeason),
  };
}

/** The name a franchise wore in `year`, from its `history[]` era rows. */
function historicalName(team, year) {
  const history = Array.isArray(team?.history) ? team.history : [];
  const era = history.find((h) => {
    const start = Number(h?.yearStart);
    const end = Number(h?.yearEnd);
    return Number.isFinite(start) && Number.isFinite(end) && year >= start && year <= end;
  });
  const name = era?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/**
 * Substitute real franchise names into a generated body.
 *
 * Takes the TEAMS MAP, not one team — every token names its own franchise, so
 * resolution is a lookup rather than an assumption about which team the post
 * is about.
 *
 * Returns `{ text, unresolved }`. `unresolved` is true when any `{{...}}`
 * survives: the model inventing `{{TEAM_NICKNAME}}`, a franchise id not in the
 * map, or a year no era row covers. The caller MUST treat that as a failed
 * generation — a literal `{{TEAM:0008}}` reaching the group chat is worse than
 * the bug this replaces.
 */
export function resolveTeamTokens(text, teams) {
  if (typeof text !== 'string' || text.length === 0) {
    return { text, unresolved: false };
  }
  const get = (fid) => (teams && typeof teams.get === 'function' ? teams.get(fid) : null);

  // FORMER first: `{{TEAM_FORMER:...}}` would otherwise be left half-eaten by
  // a looser current-name pattern. Fresh regexes per call — a shared /g regex
  // carries `lastIndex` between calls.
  let out = text.replace(/\{\{TEAM_FORMER:(\d{4}):(\d{4})\}\}/g, (m, fid, year) => (
    historicalName(get(fid), Number(year)) ?? m
  ));

  out = out.replace(/\{\{TEAM(_SHORT)?:(\d{4})\}\}/g, (m, short, fid) => {
    const team = get(fid);
    const name = typeof team?.name === 'string' && team.name.trim() ? team.name.trim() : null;
    if (!name) return m;
    if (!short) return name;
    const nameShort = typeof team?.nameShort === 'string' && team.nameShort.trim()
      ? team.nameShort.trim()
      : name;
    return nameShort;
  });

  // ANY stray brace pair, not just a well-formed `{{...}}`. The model
  // mangling one edge — `{{TEAM_SHORT:0008}` — left a balanced-pair test
  // reporting unresolved:false, so the literal markup shipped to the feed and
  // GroupMe: the outcome the beat loop calls worse than the bug this replaces.
  // Schefter prose never legitimately contains `{{` or `}}`, and erring toward
  // "unresolved" only costs a template fallback.
  return { text: out, unresolved: /\{\{|\}\}/.test(out) };
}
