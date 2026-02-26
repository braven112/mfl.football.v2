#!/usr/bin/env node
/**
 * Build league-specific CSS bundles
 * Compiles SASS with different variable files for each league
 */

import * as sass from 'sass';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const leagues = [
  {
    name: 'theleague',
    sassFile: 'src/assets/css/src/theleague_main.scss',
    variablesFile: 'src/assets/css/src/_variables.scss',
    outputFile: 'public/assets/css/dist/theleague_main.css',
  },
  {
    name: 'afl',
    sassFile: 'src/assets/css/src/afl_main.scss',
    variablesFile: 'src/assets/css/src/_variables-afl.scss',
    outputFile: 'public/assets/css/dist/afl_main.css',
  },
  {
    name: 'dark',
    sassFile: 'src/assets/css/src/dark_main.scss',
    variablesFile: 'src/assets/css/src/_variables-dark.scss',
    outputFile: 'public/assets/css/dist/dark_main.css',
  },
  {
    name: 'dark-din',
    sassFile: 'src/assets/css/src/dark_din_main.scss',
    variablesFile: 'src/assets/css/src/_variables-dark-din.scss',
    outputFile: 'public/assets/css/dist/dark_din_main.css',
  },
];

// Ensure output directory exists
const outputDir = path.join(rootDir, 'public/assets/css/dist');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log('🎨 Building league-specific CSS bundles...\n');

const globalVarsPath = path.join(rootDir, 'src/assets/css/src/_variables.scss');

// Read the original TheLeague variables into memory so we can always restore them
const originalVariables = fs.readFileSync(globalVarsPath, 'utf8');

for (const league of leagues) {
  const needsSwap = league.variablesFile !== 'src/assets/css/src/_variables.scss';

  try {
    console.log(`📦 Compiling ${league.name}...`);

    const sassPath = path.join(rootDir, league.sassFile);
    const variablesPath = path.join(rootDir, league.variablesFile);
    const outputPath = path.join(rootDir, league.outputFile);

    // Verify files exist
    if (!fs.existsSync(sassPath)) {
      console.error(`   ❌ SASS file not found: ${sassPath}`);
      continue;
    }
    if (!fs.existsSync(variablesPath)) {
      console.error(`   ❌ Variables file not found: ${variablesPath}`);
      continue;
    }

    // Swap in league-specific variables
    if (needsSwap) {
      fs.copyFileSync(variablesPath, globalVarsPath);
    }

    // Compile SASS
    const result = sass.compile(sassPath, {
      style: 'compressed',
      sourceMap: false,
    });

    // Write output
    fs.writeFileSync(outputPath, result.css);

    const sizeKB = (Buffer.byteLength(result.css) / 1024).toFixed(2);
    console.log(`   ✅ ${league.name}_main.css (${sizeKB} KB)`);
    console.log(`   📍 ${outputPath}\n`);

  } catch (error) {
    console.error(`   ❌ Error compiling ${league.name}:`, error.message);
  } finally {
    // Always restore the original TheLeague variables after a swap
    if (needsSwap) {
      fs.writeFileSync(globalVarsPath, originalVariables);
    }
  }
}

console.log('✨ CSS build complete!\n');
