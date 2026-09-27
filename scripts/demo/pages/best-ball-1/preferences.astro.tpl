---
/**
 * DEMO ONLY — copied to src/pages/best-ball-1/ by scripts/demo/build-demo-data.mjs.
 * The real best-ball league has no Preferences route; the demo tour card
 * points every demo at one. Thin route over the shared PreferencesPage.
 */
import PreferencesPage from '../../components/shared/preferences/PreferencesPage.astro';
import { loginUrlForRequest } from '../../utils/login-redirect';
import { getAuthUser } from '../../utils/auth';
import { resolveViewerPreferences, hasPreferenceParams } from '../../utils/viewer-preferences-page';
import { getLeagueBySlug, leagueClock } from '../../config/leagues';

export const prerender = false;

const league = getLeagueBySlug('best-ball-1')!;
const user = getAuthUser(Astro.request);
const { prefs, savedToAccount } = await resolveViewerPreferences(Astro.url, Astro.cookies, user);
---

<PreferencesPage
  prefs={prefs}
  title={`Preferences | ${league.name}`}
  pathname="/best-ball-1/preferences"
  sundayTicketPath="/best-ball-1/sunday-ticket"
  justSaved={hasPreferenceParams(Astro.url)}
  syncedToAccount={savedToAccount}
  loginPath={user ? null : loginUrlForRequest(Astro, league)}
  officialClock={leagueClock('best-ball-1')}
  throwback={null}
  scoreboardPath="/best-ball-1/live-scoring"
/>
