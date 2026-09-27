---
/**
 * DEMO ONLY — copied to src/pages/best-ball-1/ by scripts/demo/build-demo-data.mjs.
 * Thin route over the shared SundayTicketPage (see src/pages/theleague/sunday-ticket.astro).
 */
import SundayTicketPage from '../../components/shared/sunday-ticket/SundayTicketPage.astro';
import { rememberSundayTicketChoices } from '../../utils/sunday-ticket-selection';
import { getAuthUser } from '../../utils/auth';
import { resolveViewerPreferences } from '../../utils/viewer-preferences-page';

export const prerender = false;

rememberSundayTicketChoices(Astro.url, Astro.cookies);
const { prefs } = await resolveViewerPreferences(Astro.url, Astro.cookies, getAuthUser(Astro.request));
---

<SundayTicketPage prefs={prefs} />
