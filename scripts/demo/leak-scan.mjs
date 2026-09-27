#!/usr/bin/env node
/**
 * The demo's last line of defence: after `astro build`, search everything the
 * deployment will ship — static pages, client bundles, server functions — for
 * any real franchise or owner name recorded before the demo build deleted the
 * real data (.demo-build/denylist.json, written by build-demo-data.mjs).
 *
 * One hit fails the build. A generator or rename pass can miss a file; this
 * cannot, because it reads the output rather than trusting the inputs.
 *
 *   node scripts/demo/leak-scan.mjs [outputDir] [--report=file.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wasm|zip|gz|br|pdf)$/i;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* walk(p);
    else if (!BINARY.test(entry.name)) yield p;
  }
}

/**
 * @returns {{file: string, term: string, count: number, sample: string}[]}
 */
export function scanForLeaks(outputDir, terms) {
  if (!terms.length) throw new Error('leak-scan: empty denylist — refusing to report a clean scan of nothing');
  const pattern = new RegExp(terms.map(escape).join('|'), 'g');
  const hits = [];
  for (const file of walk(outputDir)) {
    const text = fs.readFileSync(file, 'utf8');
    const counts = new Map();
    let sample = '';
    for (const m of text.matchAll(pattern)) {
      counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
      if (!sample) sample = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).replace(/\s+/g, ' ');
    }
    for (const [term, count] of counts) hits.push({ file: path.relative(outputDir, file), term, count, sample });
  }
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const outputDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(ROOT, '.vercel/output'));
  const reportArg = args.find((a) => a.startsWith('--report='));
  const { terms } = JSON.parse(fs.readFileSync(path.join(ROOT, '.demo-build/denylist.json'), 'utf8'));
  const hits = scanForLeaks(outputDir, terms);
  if (reportArg) fs.writeFileSync(reportArg.slice('--report='.length), JSON.stringify(hits, null, 2));
  if (hits.length) {
    const byTerm = new Map();
    for (const h of hits) byTerm.set(h.term, (byTerm.get(h.term) ?? 0) + h.count);
    console.error(`[leak-scan] FAIL — ${hits.length} file(s) carry real league names:`);
    for (const [term, n] of [...byTerm].sort((a, b) => b[1] - a[1])) console.error(`  ${n}× "${term}"`);
    for (const h of hits.slice(0, 25)) console.error(`  ${h.file}: "${h.term}" ×${h.count} …${h.sample}…`);
    process.exit(1);
  }
  console.log(`[leak-scan] clean — ${terms.length} real names, none in ${outputDir}`);
}
