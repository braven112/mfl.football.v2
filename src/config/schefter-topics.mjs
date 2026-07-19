/**
 * Schefter tip topics — single source of truth.
 *
 * Drives, from ONE place:
 *   - the tip form's <option> list, labels, and rotating placeholders
 *   - API validation (src/pages/api/schefter/tip.ts)
 *   - hot-topics timeline iteration (src/pages/api/schefter/hot-topics.ts)
 *   - the rumor scanner's per-topic prompt cases and naming policies
 *     (scripts/schefter-rumor-scan.mjs asserts at startup that every id
 *     here has prompt handling — a new topic can't silently fall through)
 *
 * The taxonomy models real NFL insider churn: the stuff rival owners/GMs
 * leak about OTHER teams — motive-reading, leverage-reading, weakness-
 * spotting — not self-reported news.
 *
 * Naming-policy semantics (consumed by the scanner's anonymizer):
 *   - 'standard'           : existing rules — multi-source or explicit-pick
 *                            (within the naming rate limit) may name.
 *   - 'explicit-pick-only' : only a deliberate dropdown pick may ever name;
 *                            multi-source corroboration does NOT unlock
 *                            naming. Used for accusation-shaped topics.
 *   - 'never'              : the post never names a franchise, regardless
 *                            of sourcing. Scope stays league-wide/tier-wide.
 *
 * `mandatoryHedge` forces a hedge clause ("nothing confirmed", "take it for
 * what it's worth") on EVERY post from the topic, not just named ones.
 *
 * `scopeFloor` widens the anonymity set for reader-de-anonymizable topics
 * (hot-seat content can be cross-referenced against public standings, so
 * fuzzing to a 4-team division isn't enough):
 *   - 'league-wide' : never scope below the whole league.
 *   - 'tier'        : AFL only — scope to Premier League / D-League
 *                     (12-team pools) instead of 6-team divisions.
 *
 * Legacy note: the pre-Phase-8 'commish' topic (UI label "Beef") became
 * 'frontoffice'. Old queued/archived tips still carry topic 'commish' —
 * the API normalizes new submissions via LEGACY_TOPIC_ALIASES and the
 * scanner keeps a prompt case for the legacy id until the queue drains.
 */

/**
 * @typedef {Object} TipTopicMeta
 * @property {string} id                internal enum value (stored on tips)
 * @property {string} label             UI label
 * @property {string} placeholder      rotating textarea placeholder
 * @property {string[]} [leagues]       navSlugs the topic exists for (default: all)
 * @property {Object<string, {label?: string, placeholder?: string}>} [leagueOverrides]
 *                                      per-navSlug label/placeholder overrides
 * @property {boolean} [commishTargetAllowed=true] whether "The Commish" is a
 *                                      valid franchiseHint for this topic
 * @property {'standard'|'explicit-pick-only'|'never'} [namingPolicy='standard']
 * @property {boolean} [mandatoryHedge=false]
 * @property {Object<string, 'league-wide'|'tier'>} [scopeFloor] per-navSlug
 * @property {number} [perTeamCooldownDays] min days between posts about the
 *                                      same team from this topic
 */

/** @type {TipTopicMeta[]} */
export const TIP_TOPIC_META = [
  {
    id: 'trade',
    label: 'Trade interest',
    placeholder: 'e.g. Hearing the Northwest is shopping their 1st for a vet WR…',
    leagueOverrides: {
      afl: {
        placeholder: 'e.g. Hearing an AL North desk is shopping a keeper-eligible RB…',
      },
    },
    // The commish is not a trade target (long-standing rule).
    commishTargetAllowed: false,
  },
  {
    id: 'roster',
    label: 'Roster gripe',
    // Re-scoped toward locker-room / depth-chart drama — hot-seat and
    // contract-year framing now have their own lanes.
    placeholder: 'e.g. Hearing that backfield committee is turning into a real snap-count fight…',
  },
  {
    id: 'hotseat',
    label: 'Hot seat',
    placeholder: "e.g. Somebody's about to blow up their whole roster after this start…",
    leagueOverrides: {
      afl: {
        label: 'Relegation watch',
        placeholder: "e.g. One of the D-League desks is playing like they don't want to come up…",
      },
    },
    // Hot-seat content is de-anonymized by READERS (anyone can cross-check
    // standings), not by phrasing — so the post never names, and the scope
    // floor keeps the anonymity pool wide: whole league for TheLeague's
    // 4-team divisions, 12-team tier for the AFL.
    namingPolicy: 'never',
    scopeFloor: { theleague: 'league-wide', afl: 'tier' },
    perTeamCooldownDays: 14,
  },
  {
    id: 'frontoffice',
    label: 'Front-office dysfunction',
    placeholder: 'e.g. Word is a trade died of indecision, not the other side saying no…',
    // Inherits the commish institutional-framing voice for ANY target —
    // "the front office" / "that desk's decision-making", never the person.
  },
  {
    id: 'tampering',
    label: 'Tampering',
    placeholder: "e.g. Hearing someone's been talking trade before the window even opened…",
    commishTargetAllowed: false,
    // Accusation-shaped: the strictest naming gate in the system. Multi-
    // source corroboration must NOT unlock naming, and every post hedges.
    namingPolicy: 'explicit-pick-only',
    mandatoryHedge: true,
  },
  {
    id: 'intentions',
    label: 'Draft intentions',
    placeholder: "e.g. Hearing a team's punting this rookie class entirely…",
    leagueOverrides: {
      afl: {
        label: 'Keeper intentions',
        placeholder: "e.g. Hearing a team's letting a stud walk instead of keeping him…",
      },
    },
  },
  {
    id: 'motive',
    label: 'Contract-year motives',
    placeholder: "e.g. That RB's playing for a new deal and it shows…",
    // Needs contracts/salary cap — TheLeague only.
    leagues: ['theleague'],
  },
  {
    id: 'prediction',
    label: 'Bold prediction',
    placeholder: "e.g. Calling it now — Breece Hall isn't making it through Week 8…",
  },
  {
    id: 'other',
    label: 'Other',
    placeholder: 'Tell me what’s brewing.',
  },
];

