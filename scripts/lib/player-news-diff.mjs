/**
 * "News on your players" — what changed on the injury report, for whoever
 * owns the player.
 *
 * Pure diffing. The caller supplies the feeds and the previous snapshot and
 * gets back changes; nothing here reads a file, a clock or Redis.
 *
 * WHY A SNAPSHOT RATHER THAN A GIT DIFF. Roster Sync overwrites
 * `mfl-feeds/<year>/injuries.json` in place and commits it, so the obvious
 * "diff against the last commit" is only correct while every run commits. It
 * doesn't: the commit step is skipped when nothing else changed, a failed push
 * is retried on the next run, and a manual `workflow_dispatch` may not push at
 * all. Comparing against a snapshot the alert itself owns means the diff is a
 * function of what we last TOLD PEOPLE, which is the thing that must not
 * repeat, rather than of what git happens to hold.
 *
 * The snapshot is scoped to ROSTERED players. A league carries ~400 franchise
 * roster spots against MFL's ~450 leaguewide injuries, and the free agent pool
 * generates most of the churn — nobody wants a buzz because a third-string
 * guard nobody owns is now questionable.
 */

/**
 * MFL statuses, ordered worst to best, for deciding whether a change is a
 * downgrade or an upgrade. Anything unrecognized sorts as "some kind of
 * concern" rather than being dropped: a new status string MFL invents should
 * still reach the owner, just without a confident verb attached to it.
 */
const SEVERITY = {
  ir: 5,
  out: 4,
  doubtful: 3,
  questionable: 2,
  probable: 1,
  healthy: 0,
};

/** No status at all is the healthy case — the player is off the report. */
const HEALTHY = 'healthy';

function severityOf(status) {
  const key = String(status ?? '').trim().toLowerCase();
  if (!key || key === HEALTHY) return SEVERITY.healthy;
  return SEVERITY[key] ?? SEVERITY.questionable;
}

/**
 * Every rostered player, mapped to the franchise that holds them.
 *
 * A Map rather than an object because MFL player ids are numeric strings and
 * an object would silently reorder them; nothing here depends on the order,
 * but a Map makes that a fact rather than a coincidence.
 */
export function rosterIndex(rostersJson) {
  const raw = rostersJson?.rosters?.franchise;
  const franchises = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const index = new Map();
  for (const franchise of franchises) {
    const fid = String(franchise?.id ?? '');
    if (!fid) continue;
    const players = Array.isArray(franchise.player)
      ? franchise.player
      : franchise.player
        ? [franchise.player]
        : [];
    for (const p of players) {
      if (p?.id) index.set(String(p.id), fid);
    }
  }
  return index;
}

/**
 * The current injury status of every ROSTERED player, as a flat map.
 *
 * This is both the thing we diff and the thing we store, so it has exactly one
 * definition. Players who are healthy are simply absent — storing `healthy`
 * for four hundred players to represent "nothing to say" would make the
 * snapshot forty times bigger and the diff no more accurate.
 */
export function rosteredInjuryMap(injuriesJson, index) {
  const injuries = injuriesJson?.injuries ?? {};
  const out = {};
  for (const [playerId, info] of Object.entries(injuries)) {
    if (!index.has(playerId)) continue;
    const status = String(info?.injuryStatus ?? '').trim();
    if (!status || status.toLowerCase() === HEALTHY) continue;
    out[playerId] = status;
  }
  return out;
}

/**
 * What changed since the last snapshot.
 *
 * Both directions are news. A player clearing an Out tag on Saturday is the
 * single most actionable thing this alert can say — it is the difference
 * between starting them and not — so recoveries are not filtered out as
 * "not bad news".
 *
 * @param {object} args
 * @param {Record<string, string>} [args.previous] Last snapshot.
 * @param {Record<string, string>} args.current From rosteredInjuryMap.
 * @param {Map<string, string>} args.index From rosterIndex.
 * @returns {Array<{playerId: string, franchiseId: string, from: string, to: string, direction: 'worse'|'better'}>}
 */
export function diffPlayerNews({ previous = {}, current, index }) {
  const changes = [];
  const playerIds = new Set([...Object.keys(previous ?? {}), ...Object.keys(current ?? {})]);

  for (const playerId of playerIds) {
    const franchiseId = index.get(playerId);
    // A player who changed hands between polls is not news for either owner:
    // the new one did not have them when it happened, and the old one no
    // longer cares. Dropping them here also stops a trade from firing an
    // injury alert at whoever received the player.
    if (!franchiseId) continue;

    const from = previous?.[playerId] ?? HEALTHY;
    const to = current?.[playerId] ?? HEALTHY;
    if (from === to) continue;

    changes.push({
      playerId,
      franchiseId,
      from,
      to,
      direction: severityOf(to) > severityOf(from) ? 'worse' : 'better',
    });
  }

  // Stable order so a run's log and its notifications read the same way twice.
  return changes.sort((a, b) => a.playerId.localeCompare(b.playerId));
}

/**
 * A first-snapshot run has no previous state, and every rostered injury in the
 * league would read as brand new — sixteen owners, a hundred-odd alerts, all
 * of them stale. The caller seeds the snapshot and sends nothing instead.
 */
export function isFirstRun(previous) {
  return previous == null;
}

/** "Smith, Jordan" → "Jordan Smith". MFL stores names last-first. */
export function displayName(mflName) {
  const raw = String(mflName ?? '').trim();
  if (!raw) return 'A player';
  const comma = raw.indexOf(',');
  if (comma === -1) return raw;
  return `${raw.slice(comma + 1).trim()} ${raw.slice(0, comma).trim()}`.trim();
}

/**
 * Turn changes into per-owner notifications.
 *
 * @param {object} args
 * @param {Array<object>} args.changes From diffPlayerNews.
 * @param {(id: string) => {name?: string, position?: string, team?: string}|undefined} args.playerLookup
 */
export function buildPlayerNewsNotifications({ changes, playerLookup }) {
  return (changes ?? []).map((change) => {
    const player = playerLookup?.(change.playerId) ?? {};
    const name = displayName(player.name);
    const badge = [player.position, player.team].filter(Boolean).join(' · ');

    const headline =
      change.to === HEALTHY
        ? `${name} is off the injury report`
        : `${name}: ${change.to}`;

    const detail =
      change.from === HEALTHY
        ? `Newly listed as ${change.to}.`
        : change.to === HEALTHY
          ? `Cleared — was ${change.from}.`
          : `${change.from} → ${change.to}.`;

    return {
      franchiseId: change.franchiseId,
      title: headline,
      body: badge ? `${badge}. ${detail}` : detail,
      url: '/rosters',
      // Per player, NOT per change. An injury designation walks Questionable →
      // Doubtful → Out across a week, and an owner wants the current line on
      // their phone rather than three stale ones stacked above it — so each
      // update REPLACES the last for that player.
      tag: `player-news-${change.playerId}`,
    };
  });
}
