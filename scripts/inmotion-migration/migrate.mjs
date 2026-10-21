/**
 * One-off: copy the files mfl.football still serves from InMotion onto Vercel,
 * at the same paths, so the mfl.football root can move to Vercel without
 * breaking anything that links to them.
 *
 * Reads scripts/inmotion-migration/urls.txt (every mfl.football root URL the
 * repo references: old AFL franchise icons and banners from the 2016-2024
 * league settings, the AFL skin's logos and scripts, the template's
 * homepage.js). Any CSS or JS it downloads is scanned for further mfl.football
 * files, which are fetched too.
 *
 *   - Images go to Vercel Blob under the same pathname. vercel.json rewrites
 *     /afl-fantasy.com/* to the Blob store, so the old URLs keep working.
 *   - CSS and JS are code, so they are written to public/ at the same path
 *     and committed by the workflow.
 *
 * Writes scripts/inmotion-migration/report.json (sorted, so a re-run of an
 * unchanged server produces the same file).
 *
 * Runs in GitHub Actions (.github/workflows/migrate-inmotion-assets.yml)
 * because the Claude sandbox cannot reach mfl.football.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { list, put } from '@vercel/blob';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const here = path.join(root, 'scripts/inmotion-migration');
const ORIGIN = 'https://mfl.football';
const IMAGE = /\.(png|jpe?g|gif|svg|webp|ico)$/i;
const TEXT = /\.(css|js)$/i;

const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
};

/** Normalize any mfl.football / www.mfl.football URL to a root-relative path. */
function toPath(url) {
  const u = new URL(url, ORIGIN);
  if (u.hostname !== 'mfl.football' && u.hostname !== 'www.mfl.football') return null;
  return decodeURIComponent(u.pathname);
}

/** mfl.football files named inside a downloaded CSS or JS file. */
function referencedPaths(text, fileUrl) {
  const found = new Set();
  for (const m of text.matchAll(/(?:https?:)?\/\/(?:www\.)?mfl\.football\/[^\s"'()<>\\]+/g)) {
    const p = toPath(m[0].startsWith('//') ? `https:${m[0]}` : m[0]);
    if (p) found.add(p);
  }
  // Relative url(...) in CSS resolves against the stylesheet's own URL.
  for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const ref = m[1].trim();
    if (/^(data:|#|https?:|\/\/)/i.test(ref)) continue;
    const p = toPath(new URL(ref, fileUrl).href);
    if (p) found.add(p);
  }
  return [...found].filter((p) => IMAGE.test(p) || TEXT.test(p));
}

async function fetchFile(p) {
  for (const host of ['https://mfl.football', 'https://www.mfl.football']) {
    try {
      const res = await fetch(host + encodeURI(p), { redirect: 'follow' });
      if (res.ok) return { ok: true, body: Buffer.from(await res.arrayBuffer()) };
      if (host.includes('www')) return { ok: false, status: res.status };
    } catch (err) {
      if (host.includes('www')) return { ok: false, status: String(err.message || err) };
    }
  }
  return { ok: false, status: 'unreachable' };
}

async function run() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[inmotion] BLOB_READ_WRITE_TOKEN is not set. Add it as a GitHub Actions secret.');
    process.exit(1);
  }
  // Prove the token works before downloading anything.
  try {
    await list({ limit: 1 });
    console.log('[inmotion] Blob token OK.');
  } catch (err) {
    console.error(`[inmotion] Blob token rejected: ${err.message || err}`);
    process.exit(1);
  }

  const listed = (await fs.readFile(path.join(here, 'urls.txt'), 'utf8'))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map(toPath)
    .filter(Boolean);

  const queue = [...new Set(listed)];
  const seen = new Set(queue);
  const results = [];
  let blobHost = null;

  while (queue.length) {
    const p = queue.shift();
    const got = await fetchFile(p);
    if (!got.ok) {
      results.push({ path: p, status: 'missing', detail: String(got.status) });
      console.log(`[inmotion] MISSING ${p} (${got.status})`);
      continue;
    }

    if (IMAGE.test(p)) {
      const ext = p.split('.').pop().toLowerCase();
      const blob = await put(p.replace(/^\//, ''), got.body, {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: CONTENT_TYPES[ext],
      });
      blobHost ??= new URL(blob.url).origin;
      results.push({ path: p, status: 'blob', bytes: got.body.length });
    } else {
      const dest = path.join(root, 'public', p);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, got.body);
      results.push({ path: p, status: 'public', bytes: got.body.length });
      for (const ref of referencedPaths(got.body.toString('utf8'), ORIGIN + p)) {
        if (!seen.has(ref)) {
          seen.add(ref);
          queue.push(ref);
        }
      }
    }
    console.log(`[inmotion] ${results.at(-1).status.toUpperCase()} ${p}`);
  }

  results.sort((a, b) => a.path.localeCompare(b.path));
  const count = (s) => results.filter((r) => r.status === s).length;
  const report = {
    blobHost,
    totals: { blob: count('blob'), public: count('public'), missing: count('missing') },
    files: results,
  };
  await fs.writeFile(path.join(here, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[inmotion] Done: ${JSON.stringify(report.totals)} blobHost=${blobHost}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
