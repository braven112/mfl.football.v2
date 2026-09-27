/**
 * The demo-link record, shared by the site (src/utils/demo-access.ts) and the
 * owner's CLI (scripts/demo/mint-link.mjs) so both agree on the key and shape.
 * See docs/plans/custom-site-demo.md.
 */
import { randomBytes } from 'node:crypto';

export const DEMO_TOKEN_PREFIX = 'demo:tokens:';
export const DEMO_USER_PREFIX = 'demo:';
export const DEFAULT_DEMO_DAYS = 14;
export const DEMO_START_PATH = '/demo-start';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,64}$/;

/** 24 url-safe characters: unguessable, and short enough to paste. */
export function newDemoToken() {
  return randomBytes(18).toString('base64url');
}

export function isWellFormedDemoToken(token) {
  return typeof token === 'string' && TOKEN_SHAPE.test(token);
}

/** A new link record; the caller stores it with a TTL of `expiresAt - now`. */
export function buildDemoLink({ label, days = DEFAULT_DEMO_DAYS, leadId }, now = Math.floor(Date.now() / 1000)) {
  return {
    token: newDemoToken(),
    type: 'dynasty',
    label: String(label ?? '').slice(0, 120),
    createdAt: now,
    expiresAt: now + Math.round(days * 86_400),
    ...(leadId ? { leadId } : {}),
  };
}
