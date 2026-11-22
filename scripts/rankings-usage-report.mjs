// One-off, READ-ONLY: who uses the owner ranking tools? Prints aggregates only.
import { LEAGUES } from '../src/config/leagues-data.mjs';
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
if (!URL_ || !TOK) { console.log('no redis env'); process.exit(1); }
const READ = new Set(['SCAN', 'GET', 'HGETALL', 'TYPE', 'STRLEN']);
async function cmd(...a) {
  if (!READ.has(a[0])) throw new Error('read-only');
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOK}` }, body: JSON.stringify(a) });
  const j = await r.json(); if (j.error) throw new Error(j.error); return j.result;
}
async function scan(match) {
  let cur = '0', out = [];
  do { const [c, keys] = await cmd('SCAN', cur, 'MATCH', match, 'COUNT', '1000'); cur = c; out.push(...keys); } while (cur !== '0');
  return [...new Set(out)].sort();
}
function dates(v, acc = []) {
  if (typeof v === 'string' && /^20\d\d-\d\d-\d\dT/.test(v)) acc.push(v);
  else if (typeof v === 'number' && v > 1.6e12 && v < 2e12) acc.push(new Date(v).toISOString());
  else if (v && typeof v === 'object') for (const x of Object.values(v)) dates(x, acc);
  return acc;
}
function summarize(raw) {
  let v = raw; try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
  const d = dates(v).sort();
  let imports = null, userImports = null, players = null;
  const arr = Array.isArray(v) ? v : (v && (v.imports || v.rankings || v.players || v.playerIds));
  if (Array.isArray(arr)) { imports = arr.length; userImports = arr.filter(x => x && typeof x === 'object' && !x.provided).length; }
  if (v && Array.isArray(v.playerIds)) players = v.playerIds.length;
  return { bytes: (typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')).length, entries: imports, userEntries: userImports, players, topKeys: v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).slice(0, 8).join(',') : Array.isArray(v) ? 'array' : typeof v, first: d[0] || '-', last: d.at(-1) || '-' };
}
for (const prefix of ['ri:*', 'cr:*', 'dl:snapshot:*']) {
  const keys = await scan(prefix);
  console.log(`\n== ${prefix}  (${keys.length} keys)`);
  for (const k of keys) {
    const t = await cmd('TYPE', k);
    const raw = t === 'string' ? await cmd('GET', k) : null;
    console.log(k, t, JSON.stringify(raw == null ? {} : summarize(raw)));
  }
}
const RX = /import-rankings|\/cr(\/|$|\?)|custom-rankings|my-rankings|\/rankings/;
console.log('\n== page visits to ranking pages (all-time counters, per franchise)');
for (const [slug, L] of Object.entries(LEAGUES)) {
  const id = L.id; if (!id) continue;
  const keys = await scan(`pages:${id}:*`);
  for (const k of keys) {
    const h = await cmd('HGETALL', k); if (!Array.isArray(h)) continue;
    let total = 0; const hits = [];
    for (let i = 0; i < h.length; i += 2) { const n = Number(h[i + 1]) || 0; total += n; if (RX.test(h[i])) hits.push(`${h[i]}=${n}`); }
    if (hits.length) console.log(slug, k.split(':').at(-1), `totalViews=${total}`, hits.join(' '));
  }
  const g = await cmd('HGETALL', `pages:${id}`);
  if (Array.isArray(g)) { const hits = []; for (let i = 0; i < g.length; i += 2) if (RX.test(g[i])) hits.push(`${g[i]}=${g[i+1]}`); console.log(slug, 'ALL', hits.join(' ') || '(none)'); }
}
