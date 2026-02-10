/**
 * Upload PSD files to Vercel Blob storage
 *
 * Scans public/assets/ for .psd files, checks which ones already exist
 * in the blob store, and uploads any new or changed files.
 *
 * Usage:
 *   pnpm upload:psds              # upload all new PSDs
 *   pnpm upload:psds --force      # re-upload all PSDs regardless
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { list, put } from '@vercel/blob';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = path.join(projectRoot, 'public');

const FORCE = process.argv.includes('--force');

/** Recursively find all .psd files under a directory */
async function findPsdFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findPsdFiles(fullPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.psd')) {
      results.push(fullPath);
    }
  }
  return results;
}

/** List all existing blob pathnames */
async function listExistingBlobs() {
  const existing = new Map();
  let cursor;
  let hasMore = true;

  while (hasMore) {
    const result = await list({ cursor, limit: 1000 });
    for (const blob of result.blobs) {
      existing.set(blob.pathname, blob.size);
    }
    cursor = result.cursor;
    hasMore = result.hasMore;
  }

  return existing;
}

async function run() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error('[upload-psds] BLOB_READ_WRITE_TOKEN is not set. Add it to your .env file.');
    process.exitCode = 1;
    return;
  }

  console.log('[upload-psds] Scanning for PSD files...');
  const psdFiles = await findPsdFiles(path.join(publicDir, 'assets'));

  if (psdFiles.length === 0) {
    console.log('[upload-psds] No PSD files found.');
    return;
  }

  console.log(`[upload-psds] Found ${psdFiles.length} PSD files locally.`);

  const existingBlobs = await listExistingBlobs();
  console.log(`[upload-psds] Found ${existingBlobs.size} existing blobs.`);

  let uploaded = 0;
  let skipped = 0;

  for (const filePath of psdFiles) {
    const relativePath = path.relative(publicDir, filePath);
    const blobPathname = relativePath.replace(/\\/g, '/');
    const stat = await fs.stat(filePath);

    const existingSize = existingBlobs.get(blobPathname);
    const alreadyExists = existingSize !== undefined;

    if (!FORCE && alreadyExists && existingSize === stat.size) {
      skipped++;
      continue;
    }

    const reason = alreadyExists ? '(size changed)' : '(new)';
    console.log(`[upload-psds] Uploading ${blobPathname} ${reason} (${(stat.size / 1024 / 1024).toFixed(1)} MB)...`);

    const fileBuffer = await fs.readFile(filePath);
    await put(blobPathname, fileBuffer, {
      access: 'public',
      contentType: 'image/vnd.adobe.photoshop',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    uploaded++;
  }

  console.log(`[upload-psds] Done. Uploaded: ${uploaded}, Skipped (unchanged): ${skipped}`);
}

run().catch((error) => {
  console.error('[upload-psds] Failed:', error);
  process.exitCode = 1;
});
