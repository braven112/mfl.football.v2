#!/usr/bin/env node
/**
 * Scan our own MFL league pages, year by year, for injected redirect/obfuscated
 * scripts — and report whether the schedule content is actually present.
 *
 * Read-only. Fetches only this repo's own leagues, resolved from the league
 * registry and year-host-map. Writes nothing anywhere.
 *
 * Context (2026-08-12): the AFL's league pages carry a malicious script that
 * redirects traffic. The commissioner cleaned 2019; 2020 and several
 * pre-2019 seasons are still affected. That injection — not privacy settings,
 * and not missing data — is why every automated read of those seasons' schedule
 * pages came back with no matchups while 2019 parsed perfectly.
 *
 * So this answers two questions in one pass:
 *   1. SECURITY — what is injected, on which seasons, and what does it look
 *      like, so it can be found and removed from the league's custom content.
 *   2. DATA — does the schedule table survive on the page once you ignore the
 *      injected script, i.e. is this season recoverable now or only after
 *      cleanup.
 *
 * A clean season (2019) is the control: run it alongside a dirty one and the
 * difference is the payload.
 *
 * Usage:
 *   node scripts/scan-mfl-page-injection.mjs --league=afl
 *   node scripts/scan-mfl-page-injection.mjs --league=afl --years=2019,2020
 *   node scripts/scan-mfl-page-injection.mjs --league=afl --years=2020 --show
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const argOf = (name, fallback) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const SHOW = args.includes('--show');

const SLUG = argOf('league', 'afl') === 'afl' ? 'afl-fantasy' : argOf('league', 'afl');
const league = getLeagueBySlug(SLUG);
if (!league) {
  console.error(`Unknown --league=${SLUG}`);
  process.exit(1);
}

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};
const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

const hostMap = readJson(path.join(ROOT, league.dataPath, 'year-host-map.json'));
const yearsArg = argOf('years', null);
const YEARS = yearsArg
  ? yearsArg.split(',').map((y) => y.trim()).filter(Boolean)
  : Object.keys(hostMap?.years ?? {}).sort();

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Hosts that legitimately appear on an MFL page. Anything else loading script
// is worth a look — this list is deliberately short so the report errs toward
// showing too much rather than hiding the thing we are hunting.
const EXPECTED_HOSTS = [
  'myfantasyleague.com',
  'mflcdn.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googlesyndication.com',
  'doubleclick.net',
  'gstatic.com',
  'googleapis.com',
  'jquery.com',
  'cloudflare.com',
];

// Patterns that make an inline script worth reading. Redirects and the usual
// obfuscation wrappers used to hide them.
const SUSPICIOUS_PATTERNS = [
  { name: 'location assignment', re: /(?:window|document|top|self|parent)\s*\.\s*location\s*(?:\.\s*(?:href|replace|assign)\s*)?=/i },
  { name: 'location.replace()', re: /location\s*\.\s*(?:replace|assign)\s*\(/i },
  { name: 'window.open()', re: /window\s*\.\s*open\s*\(/i },
  { name: 'meta refresh', re: /<meta[^>]+http-equiv\s*=\s*["']?refresh/i },
  { name: 'eval()', re: /\beval\s*\(/ },
  { name: 'atob() / base64 decode', re: /\batob\s*\(/ },
  { name: 'unescape()', re: /\bunescape\s*\(/ },
  { name: 'String.fromCharCode', re: /String\s*\.\s*fromCharCode/ },
  { name: 'document.write(script)', re: /document\s*\.\s*write[^;]*<script/i },
  { name: 'long hex/obfuscated blob', re: /(?:\\x[0-9a-f]{2}){12,}/i },
];

const hostOf = (url) => {
  try {
    return new URL(url, 'https://x.invalid').hostname.toLowerCase();
  } catch {
    return '';
  }
};
const isExpectedHost = (h) =>
  !h || h === 'x.invalid' || EXPECTED_HOSTS.some((e) => h === e || h.endsWith(`.${e}`));

function scanHtml(html) {
  const findings = [];

  // External script/iframe sources pointing somewhere unexpected.
  const srcRe = /<(script|iframe)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = srcRe.exec(html))) {
    const h = hostOf(m[2]);
    if (!isExpectedHost(h)) {
      findings.push({ kind: `external ${m[1]}`, detail: m[2].slice(0, 200), host: h });
    }
  }

  // Inline scripts matching any redirect/obfuscation pattern.
  const inlineRe = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = inlineRe.exec(html))) {
    const body = m[1];
    if (!body.trim()) continue;
    for (const p of SUSPICIOUS_PATTERNS) {
      if (!p.re.test(body)) continue;
      const at = body.search(p.re);
      findings.push({
        kind: `inline script: ${p.name}`,
        detail: body.slice(Math.max(0, at - 60), at + 180).replace(/\s+/g, ' ').trim(),
        host: '',
      });
      break; // one finding per script is enough to locate it
    }
  }

  if (/<meta[^>]+http-equiv\s*=\s*["']?refresh/i.test(html)) {
    findings.push({ kind: 'meta refresh redirect', detail: '', host: '' });
  }
  return findings;
}

/** Does the schedule table survive on this page? */
function scheduleSignal(html, names) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  // MFL prints results as "W @ABC (123.45-67.89)" — the shape the recovery
  // parser consumes. Counting it directly is the honest test of "is the data
  // on this page", independent of any team-name heuristic.
  const games = text.match(/[WLT]\s+@?[A-Z0-9]{2,6}\s*\(\s*[\d.]+\s*-\s*[\d.]+\s*\)/g) ?? [];
  const namesFound = names.filter((n) => text.includes(n)).length;
  return { games: games.length, namesFound };
}

