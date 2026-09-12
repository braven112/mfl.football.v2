/**
 * Notification categories — the command center's registry.
 *
 * One entry per kind of alert an owner can receive. This is the single source
 * of truth for three things that used to be implicit: what exists, what is on
 * unless you say otherwise, and which leagues can send it at all.
 *
 * WHY A REGISTRY RATHER THAN A HANDFUL OF BOOLEANS: the league now sends most
 * of its communication by push (the chat is capped at one automated post a
 * day), so the number of alert types only goes up. A registry means adding one
 * is a data change plus a sender, the settings page needs no edit, and the
 * preference filter cannot fall out of sync with the UI.
 *
 * DEFAULTS ARE DELIBERATELY FEW. An owner who never opens this page should get
 * only alerts that are personal, time-critical, and low-volume — something
 * waiting on them, or a deadline that costs real value if missed. Everything
 * else is there for owners who want it and silent for owners who don't. A
 * default-on firehose is how push permission gets revoked, and permission is
 * hard to win back.
 */

import type { LeagueFeatures } from './leagues';

export type NotificationGroupId = 'your-team' | 'owners-poll' | 'league-news' | 'live' | 'ops';

export interface NotificationGroup {
  id: NotificationGroupId;
  label: string;
  description: string;
}

export interface NotificationCategory {
  id: string;
  group: NotificationGroupId;
  label: string;
  /** One line an owner reads to decide. Say what arrives and roughly how often. */
  description: string;
  /** On unless the owner says otherwise. Keep this set small — see above. */
  defaultOn: boolean;
  /**
   * Rough volume, shown in the UI so an owner can judge before opting in.
   * "A firehose" is a fair warning, not a deterrent to hide.
   */
  cadence: string;
  /** Only offered where the league has this feature. */
  requiresFeature?: keyof LeagueFeatures;
  /**
   * Only offered where the league actually runs the Owners' Poll.
   *
   * A separate gate from `requiresFeature` because poll enablement lives in
   * the registry's `ownersPoll` block, NOT in `features` — and mirroring it
   * into `features` would create a second source of truth for the same fact,
   * which is how the ownership-boundary rule ended up with four copies that
   * disagree. The AFL was being offered all three poll toggles, one of them
   * ON by default, for a poll it does not run.
   */
  requiresOwnersPoll?: true;
  /**
   * Only offered to — and only deliverable to — an admin/commissioner
   * franchise (`adminFranchiseIds` in nav-config.json).
   *
   * These are the league's PLUMBING talking: a cron that died, an MFL setting
   * that drifted. They used to go to the group chat, where they were noise for
   * eleven owners and an action item for one. A separate gate from
   * `requiresFeature` because admin-ness is a property of the RECIPIENT, not
   * of the league — both leagues offer these, to different people.
   *
   * The gate is applied at the settings page AND at the send door, and the
   * send door resolves admin-ness from the franchise id itself rather than
   * taking anyone's word for it.
   */
  adminOnly?: true;
  /**
   * Not offered as a toggle. For alerts that are not an editorial choice —
   * today, the "send yourself a test" button, which exists to prove a device
   * works and must therefore travel the SAME path a real alert does. Giving it
   * a category rather than a bypass keeps one door into the sender.
   */
  hidden?: boolean;
  /**
   * False while the alert has a category but no sender yet. Hidden from the
   * settings page rather than shown as a toggle that does nothing — a control
   * that silently does nothing is worse than an absent one.
   */
  live: boolean;
}

