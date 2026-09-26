/**
 * The demo build's last source pass: rewrite every text file the build could
 * bundle so no real franchise or person is named anywhere in it.
 *
 * Order matters. First the franchise-id renames (a real TheLeague franchise
 * becomes the fictional franchise with the same id, so prose still reads
 * naturally); then every remaining denylisted term becomes a neutral
 * placeholder — people become "League Member", other leagues' franchises
 * become "Guest Club N". Those other leagues' pages are refused by the demo
 * middleware, so their placeholders are never rendered; they exist so the data
 * files shared modules import carry no real identity into the bundle.
 *
 * Runs after the derivation chain (which needs the untouched registry for the
 * other leagues), and before `astro build`. The leak scan then verifies the
 * OUTPUT, because a scrub of inputs can only ever be as good as its term list.
 */

import fs from 'node:fs';
import path from 'node:path';
import { applyRenames, replaceTerms } from './identity-files.mjs';

const TEXT = /\.(json|ts|tsx|mts|mjs|js|cjs|astro|md|mdx|css|scss|txt|svg|html|xml|yaml|yml)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.demo-build', '.vercel', 'dist', '.astro']);


function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (TEXT.test(entry.name)) yield p;
  }
}


/**
 * @param {object} args
 * @param {string[]} args.dirs       absolute directories to rewrite
 * @param {string[]} args.terms      denylist terms, longest first
 * @param {[string,string][]} args.renames  franchise-id renames, applied first
 * @param {Set<string>} [args.people] terms known to be people
 * @returns {{files: number, replacements: number}}
 */
export function scrubIdentity({ dirs, terms, renames, people = new Set() }) {
  const placeholder = new Map();
  let club = 0;
  for (const t of terms) {
    if (people.has(t)) placeholder.set(t, 'League Member');
    else {
      club += 1;
      placeholder.set(t, t === t.toLowerCase() ? `guestclub${club}` : `Guest Club ${club}`);
    }
  }
  let files = 0;
  let replacements = 0;
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      const before = fs.readFileSync(file, 'utf8');
      const after = replaceTerms(applyRenames(before, renames), placeholder, () => {
        replacements += 1;
      });
      if (after !== before) {
        fs.writeFileSync(file, after);
        files += 1;
      }
    }
  }
  return { files, replacements };
}
