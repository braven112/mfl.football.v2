/**
 * Owner links — the live overlay that lets an owner's former teams join their
 * career without a git change.
 *
 * A LINK says "these seasons of franchise F (yearStart–yearEnd, whatever the
 * team was called) belong to owner X". An owner proposes one for themselves
 * and the commissioner approves it; a commissioner's own link is approved on
 * creation. Approved links live in Redis (owner-link-store.ts) and take effect
 * on the next request.
 *
 * ── How the overlay stays on the ONE ownership boundary ──────────────────
 * It never decides whose season is whose by itself. A link is translated into
 * the language the registry already speaks — a CLAIM — and handed to the same
 * `buildOwnerTenures` the compute script runs (owner-tenures.mjs), so registry
 * claims stay authoritative where they cover and `buildAttributor` stays the
 * only boundary walk (tests/owner-boundary-parity.test.ts). Concretely, a link:
 *
 *  1. carves its years out of every OTHER person's claim on that franchise in
 *     this league (splitting a claim around the range, so an open-ended claim
 *     keeps its open tail and its holder stays current), and
 *  2. adds a claim on those years to the target person.
 *
 * A person left with no claim in the league has been absorbed: their slug
 * joins the target's `previousSlugs`, so their old owner page 301s to the
 * merged career instead of 404ing.
 *
 * With no approved link the committed file is returned AS IS — the same
 * object — so an unapproved (pending or rejected) link can change nothing.
 * Rebuilding with no links reproduces the committed file byte for byte for
 * both full-management leagues (tests/owner-link-overlay.test.ts pins it),
 * which is what makes the rebuild safe to serve.
 *
 * Pure: the loaders live in owner-link-live.ts.
 */
import { buildOwnerTenures } from './owner-tenures.mjs';
import { holdingsBySeason, historyOwners, slotHolding } from './league-history/dataset.mjs';

export const LINK_STATES = /** @type {const} */ (['pending', 'approved', 'rejected']);

/** The newest season in a ledger — the one a link may never take. */
export const latestLedgerYear = (ledgerRows) =>
  (ledgerRows ?? []).reduce((max, r) => (r.year > max ? r.year : max), 0);

const yearsOf = (start, end) => {
  const out = [];
  for (let y = start; y <= end; y++) out.push(y);
  return out;
};

/** Contiguous runs of a sorted year list: [[2008, 2010], [2013, 2013]]. */
const runsOf = (years) => {
  const runs = [];
  for (const y of years) {
    const last = runs[runs.length - 1];
    if (last && y === last[1] + 1) last[1] = y;
    else runs.push([y, y]);
  }
  return runs;
};

const coversYear = (claim, leagueSlug, franchiseId, year) =>
  claim.league === leagueSlug &&
  claim.franchiseId === franchiseId &&
  year >= claim.yearStart &&
  year <= claim.yearEnd;

/** Remove [start, end] of `franchiseId` from a claim list, splitting around it. */
const carve = (claims, leagueSlug, franchiseId, start, end) => {
  const next = [];
  for (const c of claims) {
    if (c.league !== leagueSlug || c.franchiseId !== franchiseId || c.yearEnd < start || c.yearStart > end) {
      next.push(c);
      continue;
    }
    if (c.yearStart < start) next.push({ ...c, yearEnd: start - 1 });
    if (c.yearEnd > end) next.push({ ...c, yearStart: end + 1 });
  }
  return next;
};

/** Approved links for one league, in the order they were decided. */
export const approvedLinks = (links, leagueSlug) =>
  (links ?? [])
    .filter((l) => l && l.status === 'approved' && l.league === leagueSlug)
    .sort(
      (a, b) =>
        String(a.decidedAt ?? a.proposedAt ?? '').localeCompare(String(b.decidedAt ?? b.proposedAt ?? '')) ||
        String(a.id).localeCompare(String(b.id))
    );

/**
 * The registry with every approved link applied as claims.
 *
 * @param registry    owners-registry.json
 * @param leagueSlug  registry league slug
 * @param links       link records (any state; only approved ones apply)
 * @param latestYear  the league's newest season — never linkable, so the
 *                    slot's current holder always keeps it
 * @returns {{ registry: object, applied: string[], skipped: Array<{id: string, reason: string}> }}
 */
