#!/usr/bin/env node
// Quality gate for LLM-generated Schefter posts.
//
// Runs AFTER scripts/schefter-scan.mjs in the Schefter Scan workflow, BEFORE
// the git commit. Diffs each league's schefter-feed.json against the version
// in HEAD, identifies new posts written by the LLM (`authorId === 'claude'`),
// asks Claude Haiku to score voice + coherence + accuracy on a 1-10 scale,
// and removes any post scoring below SCHEFTER_QUALITY_THRESHOLD (default 6).
//
// Removed posts are listed in data/schefter/quality-report.json so the
// workflow can file a follow-up GitHub issue. The script never fails the
// workflow — a flat post slipping through is recoverable; a hard failure
// would block legitimate posts from shipping.
//
// Note: GroupMe sends happen inside the scanner, so a removed post may
// already be in the group chat. The gate's job is to keep the website
// feed clean and surface low-quality drift for human review.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const FEEDS = [
  { league: 'theleague', feedPath: path.join(projectRoot, 'src', 'data', 'theleague', 'schefter-feed.json') },
  { league: 'afl-fantasy', feedPath: path.join(projectRoot, 'data', 'afl-fantasy', 'schefter-feed.json') },
];

const REPORT_PATH = path.join(projectRoot, 'data', 'schefter', 'quality-report.json');
const THRESHOLD = parseInt(process.env.SCHEFTER_QUALITY_THRESHOLD || '6', 10);
const MODEL = process.env.SCHEFTER_QUALITY_MODEL || 'claude-haiku-4-5-20251001';

function loadJson(filePath) {
  return fs.readFile(filePath, 'utf8').then(JSON.parse);
}

function loadJsonFromGitHead(repoRelative) {
  try {
    const out = execFileSync('git', ['show', `HEAD:${repoRelative}`], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function isLlmAuthored(post) {
  // The scanner sets authorId='claude' on every fully-LLM-generated post
  // (rumor mill, pending-trade riffs). Template posts with light AI body
  // touch-ups don't get this marker and stay out of scope — they're
  // anchored to deterministic templates and don't drift the same way.
  return Boolean(post && post.authorId === 'claude');
}

function diffNewPosts(currentFeed, headFeed) {
  const headIds = new Set((headFeed?.posts || []).map((p) => p.id));
  return (currentFeed.posts || []).filter((p) => p.id && !headIds.has(p.id));
}

const SCORING_PROMPT = `You score a single Schefter Report post for publication readiness on a dynasty fantasy football league site.

Schefter voice rubric:
- Confident, opinionated insider tone ("I'm told…", "League sources tell me…", "Boom!")
- Punchy and specific. References real teams/players when given.
- Avoids hedging, generic platitudes, or AI tells ("It's important to note…", "As an AI…").
- Body length 1-4 sentences. No essay-length filler.

Coherence rubric:
- Headline and body agree.
- No internal contradictions.
- No obviously hallucinated facts (impossible matchups, made-up rules, broken franchise references).
- Reads like one human posted it, not a stitched-together summary.

Score 1-10:
- 10: Ship it.
- 7-9: Solid post, minor nits.
- 4-6: Flat, off-voice, or borderline incoherent. Rejection territory.
- 1-3: Hallucinated, contradictory, or off-topic. Reject.

Respond with JSON only: {"score": <int 1-10>, "reason": "<one short sentence>"}`;

async function scorePost(post, apiKey) {
  const payload = {
    headline: post.headline,
    body: post.body,
    analysis: post.analysis ?? null,
    tier: post.tier,
    transactionSubType: post.transactionSubType ?? null,
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 150,
      system: SCORING_PROMPT,
      messages: [{ role: 'user', content: `Score this post:\n\n${JSON.stringify(payload, null, 2)}` }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in scorer response: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]);
  const score = Number(parsed.score);
  if (!Number.isFinite(score) || score < 1 || score > 10) {
    throw new Error(`Invalid score in scorer response: ${match[0]}`);
  }
  return { score, reason: String(parsed.reason || '').slice(0, 240) };
}

async function gateLeague({ league, feedPath }, apiKey) {
  const repoRel = path.relative(projectRoot, feedPath);
  const [current, head] = await Promise.all([
    loadJson(feedPath).catch(() => null),
    Promise.resolve(loadJsonFromGitHead(repoRel)),
  ]);

  if (!current) {
    console.log(`[${league}] no feed file — skip`);
    return { league, candidates: 0, scored: [], removedIds: [] };
  }

  const newPosts = diffNewPosts(current, head);
  const llmPosts = newPosts.filter(isLlmAuthored);
  console.log(`[${league}] new posts since HEAD: ${newPosts.length} (LLM-authored: ${llmPosts.length})`);

  if (llmPosts.length === 0) {
    return { league, candidates: 0, scored: [], removedIds: [] };
  }

  const scored = [];
  const removedIds = [];
  for (const post of llmPosts) {
    try {
      const { score, reason } = await scorePost(post, apiKey);
      const action = score < THRESHOLD ? 'rejected' : 'kept';
      scored.push({ id: post.id, headline: post.headline, score, reason, action });
      const verb = action === 'rejected' ? 'REJECT' : 'keep';
      console.log(`[${league}] ${verb} ${score}/10 — ${post.id}: ${reason}`);
      if (action === 'rejected') removedIds.push(post.id);
    } catch (err) {
      // On scorer failure, default to keeping the post — don't let the gate
      // suppress legitimate content because Anthropic returned a 529.
      console.warn(`[${league}] scorer error on ${post.id}, keeping: ${err.message}`);
      scored.push({ id: post.id, headline: post.headline, score: null, reason: `scorer-error: ${err.message}`, action: 'kept' });
    }
  }

  if (removedIds.length > 0) {
    const removedSet = new Set(removedIds);
    const next = { ...current, posts: current.posts.filter((p) => !removedSet.has(p.id)) };
    await fs.writeFile(feedPath, JSON.stringify(next, null, 2) + '\n');
    console.log(`[${league}] removed ${removedIds.length} post(s) from feed`);
  }

  return { league, candidates: llmPosts.length, scored, removedIds };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('schefter-quality-gate: ANTHROPIC_API_KEY not set — skipping');
    return;
  }

  const results = [];
  for (const league of FEEDS) {
    try {
      results.push(await gateLeague(league, apiKey));
    } catch (err) {
      console.warn(`[${league.league}] gate failed: ${err.message}`);
      results.push({ league: league.league, error: err.message, scored: [], removedIds: [] });
    }
  }

  const totalRemoved = results.reduce((n, r) => n + (r.removedIds?.length || 0), 0);
  const totalScored = results.reduce((n, r) => n + (r.scored?.length || 0), 0);

  const report = {
    generatedAt: new Date().toISOString(),
    threshold: THRESHOLD,
    model: MODEL,
    totals: { scored: totalScored, removed: totalRemoved },
    leagues: results,
  };

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(`schefter-quality-gate: scored ${totalScored}, removed ${totalRemoved}. Report: ${path.relative(projectRoot, REPORT_PATH)}`);
}

// Only run when invoked as a script, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    // Never fail the workflow — log and exit 0.
    console.error('schefter-quality-gate: unexpected error', err);
  });
}

export { diffNewPosts, isLlmAuthored };
