import 'dotenv/config';
import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { put } from '@vercel/blob';

const DEFAULT_ROOTS = ['public', 'design'];
const BLOB_PREFIX = (process.env.BLOB_PSD_PREFIX || '').replace(/^\/+|\/+$/g, '');
const DRY_RUN = process.env.DRY_RUN === '1';

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, out) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.psd')) {
      out.push(fullPath);
    }
  }
}

async function main() {
  const roots = (process.env.PSD_ROOTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const searchRoots = roots.length ? roots : DEFAULT_ROOTS;

  const files = [];
  for (const root of searchRoots) {
    if (await pathExists(root)) {
      await walk(root, files);
    }
  }

  if (!files.length) {
    console.log('No PSD files found.');
    return;
  }

  console.log(`Found ${files.length} PSD file(s).`);
  for (const filePath of files) {
    const rel = path.relative(process.cwd(), filePath).replace(/\\\\/g, '/');
    const publicRel = rel.startsWith('public/') ? rel.slice('public/'.length) : rel;
    const blobPath = BLOB_PREFIX ? `${BLOB_PREFIX}/${publicRel}` : publicRel;
    if (DRY_RUN) {
      console.log(`[dry-run] ${rel} -> ${blobPath}`);
      continue;
    }

    const body = await readFile(filePath);
    const result = await put(blobPath, body, {
      access: 'public',
      contentType: 'image/vnd.adobe.photoshop',
      addRandomSuffix: false,
    });
    console.log(`${rel} -> ${result.url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