function franchiseNames(year) {
  const lg = readJson(path.join(ROOT, league.dataPath, 'mfl-feeds', String(year), 'league.json'));
  return toArray(lg?.league?.franchises?.franchise)
    .map((f) => String(f.name ?? '').trim())
    .filter((n) => n.length >= 4);
}

console.log(`Scanning ${SLUG} league pages for injected scripts — ${YEARS.length} season(s)\n`);

const rows = [];
for (const year of YEARS) {
  const entry = hostMap?.years?.[year];
  if (!entry) continue;
  const host = entry.host.includes('.') ? entry.host : `${entry.host}.myfantasyleague.com`;
  const lid = entry.leagueId;
  const names = franchiseNames(year);

  // The league home page carries the custom content most injections live in;
  // the schedule page is the one we need clean for recovery.
  const targets = [
    { label: 'home', url: `https://${host}/${year}/home/${lid}` },
    { label: 'schedule', url: `https://${host}/${year}/options?L=${lid}&O=17` },
  ];

  for (const t of targets) {
    let status = '—';
    let findings = [];
    let signal = { games: 0, namesFound: 0 };
    let bytes = 0;
    try {
      const res = await fetch(t.url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
      status = String(res.status);
      const html = await res.text();
      bytes = html.length;
      if (res.status === 200) {
        findings = scanHtml(html);
        signal = scheduleSignal(html, names);
      }
    } catch (err) {
      status = `error: ${err.message}`;
    }
    rows.push({ year, page: t.label, status, bytes, findings, ...signal });
    const flag = findings.length ? `  <-- ${findings.length} SUSPICIOUS` : '';
    console.log(
      `${year} ${t.label.padEnd(9)} HTTP ${status.padStart(3)}  ${String(bytes).padStart(7)}B  games=${String(signal.games).padStart(4)}  names=${signal.namesFound}/${names.length}${flag}`
    );
    for (const f of findings.slice(0, SHOW ? 20 : 2)) {
      console.log(`     • ${f.kind}${f.host ? ` [${f.host}]` : ''}`);
      if (SHOW && f.detail) console.log(`       ${f.detail.slice(0, 300)}`);
    }
    await sleep(1500);
  }
}

const dirty = rows.filter((r) => r.findings.length > 0);
const clean = rows.filter((r) => r.status === '200' && r.findings.length === 0);
const recoverable = rows.filter((r) => r.page === 'schedule' && r.games >= 20);

console.log('\n--- summary ---');
console.log(
  dirty.length
    ? `INJECTION FOUND on ${dirty.length} page(s): ${[...new Set(dirty.map((r) => `${r.year}/${r.page}`))].join(', ')}`
    : 'No injected scripts detected on any scanned page.'
);
console.log(`Clean pages: ${clean.length}`);
console.log(
  recoverable.length
    ? `Schedule data VISIBLE for: ${[...new Set(recoverable.map((r) => r.year))].join(', ')} — these can be recovered now.`
    : 'No season currently renders its schedule to an anonymous request.'
);
const offHosts = [...new Set(dirty.flatMap((r) => r.findings.map((f) => f.host).filter(Boolean)))];
if (offHosts.length) console.log(`Unexpected hosts referenced: ${offHosts.join(', ')}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [
    `### MFL page injection scan — ${SLUG}`,
    '',
    '| Season | Page | HTTP | Bytes | Games visible | Suspicious |',
    '|---|---|---:|---:|---:|---|',
    ...rows.map(
      (r) =>
        `| ${r.year} | ${r.page} | ${r.status} | ${r.bytes} | ${r.games} | ${r.findings.length ? `**${r.findings.map((f) => f.kind).join('; ')}**` : '—'} |`
    ),
    '',
    dirty.length ? `**Injection found on:** ${[...new Set(dirty.map((r) => `${r.year}/${r.page}`))].join(', ')}` : 'No injected scripts detected.',
    offHosts.length ? `**Unexpected hosts:** ${offHosts.join(', ')}` : '',
    recoverable.length ? `**Recoverable now:** ${[...new Set(recoverable.map((r) => r.year))].join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}
