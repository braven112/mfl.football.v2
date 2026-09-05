#!/usr/bin/env node
/**
 * Guard-gap inventory for a rules doc: which of its rules have a test, and
 * which are prose only.
 *
 * docs/claude/rules/README.md: "a test is checked, prose is skimmed". This
 * does the mechanical half of finding the skimmed ones — it lists every
 * rule-shaped sentence in the doc and every test that already cites the doc
 * or its domain — so the judgment half (matching sentence to suite, deciding
 * which shape of guard fits) starts from an inventory rather than a re-read.
 *
 *   node scripts/guard-gap.mjs docs/claude/rules/lineups.md
 *   node scripts/guard-gap.mjs --all        # one summary line per rules doc
 *   node scripts/guard-gap.mjs <doc> --json
 *
 * "Rule-shaped" = a line containing never / must / always / only / do not /
 * don't / required / is not / are not, outside code fences. Over-inclusive
 * by design; the agent prunes.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const json = args.includes('--json');
const all = args.includes('--all');
const docArg = args.find((a) => a.endsWith('.md'));

const RULE_RE = /\b(never|must|always|only|do not|don'?t|required|is not|are not|cannot|can't)\b/i;

function walkTests() {
  return readdirSync(path.join(ROOT, 'tests'))
    .filter((f) => /\.test\.(ts|js)$/.test(f))
    .map((f) => `tests/${f}`);
}

function inventory(doc) {
  const text = readFileSync(path.join(ROOT, doc), 'utf8');
  const lines = text.split('\n');
  const rules = [];
  let fence = false;
  let section = '';
  lines.forEach((line, i) => {
    if (/^```/.test(line)) fence = !fence;
    if (fence) return;
    if (/^#{1,4}\s/.test(line)) section = line.replace(/^#+\s*/, '').trim();
    if (RULE_RE.test(line) && line.trim().length > 20) {
      rules.push({ line: i + 1, section, text: line.trim().replace(/\s+/g, ' ').slice(0, 160) });
    }
  });

  const declared = [...text.matchAll(/`(tests\/[^`]+\.test\.[tj]s)`/g)].map((m) => m[1]);
  const declaredUnique = [...new Set(declared)].map((t) => ({ test: t, exists: existsSync(path.join(ROOT, t)) }));

  const domain = path.basename(doc, '.md');
  const keyword = domain.split('-')[0];
  const citing = [];
  const byKeyword = [];
  for (const t of walkTests()) {
    const src = readFileSync(path.join(ROOT, t), 'utf8');
    if (src.includes(doc)) citing.push(t);
    else if (t.includes(keyword)) byKeyword.push(t);
  }
  return { doc, rules, declared: declaredUnique, citing, byKeyword };
}

function print(inv) {
  console.log(`# ${inv.doc}\n`);
  console.log(`${inv.rules.length} rule-shaped line(s); ${inv.citing.length} test(s) cite the doc; ${inv.declared.length} Guard: declaration(s); ${inv.byKeyword.length} test(s) share the domain keyword\n`);
  if (inv.declared.length) {
    console.log('## Declared guards');
    for (const d of inv.declared) console.log(`- ${d.exists ? 'ok     ' : 'MISSING'} ${d.test}`);
    console.log();
  }
  if (inv.citing.length) {
    console.log('## Tests that cite this doc');
    for (const t of inv.citing) console.log(`- ${t}`);
    console.log();
  }
  if (inv.byKeyword.length) {
    console.log(`## Tests named for the domain (${inv.rules.length ? 'candidates for the rules below' : ''})`);
    for (const t of inv.byKeyword) console.log(`- ${t}`);
    console.log();
  }
  console.log('## Rule-shaped lines (prune, then match each to a test or mark it prose-only)');
  for (const r of inv.rules) console.log(`- L${r.line} [${r.section}] ${r.text}`);
}

if (all) {
  const dir = path.join(ROOT, 'docs/claude/rules');
  const docs = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => `docs/claude/rules/${f}`);
  const summary = docs.map((d) => {
    const inv = inventory(d);
    return { doc: d, rules: inv.rules.length, citing: inv.citing.length, declared: inv.declared.length, missingDeclared: inv.declared.filter((x) => !x.exists).length, byKeyword: inv.byKeyword.length };
  });
  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log('| doc | rule lines | tests citing | Guard: decls | missing decls | keyword tests |');
    console.log('|---|---|---|---|---|---|');
    for (const s of summary) console.log(`| ${s.doc} | ${s.rules} | ${s.citing} | ${s.declared} | ${s.missingDeclared} | ${s.byKeyword} |`);
  }
} else if (docArg) {
  const inv = inventory(docArg);
  if (json) console.log(JSON.stringify(inv, null, 2));
  else print(inv);
} else {
  console.error('usage: node scripts/guard-gap.mjs <path to one rules doc> [--json] | --all');
  process.exit(2);
}
