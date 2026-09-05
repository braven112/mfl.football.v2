/**
 * Inline "turn on notifications" prompt.
 *
 * The Owners' Poll now leans on web push — one GroupMe post a day, everything
 * else personal — and that only works if owners have actually granted
 * permission. Today the single opt-in lives on /theleague/notifications, a page
 * almost nobody visits, so this puts the ask where owners already are: on the
 * ballot, and in the lineup strip.
 *
 * Same flow as NotificationSettingsCard (that page keeps ownership of the full
 * settings UI, including turning push OFF and sending a test). This is only the
 * one-tap ON path, so it does not duplicate that surface — it feeds it.
 *
 * Renders nothing at all when push is unsupported, unconfigured, or already
 * granted, so it never nags someone who has already said yes.
 */

import { useCallback, useEffect, useState } from 'react';

interface Props {
  vapidPublicKey: string;
  /** Short reason shown next to the button — why THIS page is asking. */
  reason: string;
}

type State = 'checking' | 'available' | 'working' | 'granted' | 'denied' | 'unsupported' | 'error';

export default function EnablePushButton({ vapidPublicKey, reason }: Props) {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (
        !vapidPublicKey ||
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        if (!cancelled) setState('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setState('denied');
        return;
      }
      // `navigator.serviceWorker.ready` NEVER RESOLVES when no service worker
      // is registered — it does not reject, it just hangs. Awaiting it bare
      // left this component stuck in 'checking' forever, rendering nothing,
      // which for an adoption prompt is the worst possible failure: silently
      // invisible. Race it, and default to showing the button — the click
      // path re-awaits `ready` at a moment when registration is far more
      // likely to be done, and surfaces a real error if it isn't.
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]).catch(() => null);
      if (cancelled) return;
      if (!reg) {
        setState('available');
        return;
      }
      try {
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setState(existing ? 'granted' : 'available');
      } catch {
        if (!cancelled) setState('available');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  const enable = useCallback(async () => {
    setState('working');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'available');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(vapidPublicKey),
        }));

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      const data = await res.json().catch(() => null);
      // The browser subscription exists either way, but if the SERVER never
      // stored it no push will ever arrive — so a failed save is not "granted".
      setState(res.ok && data?.success !== false ? 'granted' : 'error');
    } catch {
      setState('error');
    }
  }, [vapidPublicKey]);

  // Nothing to ask for: unsupported, already on, or the browser has blocked it
  // and only the site settings can undo that.
  if (state === 'checking' || state === 'unsupported' || state === 'granted') return null;

  if (state === 'denied') {
    return (
      <p className="op-push op-push--muted">
        Notifications are blocked for this site in your browser settings.
      </p>
    );
  }

  return (
    <p className="op-push">
      <button type="button" className="op-push__btn" onClick={enable} disabled={state === 'working'}>
        {state === 'working' ? 'Turning on…' : 'Turn on notifications'}
      </button>
      <span className="op-push__why">{reason}</span>
      {state === 'error' && (
        <span className="op-push__err" role="alert">
          {' '}Couldn’t save that — try again from Notification Settings.
        </span>
      )}
    </p>
  );
}

/**
 * VAPID keys arrive base64url; PushManager wants raw bytes.
 *
 * Returns the ArrayBuffer rather than the Uint8Array view: under TypeScript's
 * generic typed arrays a `Uint8Array<ArrayBufferLike>` is not assignable to
 * `BufferSource`, and an ArrayBuffer is — no cast needed.
 */
function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out.buffer;
}
