/**
 * Upload historical salary spreadsheets to Vercel Blob storage.
 *
 * Extracts the Google Drive zip of salary spreadsheets and uploads
 * one file per year to the blob store under salary-archive/{year}.xlsx.
 *
 * Usage:
 *   node scripts/upload-salary-sheets-to-blob.mjs [path-to-zip]
 *   node scripts/upload-salary-sheets-to-blob.mjs --force   # re-upload all
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { list, put } from '@vercel/blob';

const FORCE = process.argv.includes('--force');
const zipArg = process.argv.find((a) => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]);
const zipPath = zipArg || path.join(os.homedir(), 'Downloads', 'drive-download-20260222T175746Z-3-001.zip');

// For years with multiple files, prefer .xlsx over .xls and larger files over smaller
function pickBestFile(files) {
  const byYear = new Map();

  for (const f of files) {
    const yearMatch = f.match(/^(\d{4})_/);
    if (!yearMatch) continue;
    const year = yearMatch[1];

    const existing = byYear.get(year);
    if (!existing) {
      byYear.set(year, f);
      continue;
    }

    // Prefer .xlsx over .xls
    const fIsXlsx = f.endsWith('.xlsx');
    const existingIsXlsx = existing.endsWith('.xlsx');
    if (fIsXlsx && !existingIsXlsx) {
      byYear.set(year, f);
    } else if (!fIsXlsx && existingIsXlsx) {
      // keep existing
    } else {
      // Same extension — prefer file WITHOUT (1) suffix (the original)
      const fHasSuffix = f.includes('(1)');
      const existingHasSuffix = existing.includes('(1)');
      if (!fHasSuffix && existingHasSuffix) {
        byYear.set(year, f);
      }
    }
  }

  return byYear;
}

async function run() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error('[upload-sheets] BLOB_READ_WRITE_TOKEN is not set. Add it to your .env file.');
    process.exitCode = 1;
    return;
  }

  // Extract zip to temp dir
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'salary-sheets-'));
  console.log(`[upload-sheets] Extracting ${zipPath} to ${tmpDir}...`);
  execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'pipe' });

  const files = await fs.readdir(tmpDir);
  const bestByYear = pickBestFile(files);
  console.log(`[upload-sheets] Found files for ${bestByYear.size} years.`);

  // List existing blobs to skip unchanged
  const existingBlobs = new Map();
  let cursor;
  let hasMore = true;
  while (hasMore) {
    const result = await list({ cursor, limit: 1000 });
    for (const blob of result.blobs) {
      existingBlobs.set(blob.pathname, blob.size);
    }
    cursor = result.cursor;
    hasMore = result.hasMore;
  }

  const manifest = {};
  let uploaded = 0;
  let skipped = 0;

  for (const [year, filename] of [...bestByYear.entries()].sort()) {
    const ext = filename.endsWith('.xlsx') ? 'xlsx' : 'xls';
    const blobPathname = `salary-archive/${year}_tagged_salary_avg.${ext}`;
    const filePath = path.join(tmpDir, filename);
    const stat = await fs.stat(filePath);

    const existingSize = existingBlobs.get(blobPathname);
    if (!FORCE && existingSize !== undefined && existingSize === stat.size) {
      console.log(`[upload-sheets] ${year}: skipped (unchanged)`);
      skipped++;
      // Still need the URL for the manifest
      const existingResult = await list({ prefix: blobPathname, limit: 1 });
      if (existingResult.blobs.length) {
        manifest[year] = existingResult.blobs[0].url;
      }
      continue;
    }

    const contentType = ext === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.ms-excel';

    console.log(`[upload-sheets] ${year}: uploading ${filename} (${(stat.size / 1024).toFixed(1)} KB)...`);
    const fileBuffer = await fs.readFile(filePath);
    const result = await put(blobPathname, fileBuffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    manifest[year] = result.url;
    uploaded++;
  }

  // Write manifest JSON for the salary page to reference
  const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const manifestPath = path.join(projectRoot, 'src', 'data', 'theleague', 'salary-archive-urls.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n[upload-sheets] Manifest written to ${path.relative(projectRoot, manifestPath)}`);
  console.log(`[upload-sheets] Done. Uploaded: ${uploaded}, Skipped: ${skipped}`);

  // Cleanup
  await fs.rm(tmpDir, { recursive: true });
}

run().catch((error) => {
  console.error('[upload-sheets] Failed:', error);
  process.exitCode = 1;
});