export const NOTIFICATION_GROUPS: NotificationGroup[] = [
  {
    id: 'your-team',
    label: 'Your team',
    description: 'Things waiting on you, and deadlines that cost you if missed.',
  },
  {
    id: 'owners-poll',
    label: "The Owners' Poll",
    description: 'The weekly vote — when it opens, when it closes, and where the room put you.',
  },
  {
    id: 'league-news',
    label: 'League news',
    description: 'What the rest of the league is doing. Most of this used to go to the group chat.',
  },
  {
    id: 'live',
    label: 'Game day',
    description: 'Scores and swings while games are being played.',
  },
  {
    id: 'ops',
    label: 'Behind the scenes',
    description:
      'The plumbing: a scheduled job that failed, a league setting that drifted. Only you see these.',
  },
];

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  {
    id: 'system-test',
    group: 'your-team',
    label: 'Test notification',
    description: 'The "send yourself a test" button on this page.',
    cadence: 'Only when you press the button',
    defaultOn: true,
    hidden: true,
    live: true,
  },

  // ── Your team ────────────────────────────────────────────────────
  {
    id: 'trade-offer',
    group: 'your-team',
    label: 'Trade offers',
    description: 'Another owner sends you an offer.',
    cadence: 'Rare',
    defaultOn: true,
    live: true,
  },
  {
    id: 'lineup-deadline',
    group: 'your-team',
    label: 'Lineup problems before kickoff',
    description: 'An empty or illegal starting slot, while there is still time to fix it.',
    cadence: 'Only when something is wrong',
    defaultOn: true,
    requiresFeature: 'liveLineups',
    live: true,
  },
  {
    id: 'roster-deadline',
    group: 'your-team',
    label: 'League deadlines',
    description: 'Draft dates, cut deadlines, auction and keeper dates.',
    cadence: 'A few times a season',
    defaultOn: true,
    live: true,
  },
  {
    id: 'player-news',
    group: 'your-team',
    label: 'News on your players',
    description: 'Injuries and status changes for players on your roster.',
    cadence: 'A few a week in season',
    defaultOn: false,
    live: true,
  },
  {
    id: 'watch-list-news',
    group: 'your-team',
    label: 'News on your watch list',
    description: 'A Schefter Report post about a player on your My Watch List — signings, cuts, trades, rumors, wire stories.',
    cadence: 'Depends on your list — a few a week for most',
    defaultOn: false,
    live: true,
  },

  // ── The Owners' Poll ─────────────────────────────────────────────
  {
    id: 'poll-result',
    requiresOwnersPoll: true,
    group: 'owners-poll',
    label: 'Your poll result',
    description: 'Where the room ranked your team, and how your ballot scored. Voters only.',
    cadence: 'Weekly in season',
    defaultOn: true,
    live: true,
  },
  {
    id: 'poll-open',
    requiresOwnersPoll: true,
    group: 'owners-poll',
    label: 'Ballot opens',
    description: "Tuesday, when the column publishes and the week's ballot opens.",
    cadence: 'Weekly in season',
    defaultOn: false,
    live: true,
  },
  {
    id: 'poll-reminder',
    requiresOwnersPoll: true,
    group: 'owners-poll',
    label: 'Ballot closing reminder',
    description: 'Thursday morning, only if you have not voted yet.',
    cadence: 'Weekly in season',
    defaultOn: false,
    live: true,
  },

  // ── League news ──────────────────────────────────────────────────
  {
    id: 'column',
    group: 'league-news',
    label: 'The Pecking Order',
    description: 'The Tuesday column: rankings, awards and a standings snapshot.',
    cadence: 'Weekly in season',
    defaultOn: false,
    live: true,
  },
  {
    id: 'transaction-big',
    group: 'league-news',
    label: 'Big moves',
    description: 'Trades, and drops of players worth knowing about.',
    cadence: 'A few a week',
    defaultOn: false,
    live: true,
  },
  {
    id: 'transaction-all',
    group: 'league-news',
    label: 'Every transaction',
    description: 'Every add, drop and waiver claim in the league.',
    cadence: 'A firehose — dozens some weeks',
    defaultOn: false,
    live: true,
  },
  {
    id: 'rumor',
    group: 'league-news',
    label: 'The rumor mill',
    description: 'Anonymous tips and whispers from the Schefter Report.',
    cadence: 'A few a week',
    defaultOn: false,
    requiresFeature: 'schefterTips',
    live: true,
  },
  {
    id: 'article',
    group: 'league-news',
    label: 'Weekly columns',
    description: 'Recaps, previews, The Gauntlet and the rest of the Schefter slate.',
    cadence: 'Several a week',
    defaultOn: false,
    live: true,
  },

  // ── Game day ─────────────────────────────────────────────────────
  {
    id: 'scoring-final',
    group: 'live',
    label: 'Your final score',
    description: 'How your matchup finished, once the last game is done.',
    cadence: 'Weekly in season',
    defaultOn: false,
    requiresFeature: 'liveScoring',
    live: true,
  },
  {
    id: 'scoring-swing',
    group: 'live',
    label: 'Close-game swings',
    description: 'Your matchup changes hands late on Sunday.',
    cadence: 'A few a season',
    defaultOn: false,
    requiresFeature: 'liveScoring',
    live: true,
  },

  // ── Behind the scenes (admin only) ───────────────────────────────
  //
  // defaultOn, unlike almost everything else here. The "keep defaults few"
  // rule protects owners from a firehose they did not ask for; these reach one
  // person, only when something is broken, and the whole point is that an
  // admin should not have to opt in to hearing that the automation stopped.
  {
    id: 'ops-job-failure',
    group: 'ops',
    label: 'Automation failures',
    description: 'A scheduled job failed — the syncs, scans and generators that keep the site fed.',
    cadence: 'Only when something breaks',
    defaultOn: true,
    adminOnly: true,
    live: true,
  },
  {
    id: 'ops-league-setup',
    group: 'ops',
    label: 'League setup drift',
    description:
      'An MFL setting no longer matches the constitution and needs fixing by hand — today, the AFL waiver order after a rollover.',
    cadence: 'Rare',
    defaultOn: true,
    adminOnly: true,
    live: true,
  },
];

