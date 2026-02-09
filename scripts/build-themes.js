const fs = require('fs');
const path = require('path');
const sass = require('sass');

const projectRoot = path.resolve(__dirname, '..');
const entryRoot = path.join(projectRoot, 'src', 'assets', 'css', 'src');
const distRoot = path.join(projectRoot, 'public', 'assets', 'css', 'dist');

function findEntryFiles(dir, bucket) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findEntryFiles(fullPath, bucket);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.scss')) continue;
    if (entry.name.startsWith('_')) continue;
    bucket.push(fullPath);
  }
}

function ensureCleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

ensureCleanDir(distRoot);

const entries = [];
findEntryFiles(entryRoot, entries);

if (!entries.length) {
  console.warn('No SCSS entry files found to build.');
  process.exit(0);
}

for (const inputPath of entries) {
  const rel = path.relative(entryRoot, inputPath);
  const outputRel = rel.replace(/\.scss$/i, '.css');
  const outPath = path.join(distRoot, outputRel);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  try {
    const result = sass.compile(inputPath, {
      style: 'expanded',
      sourceMap: false,
      loadPaths: [entryRoot],
    });
    fs.writeFileSync(outPath, result.css);
    console.log(`Compiled ${rel} -> ${path.relative(projectRoot, outPath)}`);
  } catch (err) {
    console.error(`Error compiling ${rel}:`, err.message);
    process.exitCode = 1;
  }
}

console.log('Theme build complete.');
