/**
 * The real names the demo must never publish, collected from the real data
 * BEFORE the demo build deletes it. The leak scan (scripts/demo/leak-scan.mjs)
 * fails the build when any of these appears in the built output.
 *
 * Collected broadly — every franchise name of every era, nicknames and aliases,
 * every owner, both championship names — then filtered to terms distinctive
 * enough that a hit means a leak rather than an English word. A term shorter
 * than six characters, or one on GENERIC below, is dropped: "Dream" or
 * "Maverick" would fire on unrelated copy and teach everyone to ignore the scan.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Real names that are also ordinary words or phrases, too common to scan for. */
const GENERIC = new Set(
  [
    'Maverick', 'Mavericks', 'The Dream', 'Cowboy Up', 'Bring The Pain', 'Pain', 'Thunder', 'Lightning',
    'Outlaws', 'Rangers', 'Falcons', 'Raptors', 'Vipers', 'Keepers', 'Herons', 'Millers', 'Anvils',
    'Coyotes', 'Barracudas', 'Tritons', 'Scorpions', 'Bison', 'Chaos', 'Mafia', 'Connection',
  ].map((s) => s.toLowerCase()),
);

const MIN_LENGTH = 6;

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function collectDenylist({ root, league, realConfig, realRegistry }) {
  const raw = new Set();
  const add = (s) => {
    if (typeof s === 'string' && s.trim()) raw.add(s.trim());
  };

  for (const team of realConfig.teams ?? []) {
    for (const era of [team, ...(team.history ?? [])]) {
      add(era.name);
      add(era.nameMedium);
      add(era.nameShort);
    }
    for (const alias of team.aliases ?? []) add(alias);
  }

  const assets = readJsonSafe(path.join(root, 'src/data', `${league}.assets.json`));
  for (const t of assets?.teams ?? []) {
    add(String(t.name ?? '').replace(/\s*\(\d{4}.*\)\s*$/, ''));
    for (const alias of t.aliases ?? []) add(alias);
  }

  for (const person of realRegistry.people ?? []) {
    if ((person.claims ?? []).some((c) => c.league === league)) add(person.displayName);
  }

  const champs = readJsonSafe(path.join(root, 'data', league, 'championship-history.json'));
  for (const c of champs?.championships ?? []) {
    add(c.championName);
    add(c.runnerUpName);
  }

  const tenures = readJsonSafe(path.join(root, 'data', league, 'derived/owner-tenures.json'));
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if ((k === 'displayName' || k === 'ownerName') && typeof v === 'string') add(v);
        else walk(v);
      }
    }
  };
  walk(tenures);

  const terms = [...raw]
    .filter((t) => t.length >= MIN_LENGTH && !GENERIC.has(t.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  return { league, collectedAt: new Date().toISOString(), terms };
}
