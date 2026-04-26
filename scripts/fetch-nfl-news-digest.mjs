#!/usr/bin/env node
/**
 * Fetch a digest of recent NFL headlines from ESPN's news API.
 *
 * Writes the top ~20 headlines from the last 7 days to
 * data/schefter/nfl-context.json. The Schefter rumor scanner reads this
 * file and injects the headlines into the LLM system prompt as
 * "CURRENT NFL CHATTER" so the bot can recognize and riff on real-world
 * NFL storylines (e.g. coach/reporter scandals) when an owner's tip
 * references them.
 *
 * The injection is context-only — the prompt instructs the model to
 * IGNORE the digest unless a tip clearly maps to a current storyline.
 * Forced topical references are worse than no reference.
 *
 * Endpoint:
 *   https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50
 *
 * Output schema:
 *   {
 *     fetchedAt: ISO8601,
 *     windowDays: 7,
 *     headlines: [{ title, blurb, publishedAt, source }]
 *   }
 *
 * Safe on build: any failure leaves the existing file untouched and exits 0
 * so the build pipeline is never blocked.
 *
 * Usage:
 *   node scripts/fetch-nfl-news-digest.mjs
 *   node scripts/fetch-nfl-news-digest.mjs --dry-run   # print, don't write
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const OUTPUT = path.join(root, 'data/schefter/nfl-context.json');

const ENDPOINT = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50';
const WINDOW_DAYS = 7;
const MAX_HEADLINES = 20;
const BLURB_MAX = 200;

const DRY_RUN = process.argv.includes('--dry-run');

function trimBlurb(s) {
  if (typeof s !== 'string') return '';
  const collapsed = s.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= BLURB_MAX) return collapsed;
  return collapsed.slice(0, BLURB_MAX - 1).trimEnd() + '…';
}

async function fetchNflNews() {
  const res = await fetch(ENDPOINT, {
    headers: { 'User-Agent': 'mfl-schefter-news-digest/1.0' },
  });
  if (!res.ok) throw new Error(`ESPN news ${res.status}`);
  return res.json();
}

function selectHeadlines(payload) {
  const articles = Array.isArray(payload?.articles) ? payload.articles : [];
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return articles
    .map((a) => {
      const publishedAt = a.published || a.lastModified || null;
      const ms = publishedAt ? Date.parse(publishedAt) : NaN;
      return {
        title: typeof a.headline === 'string' ? a.headline.trim() : '',
        blurb: trimBlurb(a.description ?? ''),
        publishedAt: publishedAt && !Number.isNaN(ms) ? new Date(ms).toISOString() : null,
        source: 'ESPN',
        _ms: ms,
      };
    })
    .filter((h) => h.title && h.publishedAt && Number.isFinite(h._ms) && h._ms >= cutoff)
    .sort((a, b) => b._ms - a._ms)
    .slice(0, MAX_HEADLINES)
    .map(({ _ms, ...rest }) => rest);
}

async function main() {
  let payload;
  try {
    payload = await fetchNflNews();
  } catch (err) {
    console.error(`[nfl-news-digest] fetch failed: ${err.message} — leaving existing file untouched`);
    process.exit(0);
  }

  const headlines = selectHeadlines(payload);
  const out = {
    fetchedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    headlines,
  };

  if (DRY_RUN) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`[nfl-news-digest] wrote ${headlines.length} headlines to ${path.relative(root, OUTPUT)}`);
}

main();