/**
 * Legacy topic ids still accepted at the API boundary and mapped to their
 * modern id on NEW submissions. Old queue/archive entries keep the legacy id;
 * the scanner keeps prompt handling for both until the queue drains.
 */
export const LEGACY_TOPIC_ALIASES = { commish: 'frontoffice' };

/** All modern topic ids across every league (excludes legacy aliases). */
export const ALL_TOPIC_IDS = TIP_TOPIC_META.map((t) => t.id);

/**
 * Topic ids the scanner may find on queued tips: modern ids + legacy ids.
 * Startup prompt-coverage assertions check against THIS list.
 */
export const DRAINABLE_TOPIC_IDS = [
  ...ALL_TOPIC_IDS,
  ...Object.keys(LEGACY_TOPIC_ALIASES),
];

/**
 * The resolved topic list for one league's UI/API.
 * @param {string} navSlug 'theleague' | 'afl'
 * @returns {Array<{id: string, label: string, placeholder: string,
 *   commishTargetAllowed: boolean, namingPolicy: string,
 *   mandatoryHedge: boolean, scopeFloor: string|null,
 *   perTeamCooldownDays: number|null}>}
 */
const _topicsCache = new Map();

export function getTipTopics(navSlug) {
  const cached = _topicsCache.get(navSlug);
  if (cached) return cached;
  const resolved = TIP_TOPIC_META.filter(
    (t) => !t.leagues || t.leagues.includes(navSlug),
  ).map((t) => {
    const override = t.leagueOverrides?.[navSlug] ?? {};
    return {
      id: t.id,
      label: override.label ?? t.label,
      placeholder: override.placeholder ?? t.placeholder,
      commishTargetAllowed: t.commishTargetAllowed ?? true,
      namingPolicy: t.namingPolicy ?? 'standard',
      mandatoryHedge: t.mandatoryHedge ?? false,
      scopeFloor: t.scopeFloor?.[navSlug] ?? null,
      perTeamCooldownDays: t.perTeamCooldownDays ?? null,
    };
  });
  _topicsCache.set(navSlug, resolved);
  return resolved;
}

/** Valid topic ids for one league (modern ids only). */
export function getTopicIds(navSlug) {
  return getTipTopics(navSlug).map((t) => t.id);
}

/**
 * Normalize a submitted topic id: maps legacy aliases to modern ids and
 * returns null for anything not valid for the league.
 * @param {string} topic
 * @param {string} navSlug
 * @returns {string|null}
 */
export function normalizeTopicId(topic, navSlug) {
  const mapped = LEGACY_TOPIC_ALIASES[topic] ?? topic;
  return getTopicIds(navSlug).includes(mapped) ? mapped : null;
}

/** Per-topic scanner policy lookup (falls back to 'other' defaults). */
export function getTopicPolicy(topic, navSlug) {
  const mapped = LEGACY_TOPIC_ALIASES[topic] ?? topic;
  const found = getTipTopics(navSlug).find((t) => t.id === mapped);
  return (
    found ?? {
      id: mapped,
      label: mapped,
      placeholder: '',
      commishTargetAllowed: true,
      namingPolicy: 'standard',
      mandatoryHedge: false,
      scopeFloor: null,
      perTeamCooldownDays: null,
    }
  );
}
