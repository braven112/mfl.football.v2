/**
 * Hand-written league content, made demo-safe. Some files are REPLACED (the
 * Schefter feed, the commissioner's own rookie roster); some are REWRITTEN in
 * place — franchise names swapped through the franchise id
 * (identity-files.mjs renamePairs), owner names swapped for a role. The leak
 * scan is the backstop for any real name a rewrite cannot reach.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRng } from './rng.mjs';
import { applyRenames } from './identity-files.mjs';
import { fictionalSchefterPosts } from './schefter-fiction.mjs';

const LEAGUE = 'theleague';

/** Source modules whose prose names franchises or people; rewritten in place. */
const REWRITE_IN_PLACE = [
  'src/data/hero-showcase/theleague.ts',
  'src/data/theleague/throwback-config.ts',
  'src/data/theleague/throwback-weeks.mjs',
  'src/data/theleague/league-events.ts',
  'src/data/league-constitution.ts',
  'src/data/rules-qa-system-prompt.ts',
  'src/data/rules-qa-seeds.json',
  'src/pages/theleague/rules.astro',
];

export function writeContentReplacements({ root, seasons, franchises, renames, currentYear, writeJson, writeText }) {
  const current = seasons.find((s) => s.year === currentYear) ?? seasons[seasons.length - 1];
  const denylist = JSON.parse(fs.readFileSync(path.join(root, '.demo-build/denylist.json'), 'utf8')).terms;
  const people = denylist.filter((t) => /^[A-Z][a-z]+ [A-Z][a-z'-]+$/.test(t));
  const mentionsReal = (text) => denylist.some((t) => text.includes(t));

  // --- Schefter -----------------------------------------------------------
  const feedPath = path.join(root, 'src/data', LEAGUE, 'schefter-feed.json');
  const real = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
  const neutral = (real.posts ?? []).filter(
    (p) => (p.type === 'external' || p.type === 'odds') && !mentionsReal(JSON.stringify(p)),
  );
  const rng = createRng(`schefter-${currentYear}`);
  const fiction = seasons
    .filter((s) => s.year >= currentYear - 1)
    .flatMap((s) => fictionalSchefterPosts({ season: s, franchises, rng, league: LEAGUE }));
  writeJson(feedPath, {
    lastScanTimestamp: new Date().toISOString(),
    lastProcessedMflTimestamp: '0',
    posts: [...fiction, ...neutral].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))),
    tradeBaitState: {},
    archivedThroughTimestamp: null,
    pendingTradeWatermark: 0,
  });
  writeJson(path.join(root, 'data/schefter', LEAGUE, 'topic-recurrence.json'), {
    version: 2,
    season: currentYear,
    fingerprints: {},
  });

  // --- What's New: the site's own release notes name real teams and owners.
  writeJson(path.join(root, 'src/data/whats-new.json'), []);

  // --- Pages that statically import one real owner's roster --------------
  const flagship = franchises[0];
  const displayName = (p) => {
    const [last, first] = String(p.name).split(',').map((s) => s.trim());
    return first ? `${first} ${last}` : last;
  };
  const players = {};
  const ownership = {};
  for (const [fid, r] of current.rosters) {
    const f = franchises.find((x) => x.id === fid);
    for (const [pid, c] of r) {
      const p = current.players.get(pid);
      if (!p) continue;
      const nm = displayName(p);
      ownership[nm] = {
        franchiseId: fid,
        franchiseName: f.name,
        franchiseSlug: f.slug.replace(/-/g, '_'),
        iconPath: `/assets/theleague/icons/${f.slug}.svg`,
        salary: c.salary,
        contractYear: c.contractYear,
      };
      if (fid === flagship.id) {
        players[nm] = { mflId: pid, name: nm, position: p.position, nflTeam: p.team, salary: c.salary, contractYear: c.contractYear };
      }
    }
  }
  writeJson(path.join(root, 'data', LEAGUE, `pigskins-roster-${currentYear}.json`), {
    franchise: flagship.id,
    name: flagship.name,
    season: currentYear,
    players,
  });
  writeJson(path.join(root, 'data', LEAGUE, 'rsp-league-ownership.json'), {
    meta: { description: 'Demo league ownership (fictional).', totalOwnershipEntries: Object.keys(ownership).length },
    ownership,
  });

  // --- Salary archive links point at the real league's spreadsheets ------
  writeJson(path.join(root, 'src/data', LEAGUE, 'salary-archive-links.json'), []);
  writeJson(path.join(root, 'src/data', LEAGUE, 'salary-archive-urls.json'), {});

  // --- Crest contrast manifest: drop the real league's rows ---------------
  const manifestPath = path.join(root, 'src/data/crest-dark-stroke-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.needsStroke = (manifest.needsStroke ?? []).filter((r) => r.league !== LEAGUE);
  writeJson(manifestPath, manifest);

  // --- Prose modules: rename franchises, anonymise people -----------------
  for (const rel of REWRITE_IN_PLACE) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    let text = applyRenames(fs.readFileSync(file, 'utf8'), renames);
    for (const person of people) text = text.split(person).join('the Commissioner');
    writeText(file, text);
  }
}
