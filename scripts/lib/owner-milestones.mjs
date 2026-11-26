/**
 * Owner career milestones — the GroupMe lane.
 *
 * Pure module: which milestones an OWNER holds, which of those are new, and the
 * chat text that announces one. scripts/post-owner-milestones.mjs does the I/O.
 *
 * OWNER, NOT FRANCHISE (Brandon, Nov 2026). A milestone belongs to the person:
 * an owner who took over a 150-win franchise starts at zero, and an owner who
 * ran two franchises carries both into one career. The numbers come from
 * owner-tenures.json, whose `totals` are built by `buildAttributor`
 * (src/utils/owner-tenures.mjs) — the ONE ownership boundary — so this module
 * never re-derives who owned what. The franchise badges in scripts/badges.mjs
 * (and the Schefter feed posts they drive) are a separate, franchise-scoped
 * set; do not merge the two.
 *
 * WHAT IS NEW. A milestone is announced once, ever. "New" means held now, not
 * in the committed baseline (src/data/owner-milestones-baseline.json — every
 * milestone already earned when this lane shipped, so switching it on never
 * posts a decade of old news), and not already claimed in Redis by an earlier
 * run. The baseline is never rewritten; Redis carries everything after it.
 */

/**
 * The milestone table. One row per announceable career mark. `id` is part of
 * the dedupe key — never rename one, or it re-announces.
 *
 * Kept to CAREER marks on purpose: yearly honors (scoring title, best record)
 * stay in the news feed.
 */
export const OWNER_MILESTONES = [
  { id: 'wins-100', stat: 'wins', at: 100 },
  { id: 'wins-200', stat: 'wins', at: 200 },
  { id: 'wins-300', stat: 'wins', at: 300 },
  { id: 'playoffs-5', stat: 'playoffAppearances', at: 5 },
  { id: 'playoffs-10', stat: 'playoffAppearances', at: 10 },
  { id: 'seasons-10', stat: 'seasons', at: 10 },
];

/**
 * More new milestones than this for one league in one run is not a good week,
 * it is a broken input (an owner id renumbered, a baseline missing) — posting
 * it would flood the chat with old news. The run posts nothing and says why.
 */
export const MAX_NEW_PER_RUN = 4;

/** Seasons an owner has actually played: a rolled-over, unstarted year is not one. */
export function seasonsPlayed(owner) {
  const years = new Set();
  for (const tenure of owner?.tenures ?? []) {
    for (const season of tenure.seasons ?? []) {
      if (season.seasonNotStarted) continue;
      years.add(season.year);
    }
  }
  return years.size;
}

/** The career stats the table reads. */
export function careerStats(owner) {
  const t = owner?.totals ?? {};
  return {
    wins: Number(t.wins) || 0,
    losses: Number(t.losses) || 0,
    ties: Number(t.ties) || 0,
    playoffAppearances: Number(t.playoffAppearances) || 0,
    seasons: seasonsPlayed(owner),
  };
}

/** Dedupe key for one owner's milestone. Stable across runs. */
export const milestoneKey = (ownerId, milestoneId) => `${ownerId}:${milestoneId}`;

/** Every milestone this owner holds right now, in table order. */
export function heldMilestones(owner) {
  const stats = careerStats(owner);
  return OWNER_MILESTONES.filter((m) => stats[m.stat] >= m.at);
}

/**
 * Milestones held now that the baseline does not list. CURRENT owners only —
 * a former owner's numbers cannot move, so anything "new" there is a data
 * reshuffle, not news.
 *
 * @param {{ owners: any[] }} tenures owner-tenures.json payload
 * @param {Iterable<string>} baselineKeys milestoneKey()s already announced
 */
export function newMilestones(tenures, baselineKeys) {
  const seen = new Set(baselineKeys ?? []);
  const out = [];
  const owners = [...(tenures?.owners ?? [])]
    .filter((o) => o?.isCurrent && o?.ownerId)
    .sort((a, b) => String(a.ownerId).localeCompare(String(b.ownerId)));
  for (const owner of owners) {
    for (const milestone of heldMilestones(owner)) {
      const key = milestoneKey(owner.ownerId, milestone.id);
      if (!seen.has(key)) out.push({ key, owner, milestone });
    }
  }
  return out;
}

/** Every key held now — what a baseline seed records. */
export function allHeldKeys(tenures) {
  return (tenures?.owners ?? [])
    .filter((o) => o?.isCurrent && o?.ownerId)
    .flatMap((o) => heldMilestones(o).map((m) => milestoneKey(o.ownerId, m.id)))
    .sort();
}

/** The owner's team name today (latest identity worn). */
export function currentTeamName(owner) {
  const ids = [...(owner?.identities ?? [])].sort((a, b) => (b.yearEnd ?? 0) - (a.yearEnd ?? 0));
  const latest = ids[0];
  return latest?.nameMedium || latest?.name || owner?.dominantName || null;
}

