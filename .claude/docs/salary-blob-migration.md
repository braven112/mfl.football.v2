# Salary History → Vercel Blob Migration Reference

## Context
We removed ~9,500 salary history snapshot files (3.5 GB) from git to reduce Vercel clone/build times. Only `summary-week-*.json` files remain in git (9 files, 72 KB). The deleted data should be archived to Vercel Blob for cheap storage and on-demand access for historical reports.

## Current State

### What's in git (KEEP)
- `src/data/salary-history/theleague/2021/summary-week-14.json`
- `src/data/salary-history/theleague/2022/summary-week-14.json`
- `src/data/salary-history/theleague/2023/summary-week-14.json`
- `src/data/salary-history/theleague/2024/summary-week-14.json`
- `src/data/salary-history/theleague/2025/summary-week-{10,11,12,13,14}.json`

### What was deleted from git
- ~5,400 timestamped `raw-*.json` and `summary-*.json` files from `src/data/salary-history/theleague/2025/`
- ~20 files from `src/data/salary-history/theleague/2021-2024/` (timestamped summaries)
- ~1,400 files from `src/data/salary-history/{2007-2025,13522}/` (top-level year dirs)
- ~2,646 files from `data/afl-fantasy/salary-history/` and `data/theleague/salary-history/`

### What exists locally but was never in git
- `data/salary-history-archive/` — 4.5 GB, 2,771 files

### Total data to migrate: ~8 GB, ~12,000 files

## How Salary Data Is Used

### Pages that consume salary data
1. **`src/pages/theleague/salary.astro`** — Salary Benchmarks page
   - Loads `src/data/mfl-salary-averages-*.json` (season-level, all years)
   - Loads `src/data/salary-history/theleague/*/summary-week-*.json` (weekly snapshots)
2. **`src/pages/theleague/salary-history.astro`** — Salary Trend History page
   - Loads `src/data/mfl-salary-averages-*.json` only

### Glob patterns used
```astro
// salary.astro lines 5-13
const summaryModules = import.meta.glob('../../data/mfl-salary-averages-*.json', { eager: true });
const weeklyModules = import.meta.glob('../../data/salary-history/theleague/*/summary-week-*.json', { eager: true });
```

### No pages use raw-*.json or timestamped summary-*.json files

## How Salary Data Is Generated

### Roster sync workflow (`.github/workflows/roster-sync.yml`)
- Runs every 20 minutes
- Calls `scripts/update-salary-averages.mjs` which:
  - Fetches from MFL API
  - Fetches from Sleeper API
  - Downloads CSV from NFLverse GitHub
  - Saves snapshots to `src/data/salary-history/`

### Key script: `scripts/update-salary-averages.mjs`
- This script creates the timestamped raw/summary files
- It also creates/updates `summary-week-*.json` files
- Needs modification to upload snapshots to Vercel Blob instead of saving to disk

## Migration Plan

### Phase 1: Upload existing data to Vercel Blob
- Create upload script similar to `scripts/upload-psds.mjs`
- Upload all local salary history files to blob storage
- Organize by path: `salary-history/theleague/2025/raw-2026-01-15T18-02-10.722Z.json`

### Phase 2: Modify salary sync to write to Blob
- Update `scripts/update-salary-averages.mjs` to upload snapshots to Vercel Blob
- Keep only `summary-week-*.json` files local (written to git for page builds)
- Raw snapshots go directly to blob

### Phase 3: Historical report page (optional)
- Create a page that fetches historical data from Vercel Blob on demand
- Could use server-side rendering to fetch blob data at request time
- Only fetches what's needed, not the entire archive

## Vercel Blob Pricing
- Storage: $0.023/GB/month (1 GB free on Pro)
- Transfer: $0.05/GB (10 GB free on Pro)
- Estimated cost for 8 GB: ~$0.16-0.66/month

## Relevant Files
- `scripts/upload-psds.mjs` — existing blob upload script (use as reference)
- `scripts/update-salary-averages.mjs` — salary sync script (needs modification)
- `scripts/fetch-mfl-feeds.mjs` — MFL data fetcher
- `.github/workflows/roster-sync.yml` — GitHub Actions workflow
- `.env` — contains `BLOB_READ_WRITE_TOKEN`
- `src/pages/theleague/salary.astro` — salary page
- `src/pages/theleague/salary-history.astro` — salary history page

## .gitignore rules (already in place)
```
src/data/salary-history/**/raw-*.json
src/data/salary-history/**/summary-2*.json
data/salary-history-archive/
data/*/salary-history/
*.psd
```
