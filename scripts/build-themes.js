const fs = require('fs');
const path = require('path');
const sass = require('sass');

const projectRoot = path.resolve(__dirname, '..');

const srcDirs = [
  { name: 'light', dir: path.join(projectRoot, 'src', 'assets', 'css', 'src', 'colors', 'light') },
  { name: 'dark', dir: path.join(projectRoot, 'src', 'assets', 'css', 'src', 'colors', 'dark') },
];
const distRoot = path.join(projectRoot, 'public', 'assets', 'css', 'dist');

for (const { name, dir } of srcDirs) {
  const outDir = path.join(distRoot, name);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (!f.endsWith('.scss')) continue;
    if (f.startsWith('_')) continue; // skip partials
    const inputPath = path.join(dir, f);
    const outName = f.replace(/\.scss$/i, '.css');
    const outPath = path.join(outDir, outName);
    // Compile each theme SCSS file directly, do not use base-styles.scss
    try {
      const result = sass.compile(inputPath, { style: 'expanded', sourceMap: false });
      fs.writeFileSync(outPath, result.css);
      console.log(`Compiled ${inputPath} -> ${outPath}`);
    } catch (err) {
      console.error(`Error compiling ${inputPath}:`, err.message);
      process.exitCode = 1;
    }
  }
}

console.log('Theme build complete.');
