/**
 * One-off: copy TheLeague's old franchise art from InMotion to Vercel Blob.
 *
 * TheLeague's 2011-2024 MFL seasons load every franchise icon and banner from
 * theleague.us/images/team_banners/…, which InMotion served until theleague.us
 * moved to Vercel. theleague-urls.txt lists every such path the synced MFL
 * feeds name. Each is fetched from InMotion through old.mfl.football (the same
 * cPanel account) and stored in Blob under `theleague.us/<path>`;
 * src/pages/theleague/images/[...path].ts redirects the old URLs there.
 *
 * Writes scripts/inmotion-migration/theleague-report.json. Runs in GitHub
 * Actions (.github/workflows/migrate-theleague-images.yml) because the Claude
 * sandbox cannot reach InMotion.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { list, put } from '@vercel/blob';

const here = path.dirname(fileURLToPath(import.meta.url));
/** theleague.us was the account's main domain (public_html); try an addon folder too. */
const SOURCES = ['https://old.mfl.football', 'https://old.mfl.football/theleague.us'];
const BLOB_PREFIX = 'theleague.us';

const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

async function fetchFile(p) {
  const tried = [];
  for (const source of SOURCES) {
    try {
      const res = await fetch(source + encodeURI(p), { redirect: 'follow' });
      const type = res.headers.get('content-type') ?? '';
      if (res.ok && type.startsWith('image/')) {
        return { ok: true, source, body: Buffer.from(await res.arrayBuffer()) };
      }
      tried.push(`${res.status} ${type}`.trim());
    } catch (err) {
      tried.push(String(err.message || err));
    }
  }
  return { ok: false, detail: tried.join(' | ') };
}

async function run() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[theleague-images] BLOB_READ_WRITE_TOKEN is not set.');
    process.exit(1);
  }
  await list({ limit: 1 });

  const paths = (await fs.readFile(path.join(here, 'theleague-urls.txt'), 'utf8'))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const files = [];
  let blobHost = null;
  for (const p of paths) {
    const got = await fetchFile(p);
    if (!got.ok) {
      files.push({ path: p, status: 'missing', detail: got.detail });
      console.log(`[theleague-images] MISSING ${p} (${got.detail})`);
      continue;
    }
    const ext = p.split('.').pop().toLowerCase();
    const blob = await put(`${BLOB_PREFIX}${p}`, got.body, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: CONTENT_TYPES[ext],
    });
    blobHost ??= new URL(blob.url).origin;
    files.push({ path: p, status: 'blob', bytes: got.body.length, source: got.source });
    console.log(`[theleague-images] BLOB ${p} <- ${got.source}`);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const count = (s) => files.filter((f) => f.status === s).length;
  const report = {
    blobHost,
    blobPrefix: BLOB_PREFIX,
    totals: { blob: count('blob'), missing: count('missing') },
    files,
  };
  await fs.writeFile(path.join(here, 'theleague-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[theleague-images] Done: ${JSON.stringify(report.totals)}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
