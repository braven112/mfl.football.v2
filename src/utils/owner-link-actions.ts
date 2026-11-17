/**
 * Owner links — what a session may see and do. Shared by the API routes and
 * the two pages, so the page and the endpoint can never disagree on who is
 * allowed what.
 *
 * Every decision takes its league from the SESSION (`leagueForSession`): an
 * owner signed in to TheLeague can only ever file or review TheLeague's links,
 * whatever the request says. Both leagues have a franchise 0001, so a request
 * parameter naming the league would be a forgery away from writing the other
 * league's owner history.
 */
import { getLeagueById, type LeagueDefinition } from '../config/leagues';
import { isCommissionerOrAdminForLeague, type AuthUser } from './auth';
import type { Owner, OwnerTenuresFile } from '../types/owner-tenures';
import {
  createApprovedOwnerLink,
  listOwnerLinks,
  proposeOwnerLink,
  type OwnerLink,
  type OwnerLinkActor,
} from './owner-link-store';
import { linkableTenures, validateLinkRequest } from './owner-link-overlay.mjs';
import { leagueLatestYear, loadLiveOwnerTenures, ownerLinksSupported } from './owner-link-live';

/** The session's league, when it is one owner links run in. */
export function leagueForSession(user: AuthUser | null): LeagueDefinition | null {
  if (!user) return null;
  const league = getLeagueById(user.leagueId);
  return league && ownerLinksSupported(league.slug) ? league : null;
}

export function canReviewOwnerLinks(user: AuthUser | null, league: LeagueDefinition | null): boolean {
  return Boolean(user && league && isCommissionerOrAdminForLeague(user, league.id));
}

export function actorOf(user: AuthUser): OwnerLinkActor {
  return { userId: user.id, name: user.name, franchiseId: user.franchiseId, role: user.role };
}

/** The owner entries the session's franchise holds today (two for a shared team). */
export function ownersForFranchise(data: OwnerTenuresFile | null, franchiseId: string): Owner[] {
  if (!data || !franchiseId) return [];
  return data.owners.filter((o) => o.isCurrent && o.currentFranchiseId === franchiseId);
}

/** Links a plain owner may see: the ones they filed, or that name their owner entry. */
export function visibleLinks(links: OwnerLink[], user: AuthUser, mine: Owner[], reviewer: boolean): OwnerLink[] {
  if (reviewer) return links;
  const ids = new Set(mine.map((o) => o.ownerId));
  return links.filter((l) => l.proposedBy.franchiseId === user.franchiseId || ids.has(l.targetOwnerId));
}

export type FileLinkResult =
  | { ok: true; link: OwnerLink }
  | { ok: false; status: number; error: string };

/**
 * File a link for the session. A plain owner may only file for an owner entry
 * their own franchise holds today, and it waits for the commissioner; a
 * commissioner may file for anyone and it is approved on the spot.
 */
