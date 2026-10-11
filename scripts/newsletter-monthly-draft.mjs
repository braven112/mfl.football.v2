#!/usr/bin/env node
/**
 * Ask production to draft last month's newsletter in Kit.
 *
 * The Kit key lives in Vercel, not in GitHub, so the drafting happens in the
 * route (src/pages/api/newsletter/monthly-draft.ts) and this script is only the
 * monthly knock on its door — the same CRON_SECRET bridge the push fan-out
 * uses. The route is idempotent per month, so a re-run is harmless, and it
 * only ever creates a DRAFT: nothing is emailed until Brandon sends it in Kit.
 *
 * Usage:
 *   node scripts/newsletter-monthly-draft.mjs [--month YYYY-MM] [--dry-run]
 */
import { getLeagueBySlug, leagueUrl } from '../src/config/leagues-data.mjs';

const args = process.argv.slice(2);
const monthIdx = args.indexOf('--month');
const month = monthIdx >= 0 ? args[monthIdx + 1] : '';
const dryRun = args.includes('--dry-run');

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('CRON_SECRET is not set.');
  process.exit(1);
}

const league = getLeagueBySlug('theleague');
const endpoint = new URL(leagueUrl(league, '/api/newsletter/monthly-draft'));
if (month) endpoint.searchParams.set('month', month);
if (dryRun) endpoint.searchParams.set('dryRun', '1');

const res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
  body: '{}',
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text);
if (!res.ok) process.exit(1);
