#!/usr/bin/env node
/**
 * One-shot harness: score a Schefter rumor-mill post against the live
 * quality gate so you can dry-run the suppression decision before (or
 * after) the scanner ships it.
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 *
 * Usage:
 *   node scripts/score-rumor-post.mjs --body "<post text>" [--headline "..."] [--scope division] [--topic roster]
 *   node scripts/score-rumor-post.mjs --stdin    # read body from stdin
 */
import { scoreSchefterPost, QUALITY_THRESHOLD } from './lib/schefter-quality-gate.mjs';

function parseArgs(argv) {
  const out = { headline: 'Schefter hearing…', tier: 'rumor' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--body') out.body = argv[++i];
    else if (a === '--headline') out.headline = argv[++i];
    else if (a === '--scope') out.scope = argv[++i];
    else if (a === '--topic') out.topic = argv[++i];
    else if (a === '--tier') out.tier = argv[++i];
    else if (a === '--stdin') out.stdin = true;
  }
  return out;
}

async function readStdin() {
  let buf = '';
  for await (const chunk of process.stdin) buf += chunk;
  return buf.trim();
}

const args = parseArgs(process.argv.slice(2));
if (args.stdin) args.body = await readStdin();
if (!args.body) {
  console.error('Usage: node scripts/score-rumor-post.mjs --body "<text>" [--scope division] [--topic roster]');
  console.error('   or: echo "<text>" | node scripts/score-rumor-post.mjs --stdin');
  process.exit(2);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set — gate cannot run.');
  process.exit(2);
}

const post = {
  headline: args.headline,
  body: args.body,
  tier: args.tier,
  scope: args.scope ?? null,
  topic: args.topic ?? null,
};

console.log('Scoring post:');
console.log(JSON.stringify(post, null, 2));
console.log('');

const { score, reason } = await scoreSchefterPost(post, { apiKey: process.env.ANTHROPIC_API_KEY });
const verdict = score >= QUALITY_THRESHOLD ? 'ALLOW (would ping GroupMe)' : 'SUPPRESS (feed only)';
console.log(`Score: ${score}/10 (threshold ${QUALITY_THRESHOLD})`);
console.log(`Reason: ${reason}`);
console.log(`Verdict: ${verdict}`);
