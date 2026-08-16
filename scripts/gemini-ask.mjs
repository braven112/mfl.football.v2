#!/usr/bin/env node
// Ask Gemini a question about a pile of files, and print only the answer.
//
// PURPOSE: bulk-context offload. Questions like "which of these 60 insight docs
// mention X", "audit every committed bracket feed for Y", or "list every call
// site of Z across src/ and scripts/" require reading a large corpus to produce
// a small answer. Doing that in a Claude session spends context proportional to
// the CORPUS; doing it here spends context proportional to the ANSWER.
//
// This is a read-only question-answering tool. It does not edit files, and the
// agent flags are deliberately not exposed — the value is the summary, and an
// autonomous editor working from a summarized read of 161MB of data is not
// something to invoke casually.
//
// Three modes, in rough order of preference:
//
//   EXPLORE (no globs) — Gemini greps the repo itself. Usually best: it picks
//   what to read, so you don't have to guess a glob, and nothing large is ever
//   assembled in this process.
//     node scripts/gemini-ask.mjs -p "every caller of stripLinkAdjacentPunctuation?"
//
//   CORPUS (globs) — pin the exact file set when the question is "across
//   precisely these" and you don't want it wandering.
//     node scripts/gemini-ask.mjs -p "which mention leagueUrl?" 'docs/claude/**/*.md'
//
//   STDIN — for content that isn't on disk.
//     git diff | node scripts/gemini-ask.mjs -p "summarize the risk in this diff"
//
//   --list  shows what CORPUS mode would send, without calling the API.
//
// Exit codes: 0 answered, 1 usage/known error, 2 gemini failed.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Corpus cap. Gemini's window is far larger, but this is the point where a
// question is usually better split — and it is a guard against accidentally
// piping in the whole 161MB data/ tree.
const DEFAULT_MAX_BYTES = 1_000_000;

/**
 * Resolve a WORKING gemini binary.
 *
 * This machine has two: v0.23.0 under node 20 (broken — its OAuth path demands
 * GOOGLE_CLOUD_PROJECT) and v0.55.x under node 22 (working, API-key auth).
 * nvm's default is node 22, but any shell that has node 20 active — including
 * some tool harnesses — resolves the broken one from PATH. So prefer the
 * newest nvm-installed binary by version, and only fall back to PATH.
 */
function resolveGemini() {
  const nvmRoot = join(homedir(), '.nvm', 'versions', 'node');
  const candidates = [];

  if (existsSync(nvmRoot)) {
    for (const version of readdirSync(nvmRoot)) {
      const bin = join(nvmRoot, version, 'bin', 'gemini');
      if (existsSync(bin)) {
        // "v22.21.1" -> [22, 21, 1] for a real numeric compare; a string sort
        // puts v20 above v9 and, worse, v9 above v22.
        const parts = version.replace(/^v/, '').split('.').map(Number);
        candidates.push({ bin, parts });
      }
    }
  }

  candidates.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      if ((b.parts[i] ?? 0) !== (a.parts[i] ?? 0)) return (b.parts[i] ?? 0) - (a.parts[i] ?? 0);
    }
    return 0;
  });

  return candidates[0]?.bin ?? 'gemini';
}

function parseArgs(argv) {
  const args = { prompt: null, patterns: [], maxBytes: DEFAULT_MAX_BYTES, listOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompt' || a === '-p') args.prompt = argv[++i];
    else if (a === '--max-bytes') args.maxBytes = Number(argv[++i]);
    else if (a === '--list') args.listOnly = true;
    else if (a.startsWith('-')) {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    } else args.patterns.push(a);
  }
  return args;
}

/** Expand globs to a deduped, existing, sorted file list. */
function collectFiles(patterns) {
  const seen = new Set();
  for (const pattern of patterns) {
    let matches;
    try {
      matches = globSync(pattern, { withFileTypes: false });
    } catch {
      matches = existsSync(pattern) ? [pattern] : [];
    }
    for (const m of matches) {
      try {
        if (statSync(m).isFile()) seen.add(m);
      } catch {
        /* vanished between glob and stat — ignore */
      }
    }
  }
  return [...seen].sort();
}

/**
 * Build the corpus, stopping at the byte cap.
 *
 * Truncation is REPORTED, not silent: an answer derived from half the corpus
 * that claims to cover all of it is worse than no answer, because it reads as
 * authoritative. The caller sees which files were dropped.
 */
