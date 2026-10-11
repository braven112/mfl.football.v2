/**
 * Kit (formerly ConvertKit) — the newsletter's subscriber list and sender.
 *
 * Kit owns everything a mailing list has to get right: double opt-in, the
 * unsubscribe link and header, the postal-address footer CAN-SPAM requires,
 * bounces and suppression. This site never stores a subscriber or sends a
 * newsletter itself; it only (a) adds an address to the signup form, which
 * starts Kit's double opt-in, and (b) creates a broadcast DRAFT that Brandon
 * reviews and sends from Kit. Nothing here can send an email.
 *
 * Auth is a v4 API key in `KIT_API_SECRET` (Vercel env), sent as the
 * `X-Kit-Api-Key` header. Every call fails soft and reports why, so a missing
 * key degrades the signup page to a message rather than a 500.
 */

const KIT_API = 'https://api.kit.com/v4';

/**
 * The Kit signup form the newsletter page subscribes into. Not a secret: it is
 * the same id Kit's own embed code prints. Double opt-in is switched on in the
 * form's settings in Kit, not here. `null` until the form exists — the page
 * then says signups are not open yet instead of failing.
 */
export const KIT_NEWSLETTER_FORM_ID: string | null = null;

export type KitResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not-configured' | 'rejected' | 'unreachable'; status?: number; detail?: string };

function apiKey(): string | undefined {
  return process.env.KIT_API_SECRET || undefined;
}

export function isKitConfigured(): boolean {
  return Boolean(apiKey());
}

async function kitFetch<T>(path: string, init: { method: string; body?: unknown }): Promise<KitResult<T>> {
  const key = apiKey();
  if (!key) return { ok: false, reason: 'not-configured' };
  let res: Response;
  try {
    res = await fetch(`${KIT_API}${path}`, {
      method: init.method,
      headers: {
        'X-Kit-Api-Key': key,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { ok: false, reason: 'unreachable', detail: String(err) };
  }
  const text = await res.text();
  if (!res.ok) return { ok: false, reason: 'rejected', status: res.status, detail: text.slice(0, 300) };
  try {
    return { ok: true, data: (text ? JSON.parse(text) : {}) as T };
  } catch {
    return { ok: false, reason: 'rejected', status: res.status, detail: 'non-JSON response' };
  }
}

/**
 * Subscribe an address through the newsletter form. The subscriber is created
 * `inactive` and then added to the form, so Kit sends the form's confirmation
 * email and only a click makes them active — the address is never mailed a
 * newsletter on the strength of this request alone.
 */
export async function subscribeToNewsletter(email: string, firstName?: string): Promise<KitResult> {
  if (!KIT_NEWSLETTER_FORM_ID) return { ok: false, reason: 'not-configured' };
  const created = await kitFetch('/subscribers', {
    method: 'POST',
    body: { email_address: email, first_name: firstName || undefined, state: 'inactive' },
  });
  if (!created.ok) return created;
  return kitFetch(`/forms/${encodeURIComponent(KIT_NEWSLETTER_FORM_ID)}/subscribers`, {
    method: 'POST',
    body: { email_address: email },
  });
}

interface KitBroadcast {
  id: number;
  subject: string;
}

/** Recent broadcasts (drafts included), newest first — used to stay idempotent. */
export async function listRecentBroadcasts(): Promise<KitResult<KitBroadcast[]>> {
  const res = await kitFetch<{ broadcasts?: KitBroadcast[] }>('/broadcasts?per_page=50', { method: 'GET' });
  if (!res.ok) return res;
  return { ok: true, data: res.data.broadcasts ?? [] };
}

/**
 * Create a broadcast as a DRAFT: no `send_at`, not public. It appears under
 * Broadcasts in Kit for Brandon to read, edit and send himself.
 */
export async function createBroadcastDraft(draft: {
  subject: string;
  previewText: string;
  html: string;
  description: string;
}): Promise<KitResult<{ broadcast?: KitBroadcast }>> {
  return kitFetch('/broadcasts', {
    method: 'POST',
    body: {
      subject: draft.subject,
      preview_text: draft.previewText,
      content: draft.html,
      description: draft.description,
      public: false,
      send_at: null,
    },
  });
}
