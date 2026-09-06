/**
 * Notification preferences — read and save the command center.
 *
 *   GET  /api/push/preferences  → every category this league offers, plus the
 *                                 caller's effective on/off for each
 *   POST /api/push/preferences  → save explicit choices
 *
 * Identity comes only from the signed session JWT, like every other push
 * route: the two leagues share franchise ids, so a client-supplied league or
 * franchise would let one team read or overwrite another's settings.
 *
 * Only EXPLICIT choices are stored. A category the owner has never touched
 * stays absent so it keeps following its default — which is what lets a new
 * alert type ship on for everyone rather than arriving off for every owner who
 * once opened this page.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { isAdminFranchise } from '../../../config/nav-config';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { checkRateLimit } from '../../../utils/rate-limit';
import { getLeagueById } from '../../../config/leagues';
import {
  visibleCategoriesForLeague,
  NOTIFICATION_GROUPS,
} from '../../../config/notification-categories';
import {
  readPreferences,
  writePreferences,
  resolvePreferences,
  sanitize,
} from '../../../utils/push-preferences';

const headers = JSON_HEADERS_NO_STORE;

function resolveCaller(request: Request) {
  const user = getAuthUser(request);
  if (!user?.franchiseId || !user.leagueId) return null;
  const league = getLeagueById(user.leagueId);
  if (!league) return null;
  // Offer exactly what can be DELIVERED. The send door gates ops categories on
  // `isAdminFranchise` (it has a franchise id and no session), so gating the
  // settings page on the broader `isCommissionerOrAdmin` — which also passes
  // anyone holding the commissioner JWT role — would show that person toggles
  // defaulted ON for alerts they can never receive. That is precisely the
  // "toggle that silently does nothing" the registry's `live` flag exists to
  // prevent, arrived at from the other direction.
  //
  // Still league-scoped, and deliberately from the session's own league: both
  // leagues have a franchise 0001, so the nav slug has to come from the league
  // this session belongs to rather than a default.
  const recipient = { isAdmin: isAdminFranchise(user.franchiseId, league.navSlug) };
  return { user, league, recipient };
}

export const GET: APIRoute = async ({ request }) => {
  const caller = resolveCaller(request);
  if (!caller) return json({ error: 'Authentication required' }, 401, headers);
  const { user, league, recipient } = caller;

  const categories = visibleCategoriesForLeague(league, recipient);
  const stored = await readPreferences(league.id, user.franchiseId);

  return json(
    {
      groups: NOTIFICATION_GROUPS,
      categories: categories.map((c) => ({
        id: c.id,
        group: c.group,
        label: c.label,
        description: c.description,
        cadence: c.cadence,
        defaultOn: c.defaultOn,
      })),
      // Effective values: the owner's explicit choice, or the default.
      preferences: resolvePreferences(categories, stored, league, recipient),
    },
    200,
    headers,
  );
};

export const POST: APIRoute = async ({ request }) => {
  const caller = resolveCaller(request);
  if (!caller) return json({ error: 'Authentication required' }, 401, headers);
  const { user, league, recipient } = caller;

  const limit = await checkRateLimit(
    'push-preferences',
    `${league.id}:${user.franchiseId}`,
    60,
    3600,
  );
  if (!limit.allowed) {
    return json({ error: 'Too many changes — try again later.' }, 429, headers);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400, headers);
  }

  // sanitize() drops unknown keys and non-booleans, so a stale or malicious
  // payload cannot plant entries that outlive the categories they name.
  const incoming = sanitize((body as { preferences?: unknown })?.preferences);

  // Only categories this league actually offers. Without this, an owner in one
  // league could store a preference for a feature-gated category they do not
  // have, which would then apply if the feature were ever enabled.
  // Recipient-scoped too: a non-admin POSTing an admin-only id gets it dropped
  // here rather than stored as a preference that would apply if they ever
  // became an admin.
  const offered = new Set(visibleCategoriesForLeague(league, recipient).map((c) => c.id));
  const next: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(incoming)) {
    if (offered.has(id)) next[id] = value;
  }

  const saved = await writePreferences(league.id, user.franchiseId, next);
  if (!saved) {
    return json({ error: 'Could not save — storage unavailable' }, 503, headers);
  }

  const categories = visibleCategoriesForLeague(league, recipient);
  return json(
    {
      success: true,
      preferences: resolvePreferences(categories, next, league, recipient),
    },
    200,
    headers,
  );
};
