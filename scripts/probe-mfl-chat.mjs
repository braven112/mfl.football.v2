/**
 * Which MFL request reads a league's chat, and which one posts to it?
 *
 * Read-only probe, temporary (Package N of the phone app). It only issues GETs,
 * writes nothing to MFL, and prints no secret.
 *
 *   1. MFL's own API reference (`api_info?STATE=details`, public HTML), reduced
 *      to every export/import TYPE name plus the full text of any entry that
 *      mentions chat or messages.
 *   2. Each chat-looking export TYPE the reference names, read once with the
 *      owner cookie against TheLeague, printing the status and the first 1500
 *      characters of the body (message text included, which is league chat
 *      the cookie's owner can already read).
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

const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(tr|p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n');

console.log('=== 1. MFL API reference ===');
const docRes = await fetch(`https://api.myfantasyleague.com/${year}/api_info?STATE=details`);
const docHtml = await docRes.text();
console.log(`status ${docRes.status}, ${docHtml.length} bytes`);

const types = new Set();
for (const m of docHtml.matchAll(/TYPE=([A-Za-z_]+)/g)) types.add(m[1]);
console.log(`TYPE names linked on the page (${types.size}): ${[...types].sort().join(', ')}`);

const text = strip(docHtml);
const lines = text.split('\n');
const hits = new Set();
lines.forEach((line, i) => {
  if (/chat|message/i.test(line)) {
    for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 12); j++) hits.add(j);
  }
});
console.log('--- every passage mentioning chat or message ---');
let last = -2;
for (const j of [...hits].sort((a, b) => a - b)) {
  if (j !== last + 1) console.log('...');
  console.log(lines[j].trim());
  last = j;
}

console.log('\n=== 2. Chat-looking exports, read with the owner cookie ===');
const candidates = [...types].filter((t) => /chat|message/i.test(t));
for (const extra of ['chat', 'chatMessages', 'leagueChat', 'messageBoard']) {
  if (!candidates.includes(extra)) candidates.push(extra);
}
for (const type of candidates) {
  const url = `https://${league.mflHost}/${year}/export?TYPE=${type}&L=${league.id}&JSON=1`;
  try {
    const res = await mflFetch({ url, cookies: { MFL_USER_ID: cookie } });
    const body = await res.text();
    console.log(`\n--- export TYPE=${type}: status ${res.status}, ${body.length} bytes ---`);
    console.log(body.slice(0, 1500));
  } catch (err) {
    console.log(`\n--- export TYPE=${type}: failed: ${err.message}`);
  }
}
