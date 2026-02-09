#!/usr/bin/env node
/**
 * Bundle Size Checker
 *
 * Validates that the build output won't exceed Vercel's serverless function limits.
 * Run before deploying to catch size issues early.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs          # Check after build
 *   node scripts/check-bundle-size.mjs --src    # Check src/data directory sizes
 *
 * Limits:
 *   - Vercel Serverless: 250 MB unzipped
 *   - Vercel Edge: 4 MB
 */

import { execSync } from 'child_process';
import { existsSync, statSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const VERCEL_LIMIT_MB = 250;
const WARNING_THRESHOLD_MB = 200; // Warn at 80% of limit
const SRC_DATA_LIMIT_MB = 50; // src/data should stay under 50MB

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getDirectorySize(dirPath) {
  let totalSize = 0;
  let fileCount = 0;

  function walkDir(currentPath) {
    try {
      const items = readdirSync(currentPath, { withFileTypes: true });
      for (const item of items) {
        const fullPath = join(currentPath, item.name);
        if (item.isDirectory()) {
          walkDir(fullPath);
        } else if (item.isFile()) {
          totalSize += statSync(fullPath).size;
          fileCount++;
        }
      }
    } catch (err) {
      // Skip directories we can't read
    }
  }

  if (existsSync(dirPath)) {
    walkDir(dirPath);
  }

  return { totalSize, fileCount };
}

function getLargestFiles(dirPath, limit = 10) {
  const files = [];

  function walkDir(currentPath) {
    try {
      const items = readdirSync(currentPath, { withFileTypes: true });
      for (const item of items) {
        const fullPath = join(currentPath, item.name);
        if (item.isDirectory()) {
          walkDir(fullPath);
        } else if (item.isFile()) {
          files.push({
            path: relative(process.cwd(), fullPath),
            size: statSync(fullPath).size,
          });
        }
      }
    } catch (err) {
      // Skip
    }
  }

  if (existsSync(dirPath)) {
    walkDir(dirPath);
  }

  return files.sort((a, b) => b.size - a.size).slice(0, limit);
}

function checkSrcDataSize() {
  console.log(`\n${colors.bold}Checking src/data directory...${colors.reset}\n`);

  const srcDataPath = join(process.cwd(), 'src/data');
  const { totalSize, fileCount } = getDirectorySize(srcDataPath);
  const sizeMB = totalSize / (1024 * 1024);

  console.log(`  Total size: ${formatSize(totalSize)} (${fileCount} files)`);

  // Check subdirectories
  if (existsSync(srcDataPath)) {
    const subdirs = readdirSync(srcDataPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const { totalSize } = getDirectorySize(join(srcDataPath, d.name));
        return { name: d.name, size: totalSize };
      })
      .sort((a, b) => b.size - a.size);

    console.log(`\n  ${colors.bold}Subdirectory breakdown:${colors.reset}`);
    for (const dir of subdirs) {
      const indicator = dir.size > 10 * 1024 * 1024 ? colors.red : colors.green;
      console.log(`    ${indicator}${dir.name}: ${formatSize(dir.size)}${colors.reset}`);
    }
  }

  // Show largest files
  const largestFiles = getLargestFiles(srcDataPath, 5);
  if (largestFiles.length > 0) {
    console.log(`\n  ${colors.bold}Largest files:${colors.reset}`);
    for (const file of largestFiles) {
      console.log(`    ${formatSize(file.size).padStart(10)} - ${file.path}`);
    }
  }

  // Check for problematic patterns
  const salaryHistoryPath = join(srcDataPath, 'salary-history');
  if (existsSync(salaryHistoryPath)) {
    const { totalSize: historySize, fileCount: historyCount } = getDirectorySize(salaryHistoryPath);
    if (historySize > 10 * 1024 * 1024) {
      console.log(`\n  ${colors.red}${colors.bold}WARNING: salary-history is ${formatSize(historySize)} with ${historyCount} files${colors.reset}`);
      console.log(`  ${colors.yellow}Consider moving raw-*.json files to external storage${colors.reset}`);
    }
  }

  // Final verdict
  console.log('\n' + '─'.repeat(60));
  if (sizeMB > SRC_DATA_LIMIT_MB) {
    console.log(`${colors.red}${colors.bold}FAIL: src/data exceeds ${SRC_DATA_LIMIT_MB}MB limit (${sizeMB.toFixed(1)}MB)${colors.reset}`);
    return false;
  } else if (sizeMB > SRC_DATA_LIMIT_MB * 0.8) {
    console.log(`${colors.yellow}${colors.bold}WARNING: src/data approaching limit (${sizeMB.toFixed(1)}MB / ${SRC_DATA_LIMIT_MB}MB)${colors.reset}`);
    return true;
  } else {
    console.log(`${colors.green}${colors.bold}PASS: src/data size OK (${sizeMB.toFixed(1)}MB / ${SRC_DATA_LIMIT_MB}MB)${colors.reset}`);
    return true;
  }
}

