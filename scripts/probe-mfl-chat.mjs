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

for (const slug of ['theleague', 'afl-fantasy']) {
  const lg = LEAGUES[slug];
  for (const y of [year, year - 1]) {
    for (const ext of ['xml', 'json']) {
      const url = `https://${lg.mflHost}/fflnetdynamic${y}/${lg.id}_chat.${ext}`;
      for (const withCookie of [false, true]) {
        try {
          const res = withCookie
            ? await mflFetch({ url, cookies: { MFL_USER_ID: cookie } })
            : await fetch(url);
          const body = await res.text();
          console.log(`\n--- ${slug} ${y} .${ext} cookie=${withCookie}: status ${res.status}, ${body.length} bytes, content-type ${res.headers.get('content-type')}, last-modified ${res.headers.get('last-modified')}, cache-control ${res.headers.get('cache-control')}`);
          if (res.status === 200 && ext === 'xml') {
            console.log('first 120 chars, letters masked:', body.slice(0, 120).replace(/[A-Za-z0-9](?![^<]*>)/g, 'x'));
            console.log(JSON.stringify(shape(body), null, 1));
            const ts = [...body.matchAll(/time(?:stamp)?="(\d+)"/g)].map((m) => Number(m[1]));
            if (ts.length) console.log(`timestamps: n=${ts.length} first=${ts[0]} last=${ts[ts.length - 1]} sortedAsc=${ts.every((v, i) => !i || v >= ts[i - 1])}`);
          }
        } catch (err) {
          console.log(`\n--- ${slug} ${y} .${ext} cookie=${withCookie}: failed: ${err.message}`);
        }
      }
    }
  }
}