function buildCorpus(files, maxBytes) {
  const chunks = [];
  let total = 0;
  const included = [];
  const skipped = [];

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      skipped.push(`${file} (unreadable)`);
      continue;
    }
    const block = `\n===== FILE: ${file} =====\n${text}\n`;
    const size = Buffer.byteLength(block, 'utf8');
    if (total + size > maxBytes) {
      skipped.push(`${file} (${size} bytes — over cap)`);
      continue;
    }
    chunks.push(block);
    included.push(file);
    total += size;
  }

  return { corpus: chunks.join(''), total, included, skipped };
}

/**
 * Strip the CLI's own chatter so stdout is just the answer.
 *
 * The binary prints terminal-capability warnings and tool-availability notices
 * to the same stream as the response. Left in, they end up quoted back to the
 * user as if Gemini had said them.
 */
const CHROME = [
  /^Warning: .*color support.*$/i,
  /^Ripgrep is not available.*$/i,
  /^Loaded cached credentials\.?$/i,
  /^Data collection is disabled\.?$/i,
  /^\s*$/,
];

function stripChrome(out) {
  const lines = out.split('\n');
  let start = 0;
  while (start < lines.length && CHROME.some((re) => re.test(lines[start]))) start++;
  return lines.slice(start).join('\n').trim();
}

function main() {
  const args = parseArgs(process.argv);

  const stdinText = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');

  if (!args.prompt) {
    console.error('Usage: gemini-ask.mjs --prompt "<question>" [glob ...]   (or pipe input on stdin)');
    process.exit(1);
  }

  // EXPLORE MODE: no globs, no stdin. The CLI is agentic and will grep the
  // workspace itself, so handing it a question with no corpus is both valid
  // and usually the better call — it decides what to read, which beats
  // guessing a glob, and nothing large ever crosses into this process.
  // (Verified: asked for every caller of stripLinkAdjacentPunctuation with no
  // files passed, and it returned exactly the three pinned call sites.)
  const files = collectFiles(args.patterns);
  const explore = !files.length && !stdinText.trim();
  if (explore && args.patterns.length) {
    console.error(
      `[gemini-ask] warning: globs matched nothing (${args.patterns.join(', ')}) — falling back to explore mode.`
    );
  }

  const { corpus, total, included, skipped } = buildCorpus(files, args.maxBytes);

  if (args.listOnly) {
    console.log(`Would send ${included.length} file(s), ${total} bytes:`);
    included.forEach((f) => console.log(`  ${f}`));
    if (skipped.length) {
      console.log(`\nSkipped ${skipped.length}:`);
      skipped.forEach((f) => console.log(`  ${f}`));
    }
    return;
  }

  const truncationNote = skipped.length
    ? `\n\nNOTE: ${skipped.length} file(s) were omitted for size. Your answer covers only the files above; say so if that limits it.`
    : '';

  const input = `${stdinText ? `${stdinText}\n` : ''}${corpus}`;

  const sourceRule = explore
    ? 'Search this repository to answer. Read whatever files you need.'
    : 'Answer from the supplied content only.';

  const prompt = `${args.prompt}

${sourceRule} Cite file paths (and line numbers where you can) so the answer can be verified without re-reading everything. Be concise — the whole point is that the asker does not want to read the corpus. If you cannot answer, say so plainly rather than inferring.${truncationNote}`;

  const bin = resolveGemini();
  console.error(
    `[gemini-ask] ${bin.replace(homedir(), '~')} · ${
      explore ? 'explore mode (gemini searches the repo)' : `${included.length} file(s) · ${total} bytes`
    }${skipped.length ? ` · ${skipped.length} skipped` : ''}`
  );

  let out;
  try {
    out = execFileSync(bin, [prompt], {
      input,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: 'true' },
    });
  } catch (err) {
    console.error(`[gemini-ask] gemini failed: ${err.message}`);
    if (err.stdout) console.error(err.stdout.slice(0, 2000));
    if (err.stderr) console.error(err.stderr.slice(0, 2000));
    process.exit(2);
  }

  console.log(stripChrome(out));
  if (skipped.length) {
    console.error(`[gemini-ask] omitted for size: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ', …' : ''}`);
  }
}

main();