function checkBuildOutput() {
  console.log(`\n${colors.bold}Checking build output (.vercel/output)...${colors.reset}\n`);

  const outputPath = join(process.cwd(), '.vercel/output');

  if (!existsSync(outputPath)) {
    console.log(`  ${colors.yellow}No build output found. Run 'pnpm build' first.${colors.reset}`);
    console.log(`  Alternatively, use --src flag to check source data sizes.\n`);
    return null;
  }

  const functionsPath = join(outputPath, 'functions');
  const staticPath = join(outputPath, 'static');

  const { totalSize: functionsSize } = getDirectorySize(functionsPath);
  const { totalSize: staticSize } = getDirectorySize(staticPath);
  const totalSize = functionsSize + staticSize;

  console.log(`  Functions: ${formatSize(functionsSize)}`);
  console.log(`  Static:    ${formatSize(staticSize)}`);
  console.log(`  Total:     ${formatSize(totalSize)}`);

  const functionsMB = functionsSize / (1024 * 1024);

  console.log('\n' + '─'.repeat(60));
  if (functionsMB > VERCEL_LIMIT_MB) {
    console.log(`${colors.red}${colors.bold}FAIL: Functions exceed ${VERCEL_LIMIT_MB}MB Vercel limit!${colors.reset}`);
    console.log(`${colors.red}Deploy will fail. Reduce bundle size before pushing.${colors.reset}`);
    return false;
  } else if (functionsMB > WARNING_THRESHOLD_MB) {
    console.log(`${colors.yellow}${colors.bold}WARNING: Functions approaching Vercel limit (${functionsMB.toFixed(1)}MB / ${VERCEL_LIMIT_MB}MB)${colors.reset}`);
    return true;
  } else {
    console.log(`${colors.green}${colors.bold}PASS: Bundle size OK (${functionsMB.toFixed(1)}MB / ${VERCEL_LIMIT_MB}MB)${colors.reset}`);
    return true;
  }
}

function checkEagerImports() {
  console.log(`\n${colors.bold}Checking for eager glob imports...${colors.reset}\n`);

  try {
    // Search for eager: true in astro files
    const result = execSync(
      'grep -r "eager.*true" --include="*.astro" --include="*.ts" src/pages/ 2>/dev/null || true',
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    if (result.trim()) {
      console.log(`  ${colors.yellow}Found eager imports (may bundle large files):${colors.reset}`);
      const lines = result.trim().split('\n').slice(0, 10);
      for (const line of lines) {
        console.log(`    ${line}`);
      }
      if (result.trim().split('\n').length > 10) {
        console.log(`    ... and more`);
      }
      return true; // Warning only, not a failure
    } else {
      console.log(`  ${colors.green}No eager glob imports found.${colors.reset}`);
      return true;
    }
  } catch (err) {
    console.log(`  ${colors.yellow}Could not check for eager imports${colors.reset}`);
    return true;
  }
}

// Main
console.log(`\n${'═'.repeat(60)}`);
console.log(`${colors.bold}  Vercel Bundle Size Checker${colors.reset}`);
console.log(`${'═'.repeat(60)}`);

const args = process.argv.slice(2);
const checkSrcOnly = args.includes('--src');

let allPassed = true;

// Always check src/data
const srcPassed = checkSrcDataSize();
if (!srcPassed) allPassed = false;

// Check for eager imports
checkEagerImports();

// Check build output unless --src only
if (!checkSrcOnly) {
  const buildPassed = checkBuildOutput();
  if (buildPassed === false) allPassed = false;
}

console.log(`\n${'═'.repeat(60)}\n`);

if (!allPassed) {
  console.log(`${colors.red}${colors.bold}Bundle size checks failed. Fix issues before deploying.${colors.reset}\n`);
  process.exit(1);
} else {
  console.log(`${colors.green}${colors.bold}All bundle size checks passed.${colors.reset}\n`);
  process.exit(0);
}
