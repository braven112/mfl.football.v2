const fs = require('fs');
const path = require('path');
const sass = require('sass');

const projectRoot = path.resolve(__dirname, '..');
const dirs = [
  path.join(projectRoot, 'src', 'assets', 'css', 'src', 'colors', 'light'),
  path.join(projectRoot, 'src', 'assets', 'css', 'src', 'colors', 'dark'),
];
const outDir = path.join(projectRoot, 'src', 'assets', 'css', 'dist');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

let compiled = [];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (!f.endsWith('.scss')) continue;
    if (f.startsWith('_')) continue; // skip partials
    const inputPath = path.join(dir, f);
    const outName = f.replace(/\.scss$/i, '.css');
    const outPath = path.join(outDir, outName);
    try {
      const result = sass.compile(inputPath, { style: 'expanded', sourceMap: false });
      fs.writeFileSync(outPath, result.css);
      compiled.push({ input: inputPath, output: outPath, size: Buffer.byteLength(result.css) });
      console.log(`Compiled ${inputPath} -> ${outPath}`);
    } catch (err) {
      console.error(`Error compiling ${inputPath}:`, err.message);
      process.exitCode = 1;
    }
  }
}

console.log(`\nDone. Compiled ${compiled.length} files.`);
for (const c of compiled) {
  console.log(`${path.basename(c.output)} — ${Math.round(c.size / 1024)} KB`);
}