export function applyLinksToRegistry(registry, leagueSlug, links, latestYear = Infinity) {
  const people = (registry?.people ?? []).map((p) => ({
    ...p,
    previousSlugs: [...(p.previousSlugs ?? [])],
    claims: (p.claims ?? []).map((c) => ({ ...c })),
  }));
  const byId = new Map(people.map((p) => [p.id, p]));
  // A person absorbed by an earlier link forwards to whoever absorbed them, so
  // a later link naming them still lands on the merged career.
  const mergedInto = new Map();
  const resolve = (id) => {
    let cur = id;
    const seen = new Set();
    while (mergedInto.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = mergedInto.get(cur);
    }
    return cur;
  };
  const inLeague = (person) => person.claims.some((c) => c.league === leagueSlug);

  const applied = [];
  const skipped = [];
  for (const link of approvedLinks(links, leagueSlug)) {
    const target = byId.get(resolve(link.targetOwnerId));
    const yearStart = Number(link.yearStart);
    const yearEnd = Number(link.yearEnd);
    if (!target || !inLeague(target)) {
      skipped.push({ id: link.id, reason: 'unknown-owner' });
      continue;
    }
    if (!Number.isInteger(yearStart) || !Number.isInteger(yearEnd) || yearStart > yearEnd) {
      skipped.push({ id: link.id, reason: 'bad-range' });
      continue;
    }
    if (yearEnd >= latestYear) {
      skipped.push({ id: link.id, reason: 'current-season' });
      continue;
    }
    // Years the target already holds stay exactly as they are — including a
    // shared season, whose co-owner must not be carved off it.
    const wanted = yearsOf(yearStart, yearEnd).filter(
      (y) => !target.claims.some((c) => coversYear(c, leagueSlug, link.franchiseId, y))
    );
    if (wanted.length === 0) {
      skipped.push({ id: link.id, reason: 'already-held' });
      continue;
    }
    for (const [start, end] of runsOf(wanted)) {
      for (const person of people) {
        if (person === target) continue;
        person.claims = carve(person.claims, leagueSlug, link.franchiseId, start, end);
      }
      target.claims.push({ league: leagueSlug, franchiseId: link.franchiseId, yearStart: start, yearEnd: end });
    }
    for (const person of people) {
      if (person === target || mergedInto.has(person.id)) continue;
      if (!inLeague(person) && (registry.people.find((p) => p.id === person.id)?.claims ?? []).some((c) => c.league === leagueSlug)) {
        mergedInto.set(person.id, target.id);
        for (const slug of [person.slug, ...person.previousSlugs]) {
          if (slug && slug !== target.slug && !target.previousSlugs.includes(slug)) target.previousSlugs.push(slug);
        }
      }
    }
    applied.push(link.id);
  }

  return { registry: { ...registry, people }, applied, skipped };
}

/** Every (franchise|year) a payload puts on an owner. */
const ownedKeys = (payload) => {
  const keys = new Set();
  for (const owner of payload?.owners ?? []) {
    for (const tenure of owner.tenures ?? []) {
      for (const s of tenure.seasons ?? []) keys.add(`${tenure.franchiseId}|${s.year}`);
    }
  }
  return keys;
};

/**
 * owner-tenures.json with the approved links applied.
 *
 * @param args.league     registry league entry
 * @param args.committed  the committed owner-tenures.json
 * @param args.registry   owners-registry.json
 * @param args.inputs     { teams, ledgerRows, yearSummaries, awardRows } — what
 *                        compute-owner-tenures.mjs feeds buildOwnerTenures
 * @param args.links      link records (any state)
 * @returns {{ data: object, applied: string[], skipped: Array<{id: string, reason: string}>, error?: string }}
 */
export function overlayOwnerTenures({ league, committed, registry, inputs, links }) {
  if (approvedLinks(links, league.slug).length === 0 || !inputs) {
    return { data: committed, applied: [], skipped: [] };
  }
  const latestYear = latestLedgerYear(inputs.ledgerRows);
  const live = applyLinksToRegistry(registry, league.slug, links, latestYear);
  if (live.applied.length === 0) return { data: committed, applied: [], skipped: live.skipped };
  try {
    const data = buildOwnerTenures({
      league,
      teams: inputs.teams,
      ledgerRows: inputs.ledgerRows,
      yearSummaries: inputs.yearSummaries ?? [],
      awardRows: inputs.awardRows ?? [],
      registry: live.registry,
      generatedAt: committed?.generatedAt ?? null,
    });
    // Conservation, the invariant the compute script fails its run on: every
    // ledger season still lands on an owner. A link that broke it is not
    // served — the committed file is.
    const owned = ownedKeys(data);
    const lost = (inputs.ledgerRows ?? []).filter((r) => !owned.has(`${r.franchiseId}|${r.year}`));
    if (lost.length > 0) throw new Error(`${lost.length} season(s) fell off every owner`);
    return { data, applied: live.applied, skipped: live.skipped };
  } catch (error) {
    return { data: committed, applied: [], skipped: live.skipped, error: String(error?.message ?? error) };
  }
}

