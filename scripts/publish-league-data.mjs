#!/usr/bin/env node
/**
 * Publish league data to Vercel Blob and write the manifest the function
 * bundles. Runs after prebuild (package.json), so it sees the data the build
 * just derived. See scripts/lib/league-data-store.mjs for the design.
 *
 * Three modes, decided by the environment:
 *   - BLOB_READ_WRITE_TOKEN set: upload what the store lacks, write the
 *     manifest with the store's base URL. This is every real deploy.
 *   - LEAGUE_DATA_STORE=measure (CI's Function size job): write the manifest
 *     with a placeholder base and upload nothing, so the build leaves out
 *     exactly what a real deploy would and the measurement is honest.
 *   - Neither: no manifest. The site reads every file off disk, as before.
 *     That is right for a laptop, and FATAL on a Vercel build: pages read
 *     through the loader would have nothing to read, so the deploy fails here
 *     with the reason instead of shipping blank pages.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MANIFEST_PATH, hashStoreFiles } from './lib/league-data-store.mjs';
import { existingBlobs, upload } from './lib/league-data-blob.mjs';
import { LEAGUE_DATA_SCHEMA } from '../src/config/league-data-live.mjs';

const MEASURE_BASE = 'measure://';
function writeManifest(base, files) {
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify({ schema: LEAGUE_DATA_SCHEMA, base, files }));
}

async function main() {
  const start = Date.now();
  const files = hashStoreFiles();
  const count = Object.keys(files).length;

  if (process.env.LEAGUE_DATA_STORE === 'measure') {
    writeManifest(MEASURE_BASE, files);
    console.log(`[league-data] measure mode: manifest for ${count} files, nothing uploaded`);
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    rmSync(MANIFEST_PATH, { force: true });
    if (process.env.VERCEL_GIT_COMMIT_SHA) {
      console.error(
        '[league-data] BLOB_READ_WRITE_TOKEN is not set for this build. League data is read from ' +
          'Vercel Blob in production, so this deploy would serve pages with no data. Add the token to ' +
          "the project's build environment (Vercel → Settings → Environment Variables).",
      );
      process.exit(1);
    }
    console.log('[league-data] no store token: pages read league data off disk');
    return;
  }

  const { list, put } = await import('@vercel/blob');
  const existing = await existingBlobs(list);
  const missing = {};
  const seen = new Set(existing.hashes);
  for (const [path, hash] of Object.entries(files)) {
    if (seen.has(hash)) continue;
    seen.add(hash); // identical files (a players.json in every league) upload once
    missing[path] = hash;
  }
  const { base: uploadedBase, uploaded } = await upload(missing, put);
  const base = existing.base ?? uploadedBase;
  if (!base) throw new Error('[league-data] store is empty and nothing was uploaded');
  writeManifest(base, files);
  console.log(
    `[league-data] ${count} files, ${uploaded} uploaded, ${count - Object.keys(missing).length} already stored (${Date.now() - start} ms)`,
  );
}

main().catch((err) => {
  console.error('[league-data] publish failed:', err?.message ?? err);
  process.exit(1);
});
