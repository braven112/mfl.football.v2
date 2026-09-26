#!/usr/bin/env node
/**
 * Issue a private custom-site demo link (docs/plans/custom-site-demo.md).
 *
 *   node scripts/demo/mint-link.mjs --label "Acme Dynasty League" [--days 14]
 *
 * Writes the link to the DEMO deployment's Redis — set DEMO_REDIS_REST_URL and
 * DEMO_REDIS_REST_TOKEN (the values on the demo branch in Vercel) — and prints
 * the URL to send. Never production's Redis: the demo reads its own.
 */
import { Redis } from '@upstash/redis';
import { buildDemoLink, DEMO_START_PATH, DEMO_TOKEN_PREFIX } from '../../src/utils/demo-access-core.mjs';
import { DEMO_HOST, LEAGUES } from '../../src/config/leagues-data.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const label = opt('label');
const days = Number(opt('days', 14));
if (!label || !Number.isFinite(days) || days <= 0) {
  console.error('Usage: node scripts/demo/mint-link.mjs --label "<who it is for>" [--days 14]');
  process.exit(2);
}
const url = process.env.DEMO_REDIS_REST_URL;
const token = process.env.DEMO_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error('Set DEMO_REDIS_REST_URL and DEMO_REDIS_REST_TOKEN (the demo branch values in Vercel).');
  process.exit(2);
}

const link = buildDemoLink({ label, days });
await new Redis({ url, token }).set(`${DEMO_TOKEN_PREFIX}${link.token}`, JSON.stringify(link), {
  ex: link.expiresAt - link.createdAt,
});
console.log(`Demo link for ${label} (expires ${new Date(link.expiresAt * 1000).toDateString()}):`);
console.log(`https://${DEMO_HOST}/${LEAGUES.theleague.demoPath}${DEMO_START_PATH}?t=${link.token}`);
