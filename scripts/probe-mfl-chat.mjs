/**
 * Which MFL request reads a league's chat, and which one posts to it?
 *
 * Read-only probe, temporary (Package N of the phone app). It only issues GETs,
 * writes nothing to MFL, and prints no secret.
 *
 *   Round 1 read MFL's API reference; round 2 (below) reads the chat
 *   file's shape for TheLeague and the AFL, with and without the cookie.
 *
 * Run: node scripts/probe-mfl-chat.mjs   (MFL_USER_ID required)
 */

import { LEAGUES } from '../src/config/leagues-data.mjs';
import { mflFetch } from './lib/mfl-api.mjs';

const cookie = process.env.MFL_USER_ID;
if (!cookie) {
  console.error('Set MFL_USER_ID.');
  process.exit(1);
}

const league = LEAGUES.theleague;
const year = new Date().getFullYear();

// Round 1 (MFL's reference) found it: there is NO chat export. Posting is
// `import?TYPE=chat_save` (MESSAGE, optional TO_FID); reading is the static
// file `<host>/fflnetdynamic<year>/<league>_chat.xml`, 404 when empty.
// Round 2 reads that file's SHAPE only: element and attribute names, counts,
// value lengths, timestamps. No message text or owner name is printed,
// because Actions logs outlive this probe.
const shape = (xml) => {
  const tags = {};
  for (const m of xml.matchAll(/<([A-Za-z_][\w-]*)((?:\s+[\w-]+="[^"]*")*)\s*\/?>/g)) {
    const t = (tags[m[1]] ??= { count: 0, attrs: {} });
    t.count++;
    for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) {
      const at = (t.attrs[a[1]] ??= { maxLen: 0, numeric: true, sample: null });
      at.maxLen = Math.max(at.maxLen, a[2].length);
      if (!/^\d+$/.test(a[2])) at.numeric = false;
      if (/^\d{4}$|^\d{9,11}$/.test(a[2]) && at.sample === null) at.sample = a[2];
    }
  }
  return tags;
};

// Round 2 found the shape: <message franchise_id id message posted/>, the
// file public (same bytes with or without the cookie), no .json variant.
// Round 3 prints what the parser and the unread count depend on, still
// without message text: the `posted` format, the id alphabet, and whether
// document order is oldest-first.
const lg = LEAGUES['afl-fantasy'];
const res = await fetch(`https://${lg.mflHost}/fflnetdynamic${year - 1}/${lg.id}_chat.xml`);
const xml = await res.text();
const rows = [...xml.matchAll(/<message\s([^>]*?)\/?>/g)].map((m) => {
  const at = {};
  for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) at[a[1]] = a[2];
  return at;
});
console.log(`rows ${rows.length}`);
const show = (r) => ({
  posted: r.posted,
  parsed: new Date(r.posted).toISOString?.() ?? null,
  idPattern: (r.id ?? '').replace(/[0-9]/g, '9').replace(/[a-f]/g, 'h').replace(/[g-zG-Z]/g, 'A'),
  franchise: r.franchise_id,
  textLen: (r.message ?? '').length,
  hasEntities: /&\w+;|&#\d+;/.test(r.message ?? ''),
});
for (const r of [...rows.slice(0, 3), ...rows.slice(-3)]) {
  try { console.log(JSON.stringify(show(r))); } catch (e) { console.log(JSON.stringify({ posted: r.posted, err: e.message })); }
}
const times = rows.map((r) => Date.parse(r.posted));
console.log(`all posted parse: ${times.every((t) => !Number.isNaN(t))}`);
console.log(`oldest-first: ${times.every((t, i) => !i || t >= times[i - 1])}, newest-first: ${times.every((t, i) => !i || t <= times[i - 1])}`);
console.log(`ids unique: ${new Set(rows.map((r) => r.id)).size === rows.length}`);
console.log(`ids sort like time: ${rows.every((r, i) => !i || r.id >= rows[i - 1].id)}`);
