/**
 * One-shot VAPID key generator for web push notifications.
 *
 * Usage: node scripts/generate-vapid-keys.mjs   (or: pnpm generate:vapid)
 *
 * Prints a fresh VAPID key pair formatted for the Vercel env dashboard.
 * Run it ONCE per deployment environment — rotating the keys invalidates
 * every stored push subscription (browsers reject pushes signed with a
 * different key than the one they subscribed with), so don't regenerate
 * casually. See docs/features/web-push.md for the full setup walkthrough.
 */

import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Web Push VAPID keys generated. Add these to Vercel env (all environments):

  VAPID_PUBLIC_KEY=${publicKey}
  VAPID_PRIVATE_KEY=${privateKey}
  PUBLIC_VAPID_PUBLIC_KEY=${publicKey}

Notes:
  - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are server-only (used to sign pushes).
  - PUBLIC_VAPID_PUBLIC_KEY is the SAME public key, exposed to the client
    bundle (Astro only exposes PUBLIC_-prefixed vars via import.meta.env) so
    the browser can subscribe with it.
  - Optionally set VAPID_SUBJECT to a mailto: or https: contact URL
    (defaults to mailto:admin@theleague.us).
  - After setting the vars, redeploy and run 'pnpm dlx vercel env pull' to
    refresh your local .env.local.
  - Do NOT rotate these once owners have subscribed — existing
    subscriptions die with the old key.
`);
