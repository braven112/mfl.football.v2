/**
 * Sign-in for the custom-site demo's `/demo-start` routes
 * (docs/plans/custom-site-demo.md). Called from each route's OWN frontmatter —
 * it sets cookies and returns a redirect, which only a route may do (CLAUDE.md,
 * the `Astro.redirect()` / `Astro.cookies.set()` boundary).
 *
 * A GET, not a form POST: the link's token is the credential, and Astro's
 * origin check can refuse a form POST from a browser that omits Origin.
 */
import type { AstroGlobal } from 'astro';
import type { LeagueDefinition } from '../config/leagues';
import { demoLeaguePaths } from '../config/leagues-data.mjs';
import { DEMO_USER_PREFIX, lookupDemoLink, type DemoLink } from './demo-access';
import { createSessionToken } from './session';

export interface DemoStartResult {
  /** Set when the prospect picked a team: return it from the route. */
  redirect?: Response;
  link: DemoLink | null;
  token: string | null;
}

export async function handleDemoStart(
  Astro: AstroGlobal,
  league: LeagueDefinition,
  franchiseIds: string[],
  rememberTeam: (franchiseId: string) => void,
): Promise<DemoStartResult> {
  const token = Astro.url.searchParams.get('t');
  const chosen = Astro.url.searchParams.get('franchise');
  const link = await lookupDemoLink(token);

  if (link && chosen && franchiseIds.includes(chosen)) {
    const sessionToken = createSessionToken(
      { userId: `${DEMO_USER_PREFIX}${link.token}`, username: 'Demo guest', franchiseId: chosen, leagueId: league.id, role: 'owner' },
      { expiresAt: link.expiresAt },
    );
    // Through Astro.cookies: Astro.redirect() builds a fresh Response, and
    // only cookies set this way are carried onto it. Same attributes as
    // createSessionCookie (src/utils/session.ts).
    Astro.cookies.set('session_token', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: !import.meta.env.DEV,
      expires: new Date(link.expiresAt * 1000),
    });
    rememberTeam(chosen);
    // Straight into the league: the demo host's root is the pitch page.
    const demoPath = Object.entries(demoLeaguePaths()).find(([, slug]) => slug === league.slug)?.[0];
    return { redirect: Astro.redirect(demoPath ? `/${demoPath}/` : '/'), link, token };
  }
  return { link, token };
}
