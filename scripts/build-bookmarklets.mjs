/**
 * Build Bookmarklets
 *
 * Reads each .js file in src/bookmarklets/, minifies with esbuild,
 * wraps in a javascript: URI, and writes a manifest JSON file
 * that the Astro page imports at build time.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename, extname } from 'node:path';
import { transform } from 'esbuild';

const BOOKMARKLETS_DIR = resolve(process.cwd(), 'src/bookmarklets');
const MANIFEST_PATH = resolve(process.cwd(), 'src/data/bookmarklet-manifest.json');

async function build() {
  // Ensure data directory exists
  await mkdir(resolve(process.cwd(), 'src/data'), { recursive: true });

  const files = (await readdir(BOOKMARKLETS_DIR)).filter(
    (f) => extname(f) === '.js',
  );

  const manifest = {};

  for (const file of files) {
    const id = basename(file, '.js');
    let source = await readFile(resolve(BOOKMARKLETS_DIR, file), 'utf-8');

    // NOTE: __MFL_IMPORT_URL__ placeholder is preserved in the manifest.
    // BookmarkletCard.tsx replaces it at runtime with the actual origin.

    // Minify with esbuild
    const result = await transform(source, {
      minify: true,
      target: 'es5',
    });

    // Wrap in javascript: URI
    const minified = result.code.trim();
    const uri = `javascript:${encodeURIComponent(minified)}`;
    manifest[id] = uri;

    console.log(`  ${id}: ${source.length} → ${minified.length} chars`);
  }

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest written to ${MANIFEST_PATH} (${Object.keys(manifest).length} bookmarklets)`);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
