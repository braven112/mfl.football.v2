/**
 * The Vercel Blob half of the league-data store, shared by the build's publish
 * step (scripts/publish-league-data.mjs) and the live pointer
 * (scripts/league-data-pointer.mjs). Blobs are named by content hash, so an
 * upload of a file the store already has is skipped, never repeated.
 */
import { readFileSync } from 'node:fs';
import { BLOB_PREFIX } from './league-data-store.mjs';

const CONCURRENCY = 16;

/** Every hash already in the store, and the store's base URL if any blob exists. */
export async function existingBlobs(list) {
  const hashes = new Set();
  let base = null;
  let cursor;
  do {
    const page = await list({ prefix: BLOB_PREFIX, limit: 1000, cursor });
    for (const b of page.blobs) {
      const m = b.pathname.match(/([0-9a-f]{32})\.json$/);
      if (m) hashes.add(m[1]);
      if (!base) base = b.url.slice(0, b.url.length - b.pathname.length);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return { hashes, base };
}

export async function upload(files, put, read = (path) => readFileSync(path)) {
  const queue = Object.entries(files);
  let base = null;
  let done = 0;
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [path, hash] = next;
      const res = await put(`${BLOB_PREFIX}${hash}.json`, read(path), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 31536000,
      });
      base ??= res.url.slice(0, res.url.length - res.pathname.length);
      done++;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { base, uploaded: done };
}