/**
 * league-history.json re-credited to the (overlaid) owner tenures: each
 * team-season's holding and the owner list, built by the same helpers
 * `buildHistoryDataset` uses, so with the committed tenures it returns the
 * committed dataset unchanged. Everything that reads owners from the dataset —
 * owner pages' history sections, Ask the History's owner/team filters —
 * follows for free.
 */
export function overlayHistoryDataset(ds, ownerTenures) {
  if (!ds || !ownerTenures) return ds;
  const holdings = holdingsBySeason(ownerTenures);
  return {
    ...ds,
    owners: historyOwners(ownerTenures),
    seasons: (ds.seasons ?? []).map((s) => ({
      ...s,
      teams: Object.fromEntries(
        Object.entries(s.teams ?? {}).map(([f, t]) => [
          f,
          { ...t, h: holdings.get(`${f}|${s.y}`) ?? slotHolding(f) },
        ])
      ),
    })),
  };
}

/**
 * The tenures another owner holds that `targetOwnerId` could ask to link:
 * every tenure in the league not already theirs, trimmed to seasons before the
 * newest one. One option per (holder, franchise) tenure.
 */
export function linkableTenures(ownerTenures, targetOwnerId, latestYear) {
  const out = [];
  for (const owner of ownerTenures?.owners ?? []) {
    if (owner.ownerId === targetOwnerId) continue;
    for (const tenure of owner.tenures ?? []) {
      const seasons = (tenure.seasons ?? []).filter((s) => s.year < latestYear);
      if (seasons.length === 0) continue;
      const years = seasons.map((s) => s.year).sort((a, b) => a - b);
      const w = seasons.reduce((n, s) => n + (s.wins ?? 0), 0);
      const l = seasons.reduce((n, s) => n + (s.losses ?? 0), 0);
      const t = seasons.reduce((n, s) => n + (s.ties ?? 0), 0);
      out.push({
        holderOwnerId: owner.ownerId,
        holderSlug: owner.slug,
        holderTitle: owner.displayName ?? owner.title,
        holderIsCurrent: Boolean(owner.isCurrent),
        franchiseId: tenure.franchiseId,
        yearStart: years[0],
        yearEnd: years[years.length - 1],
        years,
        names: [...new Set(seasons.map((s) => s.name).filter(Boolean))],
        icon: tenure.identities?.[0]?.icon ?? owner.icon ?? null,
        record: t ? `${w}-${l}-${t}` : `${w}-${l}`,
        titles: seasons.filter((s) => s.playoffResult === 'champion').length,
      });
    }
  }
  return out.sort((a, b) => a.yearStart - b.yearStart || a.franchiseId.localeCompare(b.franchiseId));
}

/**
 * Why a proposed link cannot be filed, or null when it can.
 *
 * @param ownerTenures  the LIVE tenures (approved links already applied)
 * @param latestYear    the league's newest season
 * @param link          { targetOwnerId, franchiseId, yearStart, yearEnd }
 * @param existing      every stored link for the league
 */
export function validateLinkRequest(ownerTenures, latestYear, link, existing = []) {
  const yearStart = Number(link?.yearStart);
  const yearEnd = Number(link?.yearEnd);
  const franchiseId = String(link?.franchiseId ?? '');
  if (!/^\d{4}$/.test(franchiseId)) return 'Pick a franchise.';
  if (!Number.isInteger(yearStart) || !Number.isInteger(yearEnd) || yearStart > yearEnd) return 'Pick a valid range of seasons.';
  if (yearEnd >= latestYear) return `The ${latestYear} season belongs to the team's current owner and can't be linked.`;
  const target = (ownerTenures?.owners ?? []).find((o) => o.ownerId === link.targetOwnerId);
  if (!target) return 'That owner is not on record in this league.';

  const played = new Set();
  const mine = new Set();
  for (const owner of ownerTenures.owners) {
    for (const tenure of owner.tenures ?? []) {
      if (tenure.franchiseId !== franchiseId) continue;
      for (const s of tenure.seasons ?? []) {
        played.add(s.year);
        if (owner.ownerId === target.ownerId) mine.add(s.year);
      }
    }
  }
  const range = yearsOf(yearStart, yearEnd);
  if (!range.some((y) => played.has(y))) return `Franchise ${franchiseId} played no season in that range.`;
  if (range.every((y) => !played.has(y) || mine.has(y))) return 'Those seasons are already on this owner’s record.';

  const overlaps = (l) =>
    l.targetOwnerId === link.targetOwnerId &&
    l.franchiseId === franchiseId &&
    l.status === 'pending' &&
    Number(l.yearStart) <= yearEnd &&
    Number(l.yearEnd) >= yearStart;
  if ((existing ?? []).some(overlaps)) return 'A request for those seasons is already waiting for the commissioner.';
  return null;
}
