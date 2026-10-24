/**
 * One-off: copy the files the missed-files report (scripts/report-missed-files.mjs)
 * found pages still loading from mfl.football after the cutover, so they stop
 * depending on the InMotion backup before it is cancelled.
 *
 * Reads scripts/inmotion-migration/missed-urls.txt (one root-relative path per
 * line), downloads each from old.mfl.football, and writes it to public/ at the
 * same path. Any CSS or JS it downloads is scanned for further mfl.football
 * files, which are fetched too. Everything goes to public/: the set is small,
 * and a static file is served before any route, so the old URL needs no
 * routing at all.
 *
 * Writes scripts/inmotion-migration/missed-report.json (sorted, so a re-run
 * of an unchanged server produces the same file).
 *
 * Runs in GitHub Actions (.github/workflows/copy-missed-inmotion-files.yml)
 * because the Claude sandbox cannot reach InMotion. Node built-ins only.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const here = path.join(root, 'scripts/inmotion-migration');
const SOURCE = 'https://old.mfl.football';
const FILE = /\.(png|jpe?g|gif|svg|webp|ico|css|js)$/i;
const TEXT = /\.(css|js)$/i;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

/** Normalize an mfl.football URL to a root-relative path, or null for any other host. */
function toPath(url) {
  const u = new URL(url, SOURCE);
  if (!['mfl.football', 'www.mfl.football', 'old.mfl.football'].includes(u.hostname)) return null;
  return decodeURIComponent(u.pathname);
}

/** mfl.football files named inside a downloaded CSS or JS file. */
function referencedPaths(text, fileUrl) {
  const found = new Set();
  for (const m of text.matchAll(/(?:https?:)?\/\/(?:www\.|old\.)?mfl\.football\/[^\s"'()<>\\]+/g)) {
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
  return [...found].filter((p) => FILE.test(p));
}

async function fetchFile(p) {
  try {
    const res = await fetch(SOURCE + encodeURI(p), {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Referer: 'https://mfl.football/' },
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, body: Buffer.from(await res.arrayBuffer()) };
  } catch (err) {
    return { ok: false, status: String(err.message || err) };
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const listed = (await fs.readFile(path.join(here, 'missed-urls.txt'), 'utf8'))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const queue = [...new Set(listed)];
  const seen = new Set(queue);
  const results = [];

  while (queue.length) {
    const p = queue.shift();
    const dest = path.join(root, 'public', p);
    if (await exists(dest)) {
      results.push({ path: p, status: 'already-public' });
      console.log(`[missed] ALREADY ${p}`);
      continue;
    }
    const got = await fetchFile(p);
    if (!got.ok) {
      results.push({ path: p, status: 'missing', detail: String(got.status) });
      console.log(`[missed] MISSING ${p} (${got.status})`);
      continue;
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, got.body);
    results.push({ path: p, status: 'public', bytes: got.body.length });
    console.log(`[missed] PUBLIC ${p} (${got.body.length} bytes)`);
    if (TEXT.test(p)) {
      for (const ref of referencedPaths(got.body.toString('utf8'), SOURCE + p)) {
        if (!seen.has(ref)) {
          seen.add(ref);
          queue.push(ref);
        }
      }
    }
  }

  results.sort((a, b) => a.path.localeCompare(b.path));
  const count = (s) => results.filter((r) => r.status === s).length;
  const report = {
    source: SOURCE,
    totals: {
      public: count('public'),
      alreadyPublic: count('already-public'),
      missing: count('missing'),
    },
    files: results,
  };
  await fs.writeFile(path.join(here, 'missed-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[missed] Done: ${JSON.stringify(report.totals)}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
