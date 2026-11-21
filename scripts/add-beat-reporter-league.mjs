#!/usr/bin/env node
/**
 * Add a paying league to the AI Beat Reporter plan: one command per league
 * (Brandon, 2026-11-19: onboarding is by hand for now, and every league names
 * its own reporter).
 *
 *   node scripts/add-beat-reporter-league.mjs \
 *     --mfl https://www49.myfantasyleague.com/2026/home/12345 \
 *     --slug smith --name "Smith Family League" [--short-name Smith] \
 *     --reporter-name "Scoop McGee" --voice-file scoop.txt --avatar scoop.png \
 *     [--dry-run] [--offline]
 *
 * `--voice "…"` works in place of `--voice-file`. The picture can be any
 * image sharp reads; it is cropped to 500x500 and saved as
 * public/assets/reporters/<slug>.webp.
 *
 * What it does: launches the league with scripts/new-league.mjs as the
 * `history-and-reporter` archetype (registry `tier: 'ai'`), which writes
 * History's pages, a news page per story, the league's own reporter
 * (`persona`), the scanner block and the weekly columns, then fetches the
 * league's MFL feeds. Everything it writes is ordinary repo content, so it
 * ships through a PR like any change.
 *
 * What it does NOT do is printed at the end: the history backfill, the PR,
 * the commissioner's widget line (it is signed with production's secret, so
 * it comes from /api/beat/snippet once the league is deployed) and the group
 * chat. docs/plans/beat-reporter-onboarding.md is the full checklist.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARCHETYPES } from '../src/config/league-archetypes.mjs';
import { SHARED_APP_ORIGIN } from '../src/config/leagues-data.mjs';
import { REPORTER_ARCHETYPE, specErrors } from './new-league.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPORTER_AVATAR_DIR = 'public/assets/reporters';
const AVATAR_SIZE = 500;

/**
 * An MFL league link → { mflId, mflHost }. Accepts any page of the league
 * (`/2026/home/12345`, `/2026/options?L=12345&O=…`).
 */
export function parseMflLeagueUrl(link) {
  let u;
  try {
    u = new URL(String(link));
  } catch {
    return null;
  }
  if (!/^www\d+\.myfantasyleague\.com$/.test(u.hostname)) return null;
  const id = u.searchParams.get('L') ?? u.pathname.match(/\/\d{4}\/home\/(\d{3,6})(?:\/|$)/)?.[1];
  return id && /^\d{3,6}$/.test(id) ? { mflId: id, mflHost: u.hostname } : null;
}

/**
 * The launch spec for a reporter league. Pure.
 * @param {{ mflId: string, mflHost: string, slug: string, name: string, shortName?: string, reporterName: string, voice: string }} args
 */
export function reporterSpec({ mflId, mflHost, slug, name, shortName, reporterName, voice }) {
  return {
    mflId: String(mflId),
    slug,
    name,
    ...(shortName ? { shortName } : {}),
    mflHost,
    archetype: REPORTER_ARCHETYPE,
    features: { ...ARCHETYPES[REPORTER_ARCHETYPE].features },
    reporter: {
      name: reporterName,
      voice,
      avatarUrl: `/assets/reporters/${slug}.webp`,
    },
  };
}

function usage(msg) {
  console.error(`${msg}\n\nUsage: node scripts/add-beat-reporter-league.mjs --mfl <league link> --slug <slug> --name "<league name>" --reporter-name "<name>" (--voice "<text>" | --voice-file <file>) --avatar <image> [--short-name <name>] [--dry-run] [--offline]`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const dryRun = argv.includes('--dry-run');
  const offline = argv.includes('--offline');

  const mfl = parseMflLeagueUrl(opt('--mfl'));
  if (!mfl) usage('--mfl must be a link to the league on wwwNN.myfantasyleague.com');
  const voiceFile = opt('--voice-file');
  const voice = voiceFile ? fs.readFileSync(voiceFile, 'utf8') : opt('--voice');
  const avatar = opt('--avatar');
  if (!avatar || !fs.existsSync(avatar)) usage('--avatar must be an image file');

  const spec = reporterSpec({
    ...mfl,
    slug: opt('--slug'),
    name: opt('--name'),
    shortName: opt('--short-name'),
    reporterName: opt('--reporter-name'),
    voice: voice?.trim(),
  });
  const errors = specErrors(spec);
  if (errors.length) usage(`Spec rejected:\n  - ${errors.join('\n  - ')}`);

  const avatarOut = path.join(REPORTER_AVATAR_DIR, `${spec.slug}.webp`);
  console.log(`${spec.reporter.name} will cover ${spec.name} (MFL ${spec.mflId} on ${spec.mflHost}).`);
  console.log(`  ${dryRun ? 'would write' : 'write'} ${avatarOut} (${AVATAR_SIZE}x${AVATAR_SIZE})`);
  if (!dryRun) {
    const { default: sharp } = await import('sharp');
    fs.mkdirSync(path.join(ROOT, REPORTER_AVATAR_DIR), { recursive: true });
    await sharp(avatar).resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' }).webp({ quality: 85 }).toFile(path.join(ROOT, avatarOut));
  }

  const args = ['scripts/new-league.mjs', '--spec', JSON.stringify(spec)];
  if (dryRun) args.push('--dry-run');
  if (offline) args.push('--offline');
  execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (dryRun) process.exit(0);

  console.log(`
Reporter league added. Still by hand (docs/plans/beat-reporter-onboarding.md):
  1. Past seasons for Ask the History:
       node scripts/backfill-historical-feeds.mjs --league=${spec.slug}
       node scripts/recompute-derived-chain.mjs
  2. Run pnpm test:unit, open a PR to staging, and ship it to production.
  3. Once it is live, get the commissioner's widget line (signed in as a platform admin):
       ${SHARED_APP_ORIGIN}/api/beat/snippet?league=${spec.slug}&format=text
     They paste it into MFL: Setup > Home Page Message.
  4. Group chat, if they want one: the chat hookup steps in the checklist.`);
}
