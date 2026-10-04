#!/usr/bin/env node
/**
 * Refresh src/data/mfl-scoring-codes.json — MFL's scoring-event dictionary
 * (TYPE=allRules: `PY` → "Passing Yards", …), so a league's scoring rules can
 * be explained in words (src/utils/mfl-settings-digest.ts). Global to MFL, not
 * per league, and it changes about never: run by hand when a code shows up
 * undescribed.
 *
 *   node scripts/fetch-mfl-rule-codes.mjs
 *
 * This export is only served from api.myfantasyleague.com.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const year = new Date().getFullYear();
const res = await fetch(`https://api.myfantasyleague.com/${year}/export?TYPE=allRules&JSON=1`);
const body = await res.json();
const rules = body?.allRules?.rule;
if (!Array.isArray(rules) || !rules.length) {
  console.error(`MFL returned no rules: ${JSON.stringify(body).slice(0, 200)}`);
  process.exit(1);
}
const codes = Object.fromEntries(
  rules
    .map((r) => [r.abbreviation?.$t, r.shortDescription?.$t])
    .filter(([k, v]) => k && v)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);
const out = fileURLToPath(new URL('../src/data/mfl-scoring-codes.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(codes, null, 2)}\n`);
console.log(`${Object.keys(codes).length} codes → src/data/mfl-scoring-codes.json`);
