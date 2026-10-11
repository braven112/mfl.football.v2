/**
 * POST /api/newsletter/subscribe — the /newsletter signup form's target.
 *
 * A plain form post (no client script), answered with a redirect back to
 * /newsletter carrying a status, so the page works with JavaScript off and has
 * no ClientRouter lifecycle to get wrong. Kit does the actual list work and
 * the double opt-in (src/utils/kit.ts).
 *
 * Unauthenticated, so it is rate-limited per client address, and a filled
 * honeypot field is answered as a success without calling Kit.
 */
import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../../utils/rate-limit';
import { getClientIdentity } from '../../../utils/client-ip';
import { subscribeToNewsletter } from '../../../utils/kit';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const back = (status: 'ok' | 'invalid' | 'busy' | 'closed' | 'error') =>
  new Response(null, { status: 303, headers: { Location: `/newsletter?status=${status}` } });

export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back('invalid');
  }

  // Bots fill every field; people never see this one.
  if (String(form.get('website') ?? '').trim()) return back('ok');

  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const firstName = String(form.get('first_name') ?? '').trim().slice(0, 60);
  if (!EMAIL_RE.test(email) || email.length > 254) return back('invalid');

  const ip = getClientIdentity(request).client ?? 'anon';
  const limit = await checkRateLimit('newsletter-subscribe', ip, 5, 60 * 60);
  if (!limit.allowed) return back('busy');

  const result = await subscribeToNewsletter(email, firstName || undefined);
  if (result.ok) return back('ok');
  if (result.reason === 'not-configured') return back('closed');
  console.error('[newsletter] Kit subscribe failed:', result);
  return back('error');
};