const record = ({ wins, losses, ties }) => (ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`);

// Schefter's chat voice: short, deadpan, no exclamation marks.
const FLAVOR = {
  'wins-100': 'Century Club. Plaque pending.',
  'wins-200': "Two-hundred-win club. The kind of number you don't fake your way to.",
  'wins-300': 'Three centuries. Rare air in the record book.',
  'playoffs-5': 'Not a tourist anymore.',
  'playoffs-10': 'Postseason fixture. Hard to fluke that number.',
  'seasons-10': 'A decade at the table. Still here.',
};

const HEADLINE = {
  wins: (n) => `hits ${n} career wins`,
  playoffAppearances: (n) => `reaches ${n} career playoff appearances`,
  seasons: (n) => `reaches ${n} seasons in the league`,
};

/** Display labels for the feed's milestone chip ("Career milestone · 200 Wins"). */
const CHIP = {
  'wins-100': { name: '100 Wins', icon: '💯' },
  'wins-200': { name: '200 Wins', icon: '🔥' },
  'wins-300': { name: '300 Wins', icon: '👑' },
  'playoffs-5': { name: '5 Playoff Trips', icon: '🎯' },
  'playoffs-10': { name: '10 Playoff Trips', icon: '🌠' },
  'seasons-10': { name: '10 Seasons', icon: '🎖️' },
};

/**
 * The franchise badge each owner milestone replaced. The franchise lane used to
 * post these (id `sf_milestone_<franchiseId>-<badge>`); when that post already
 * exists for the owner's current franchise, the owner post is not added to the
 * feed again — Bring The Pain's 200th is in the feed that way.
 */
export const LEGACY_FRANCHISE_BADGE = {
  'wins-100': 'century-club',
  'wins-200': 'double-century',
  'wins-300': 'triple-century',
  'playoffs-5': 'playoff-veteran',
  'playoffs-10': 'playoff-legend',
  'seasons-10': 'decade-of-service',
};

export const legacyFeedPostId = (franchiseId, milestoneId) =>
  franchiseId && LEGACY_FRANCHISE_BADGE[milestoneId]
    ? `sf_milestone_${franchiseId}-${LEGACY_FRANCHISE_BADGE[milestoneId]}`
    : null;

/**
 * Headline. Leads with the TEAM name — that is how owners refer to each other
 * (Brandon, 2026-11-25) — while the numbers are the owner's own career.
 */
export function milestoneHeadline({ owner, milestone }) {
  const team = currentTeamName(owner) || owner.displayName;
  return `${team} ${HEADLINE[milestone.stat](milestone.at)}`;
}

/** One-line body: whose career it is, the record, and Schefter's flavor line. */
export function milestoneBody({ owner, milestone }) {
  const stats = careerStats(owner);
  const since = owner.yearStart ? `, owner since ${owner.yearStart},` : '';
  return (
    `${owner.displayName}${since} is ${record(stats)} all time across ${stats.seasons} seasons, ` +
    `with ${stats.playoffAppearances} playoff trips. ${FLAVOR[milestone.id] ?? ''}`
  ).trim();
}

/**
 * The chat message. Plain text; the URL goes LAST on its own line so nothing
 * trails it (GroupMe autolinks a following period — league-urls.md).
 *
 * @param {{ owner: any, milestone: { id: string, stat: string, at: number }, ownerUrl?: string | null }} args
 */
export function milestoneText({ owner, milestone, ownerUrl = null }) {
  const lines = [`MILESTONE: ${milestoneHeadline({ owner, milestone })}.`, milestoneBody({ owner, milestone })];
  if (ownerUrl) lines.push(ownerUrl);
  return lines.join('\n');
}

/**
 * The news-feed post. Deterministic id per league + owner + milestone, so a
 * re-run merges into the same post rather than adding a second.
 *
 * @param {{ league: { slug: string, navSlug: string }, owner: any, milestone: any, now: Date }} args
 */
export function buildOwnerMilestonePost({ league, owner, milestone, now }) {
  const chip = CHIP[milestone.id] ?? { name: milestone.id, icon: '🏅' };
  const stats = careerStats(owner);
  return {
    id: `sf_milestone_owner_${league.navSlug}_${owner.ownerId}_${milestone.id}`,
    timestamp: now.toISOString(),
    type: 'transaction',
    transactionSubType: 'milestone',
    tier: milestone.id === 'wins-300' ? 'breaking' : 'standard',
    headline: milestoneHeadline({ owner, milestone }),
    body: milestoneBody({ owner, milestone }),
    authorId: 'claude',
    franchiseIds: owner.currentFranchiseId ? [owner.currentFranchiseId] : [],
    league: league.navSlug,
    link: owner.slug ? `/${league.slug}/owners/${owner.slug}` : undefined,
    linkLabel: 'View the owner page →',
    milestone: {
      badgeId: milestone.id,
      badgeName: chip.name,
      icon: chip.icon,
      tier: 'career',
      awardKey: milestone.id,
      award: { value: stats[milestone.stat] },
    },
  };
}