export async function fileOwnerLink(args: {
  user: AuthUser;
  league: LeagueDefinition;
  data: OwnerTenuresFile;
  latestYear: number;
  existing: OwnerLink[];
  body: { targetOwnerId?: unknown; franchiseId?: unknown; yearStart?: unknown; yearEnd?: unknown; note?: unknown };
}): Promise<FileLinkResult> {
  const { user, league, data, latestYear, existing, body } = args;
  const reviewer = canReviewOwnerLinks(user, league);
  const mine = ownersForFranchise(data, user.franchiseId);

  const requested = typeof body.targetOwnerId === 'string' ? body.targetOwnerId : null;
  let target: Owner | undefined;
  if (reviewer) {
    target = data.owners.find((o) => o.ownerId === (requested ?? mine[0]?.ownerId));
  } else {
    target = requested ? mine.find((o) => o.ownerId === requested) : mine[0];
    if (requested && !target) return { ok: false, status: 403, error: 'You can only link teams to your own owner page.' };
  }
  if (!target) return { ok: false, status: 400, error: 'Pick the owner these seasons belong to.' };

  const request = {
    targetOwnerId: target.ownerId,
    franchiseId: String(body.franchiseId ?? ''),
    yearStart: Number(body.yearStart),
    yearEnd: Number(body.yearEnd),
  };
  const problem = validateLinkRequest(data, latestYear, request, existing);
  if (problem) return { ok: false, status: 400, error: problem };

  // Display-only context, captured as it reads today.
  const options = linkableTenures(data, target.ownerId, latestYear).filter(
    (t: any) => t.franchiseId === request.franchiseId && t.yearStart <= request.yearEnd && t.yearEnd >= request.yearStart
  );
  const names = [...new Set(options.flatMap((t: any) => t.names as string[]))];
  const from = options[0] ?? null;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 280) || null : null;

  const input = {
    league: league.slug,
    targetOwnerId: target.ownerId,
    targetSlug: target.slug,
    targetTitle: target.displayName ?? target.title,
    franchiseId: request.franchiseId,
    yearStart: request.yearStart,
    yearEnd: request.yearEnd,
    names,
    fromOwnerId: from?.holderOwnerId ?? null,
    fromTitle: from?.holderTitle ?? null,
    note,
    proposedBy: actorOf(user),
  };
  const link = reviewer ? await createApprovedOwnerLink(input) : await proposeOwnerLink(input);
  return { ok: true, link };
}

/** One owner, trimmed to what the link pages print. */
export interface OwnerLinkOwnerSummary {
  ownerId: string;
  slug: string;
  title: string;
  icon: string;
  isCurrent: boolean;
  yearStart: number;
  yearEnd: number;
  record: string;
  seasons: number;
  titles: number;
  teams: string[];
}

export function summarizeOwner(o: Owner): OwnerLinkOwnerSummary {
  const { wins, losses, ties } = o.totals;
  return {
    ownerId: o.ownerId,
    slug: o.slug,
    title: o.displayName ?? o.title,
    icon: o.icon,
    isCurrent: o.isCurrent,
    yearStart: o.yearStart,
    yearEnd: o.yearEnd,
    record: ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`,
    seasons: o.totals.seasons,
    titles: o.totals.championships.length,
    teams: [...new Set(o.identities.map((i) => i.name).filter(Boolean) as string[])],
  };
}

export interface LinkableTenure {
  holderOwnerId: string;
  holderSlug: string;
  holderTitle: string;
  holderIsCurrent: boolean;
  franchiseId: string;
  yearStart: number;
  yearEnd: number;
  years: number[];
  names: string[];
  icon: string | null;
  record: string;
  titles: number;
}

export interface OwnerLinksPageModel {
  leagueSlug: string;
  latestYear: number;
  reviewer: boolean;
  /** The owner entries the session's franchise holds today. */
  mine: OwnerLinkOwnerSummary[];
  /** Every owner in the league (the review page picks a target from these). */
  owners: OwnerLinkOwnerSummary[];
  /** Every tenure in the league that could be linked, with its holder. */
  tenures: LinkableTenure[];
  links: OwnerLink[];
}

/** Everything both link pages render, for the session's own league. */
export async function ownerLinksPageModel(user: AuthUser, league: LeagueDefinition): Promise<OwnerLinksPageModel> {
  const [data, links, latestYear] = await Promise.all([
    loadLiveOwnerTenures(league.slug),
    listOwnerLinks(league.slug),
    leagueLatestYear(league.slug),
  ]);
  const reviewer = canReviewOwnerLinks(user, league);
  const mineOwners = ownersForFranchise(data, user.franchiseId);
  return {
    leagueSlug: league.slug,
    latestYear,
    reviewer,
    mine: mineOwners.map(summarizeOwner),
    owners: (data?.owners ?? []).map(summarizeOwner).sort((a, b) => a.title.localeCompare(b.title)),
    // Every holder's tenures; each page leaves out the target's own.
    tenures: linkableTenures(data, '', latestYear) as LinkableTenure[],
    links: visibleLinks(links, user, mineOwners, reviewer),
  };
}