const BY_ID = new Map(NOTIFICATION_CATEGORIES.map((c) => [c.id, c]));

export function getNotificationCategory(id: string): NotificationCategory | null {
  return BY_ID.get(id) ?? null;
}

/** Every category id, for validation. */
export function notificationCategoryIds(): string[] {
  return NOTIFICATION_CATEGORIES.map((c) => c.id);
}

/**
 * What a league can offer, as far as this module is concerned.
 *
 * The registry entry satisfies this structurally, so callers pass the league
 * itself rather than picking fields off it — which is the point. These gates
 * used to take `features` alone, and a capability that lives OUTSIDE that
 * block (poll enablement) therefore could not be honored at all.
 */
export interface NotificationLeague {
  features: LeagueFeatures;
  ownersPoll?: { enabled?: boolean } | null;
}

/**
 * Who is being offered, or sent, an alert.
 *
 * Only `adminOnly` categories read this, and it defaults to NOT an admin — so
 * a caller that has not thought about it gets the owner-facing set, never the
 * plumbing. Omitting it can hide a category; it can never reveal one.
 */
export interface NotificationRecipient {
  isAdmin?: boolean;
}

/** Every gate that depends on the recipient rather than the league. */
function allowedForRecipient(
  category: NotificationCategory,
  recipient?: NotificationRecipient,
): boolean {
  return !category.adminOnly || Boolean(recipient?.isAdmin);
}

/**
 * The categories a league can actually offer.
 *
 * Filters on the league's capabilities and on `live`, so the settings page
 * never shows a toggle that cannot do anything — an owner who turns something
 * on and never hears from it stops trusting the whole page.
 */
export function categoriesForLeague(
  league: NotificationLeague,
  recipient?: NotificationRecipient,
): NotificationCategory[] {
  const pollEnabled = Boolean(league.ownersPoll?.enabled);
  return NOTIFICATION_CATEGORIES.filter(
    (c) =>
      c.live
      && (!c.requiresFeature || league.features[c.requiresFeature])
      && (!c.requiresOwnersPoll || pollEnabled)
      && allowedForRecipient(c, recipient),
  );
}

/**
 * The categories to SHOW on the settings page.
 *
 * Drops hidden ones — a toggle for the test button would be a control whose
 * only effect is to break the test button.
 */
export function visibleCategoriesForLeague(
  league: NotificationLeague,
  recipient?: NotificationRecipient,
): NotificationCategory[] {
  return categoriesForLeague(league, recipient).filter((c) => !c.hidden);
}

/** The default preference map for a league — what an owner gets untouched. */
export function defaultPreferences(
  league: NotificationLeague,
  recipient?: NotificationRecipient,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const c of categoriesForLeague(league, recipient)) out[c.id] = c.defaultOn;
  return out;
}

/**
 * Should this franchise receive this category?
 *
 * An UNKNOWN category returns false rather than true. A sender that ships a
 * typo'd or removed category would otherwise bypass every preference an owner
 * has set, which is the one failure mode that costs push permission outright.
 */
export function isCategoryEnabled(
  categoryId: string,
  stored: Record<string, boolean> | null | undefined,
  league: NotificationLeague,
  recipient?: NotificationRecipient,
): boolean {
  const category = BY_ID.get(categoryId);
  if (!category) return false;
  if (!category.live) return false;
  if (category.requiresFeature && !league.features[category.requiresFeature]) return false;
  // An admin-only alert reaching a non-admin franchise is the one leak that
  // undoes the whole point of moving these off the group chat, so it is
  // refused here even if a preference for it is somehow stored.
  if (!allowedForRecipient(category, recipient)) return false;
  // Same gate as the settings page, applied at the SEND door too — otherwise a
  // preference stored while a league still offered the toggle keeps delivering
  // after the capability is switched off.
  if (category.requiresOwnersPoll && !league.ownersPoll?.enabled) return false;
  const explicit = stored?.[categoryId];
  return typeof explicit === 'boolean' ? explicit : category.defaultOn;
}
