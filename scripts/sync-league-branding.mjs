#!/usr/bin/env node
/**
 * Keep a package league's team branding in step with MFL — new logos and
 * renames an owner makes on MyFantasyLeague.com.
 *
 *   node scripts/sync-league-branding.mjs                    # every package league, writes
 *   node scripts/sync-league-branding.mjs --league archies   # one league
 *   node scripts/sync-league-branding.mjs --dry-run          # report only
 *
 * ## Why this exists
 *
 * `suggest-league-branding.mjs` seeds a league's config from MFL ONCE and then
 * refuses to run over it, so the commissioner's edits are never thrown away.
 * Nothing re-read MFL after that, so every logo an owner uploaded there later
 * was invisible here: in Oct 2026 Archie's owners saw their old art on MFL
 * Live, with 13 of 99 teams stale and one renamed (Stoners → Stonecutters).
 *
 * ## What it may change, and what it never touches
 *
 * Per team, it compares MFL with what it saw LAST time (`mflSync`, written on
 * every team), not with the config — that is how an MFL change is told apart
 * from a commissioner's edit:
 *
 *   - logo: only while the team's icon is still the generated file
 *     (`/assets/<league>/icons/<id>.webp`). An icon uploaded in the branding
 *     editor lives on Vercel Blob and is never replaced. A change is a new
 *     content hash, so a re-upload under the SAME file name is caught too.
 *   - colours: re-derived from the new art only while they still equal the
 *     ones derived last time; a hand-picked colour stays.
 *   - name: only when MFL's name moved AND ours still equals MFL's old one. The
 *     old name is kept as an alias, as a branding-editor rename does.
 *
 * The first run has no `mflSync` yet, so it treats the seeded config as what
 * MFL said: art counts as changed when the banner URL moved or the colours
 * derived from today's art differ from the stored ones.
 *
 * ## The rollover stop
 *
 * Some leagues renumber franchises between seasons (`renumbersFranchises`),
 * which would read as a mass rename and alias every team with a stranger's
 * name. A run that would rename more than `MAX_RENAMES_SHARE` of a league
 * writes nothing and exits 1, for a human to re-seed instead.
 *
 * A run that found nothing writes nothing — every commit is a production build.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES, getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { leagueYearFor } from './lib/schefter-league-year.mjs';
import { arrayOf, cleanName, colorsFromImage, fetchImage, squareIcon, suggestNames } from './suggest-league-branding.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Above this share of a league renamed in one run, assume a renumbering. */
export const MAX_RENAMES_SHARE = 0.25;

/** The icon path the seed script writes, and the only icon this may replace. */
export const generatedIconPath = (slug, franchiseId) => `/assets/${slug}/icons/${franchiseId}.webp`;

export const hashBytes = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

const isMflUrl = (url) => {
  try {
    const host = new URL(url).hostname;
    return host === 'myfantasyleague.com' || host.endsWith('.myfantasyleague.com');
  } catch {
    return false;
  }
};

/**
 * Decide one team's update. Pure: the caller fetches and hashes the art.
 *
 * @param {Record<string, any>} team                 the config entry
 * @param {{ name?: string, abbrev?: string }} franchise  MFL's league-export franchise
 * @param {{ slug: string, art: null | { bannerUrl: string, hash: string,
 *   colors: { primary: string, secondary: string } | null } }} opts
 *   `art` is null when MFL has none or it could not be read — the logo is then left alone.
 * @returns {{ team: Record<string, any>, changes: string[], writeIcon: boolean, renamed: boolean }}
 */
export function planTeamSync(team, franchise, { slug, art }) {
  const prev = team.mflSync ?? {};
  const firstRun = !team.mflSync;
  const next = { ...team };
  const changes = [];
  let writeIcon = false;
  let renamed = false;

  // ── Name ────────────────────────────────────────────────────────────────
  const mflName = cleanName(franchise.name);
  const baseline = prev.name ?? team.name;
  if (mflName && mflName !== baseline && team.name === baseline) {
    const names = suggestNames(franchise.name, franchise.abbrev);
    next.name = names.name;
    next.nameMedium = names.nameMedium;
    next.nameShort = names.nameShort;
    next.abbrev = names.abbrev;
    next.aliases = [...new Set([...(team.aliases ?? []), team.name, ...names.aliases])].filter((a) => a && a !== names.name);
    changes.push(`name ${team.name} → ${names.name}`);
    renamed = true;
  }

  // ── Logo + colours ──────────────────────────────────────────────────────
  const ownsIcon = team.icon === generatedIconPath(slug, team.franchiseId);
  let syncArt = {};
  if (art && ownsIcon) {
    const storedColors = { primary: team.colorPrimary, secondary: team.colorSecondary };
    const sameColors = (c) => !!c && c.primary === storedColors.primary && c.secondary === storedColors.secondary;
    const artChanged = firstRun
      ? art.bannerUrl !== team.banner || (art.colors !== null && !sameColors(art.colors))
      : art.hash !== prev.artHash;

    if (artChanged) {
      writeIcon = true;
      changes.push('logo');
      if (!team.banner || isMflUrl(team.banner)) next.banner = art.bannerUrl;
      // No art recorded yet (first run, or the last read failed): the colours
      // are still the seed's, so they follow the art.
      const colorsAreAuto =
        prev.artHash === undefined ||
        (team.colorPrimary === prev.colorPrimary && team.colorSecondary === prev.colorSecondary);
      if (art.colors && colorsAreAuto && !sameColors(art.colors)) {
        if (!team.color || team.color === team.colorPrimary) next.color = art.colors.primary;
        next.colorPrimary = art.colors.primary;
        next.colorSecondary = art.colors.secondary;
        changes.push('colors');
      }
    }
    syncArt = { artHash: art.hash, colorPrimary: next.colorPrimary, colorSecondary: next.colorSecondary };
  } else {
    syncArt = { artHash: prev.artHash, colorPrimary: prev.colorPrimary, colorSecondary: prev.colorSecondary };
  }

  next.mflSync = Object.fromEntries(
    Object.entries({ name: mflName || prev.name, ...syncArt }).filter(([, v]) => v !== undefined),
  );
  return { team: next, changes, writeIcon, renamed };
}

/**
 * @param {{ slug: string, dryRun?: boolean, root?: string, now?: Date, fetchJson?: (url: string) => Promise<any>,
 *   fetchBytes?: (url: string) => Promise<Buffer>, log?: Pick<Console, 'log' | 'warn'> }} opts
 */
export async function syncLeagueBranding({
  slug,
  dryRun = false,
  root = ROOT,
  now = new Date(),
  fetchJson = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`MFL league export: HTTP ${res.status}`);
    return res.json();
  },
  fetchBytes = fetchImage,
  log = console,
}) {
  const league = getLeagueBySlug(slug);
  if (!league?.configPath) throw new Error(`Unknown league or no config: ${slug}`);
  const file = path.join(root, league.configPath);
  const before = fs.readFileSync(file, 'utf8');
  const config = JSON.parse(before);

  const year = leagueYearFor(league, now);
  const mfl = (await fetchJson(`https://${league.mflHost}/${year}/export?TYPE=league&L=${league.id}&JSON=1`))?.league;
  const franchises = new Map(arrayOf(mfl?.franchises?.franchise).map((f) => [f.id, f]));
  if (franchises.size === 0) throw new Error(`${slug}: MFL returned no franchises for ${year}.`);

  const icons = [];
  const report = [];
  let renames = 0;
  const teams = [];
  for (const team of config.teams ?? []) {
    const f = franchises.get(team.franchiseId);
    if (!f) {
      teams.push(team);
      continue;
    }
    const bannerUrl = f.logo || f.icon || '';
    let art = null;
    let iconBuf = null;
    if (bannerUrl && team.icon === generatedIconPath(league.slug, team.franchiseId)) {
      try {
        const bannerBuf = await fetchBytes(bannerUrl);
        iconBuf = f.icon && f.icon !== bannerUrl ? await fetchBytes(f.icon) : bannerBuf;
        art = {
          bannerUrl,
          hash: hashBytes(Buffer.concat([bannerBuf, iconBuf])),
          colors: await colorsFromImage(bannerBuf),
        };
      } catch (err) {
        log.warn(`  ${team.franchiseId} ${team.name}: could not read the MFL art (${err.message}) — left as is.`);
      }
    }
    const plan = planTeamSync(team, f, { slug: league.slug, art });
    if (plan.renamed) renames += 1;
    if (plan.writeIcon && iconBuf) icons.push({ franchiseId: team.franchiseId, buf: iconBuf });
    if (plan.changes.length) report.push(`  ${team.franchiseId} ${plan.team.name}: ${plan.changes.join(', ')}`);
    teams.push(plan.team);
  }

  const limit = Math.max(3, Math.ceil(teams.length * MAX_RENAMES_SHARE));
  if (renames > limit) {
    throw new Error(
      `${slug}: ${renames} of ${teams.length} teams renamed at once — that looks like a franchise renumbering, ` +
        'not owners renaming. Nothing written; re-seed the branding by hand.',
    );
  }

  for (const line of report) log.log(line);
  const text = `${JSON.stringify({ ...config, teams }, null, 2)}\n`;
  const configChanged = text !== before;
  if (dryRun) {
    log.log(`${slug}: ${report.length} team(s) would change (dry run, nothing written).`);
    return { changed: report.length, written: false };
  }
  for (const { franchiseId, buf } of icons) {
    const abs = path.join(root, 'public', generatedIconPath(league.slug, franchiseId));
    const out = await squareIcon(buf);
    // Write unless identical. A missing file reads as null; no exists-then-write
    // window for the file to change in.
    let current = null;
    try {
      current = fs.readFileSync(abs);
    } catch {}
    if (current?.equals(out)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, out);
  }
  if (configChanged) fs.writeFileSync(file, text);
  log.log(`${slug}: ${report.length} team(s) updated from MFL.`);
  return { changed: report.length, written: configChanged };
}

/** Leagues whose branding was seeded from MFL: the package leagues. */
export const syncableLeagues = () => ALL_LEAGUES.filter((l) => l.pageKit === 'package' && l.configPath);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const only = argv.includes('--league') ? argv[argv.indexOf('--league') + 1] : null;
  const dryRun = argv.includes('--dry-run');
  const slugs = only ? [only] : syncableLeagues().map((l) => l.slug);
  let failed = false;
  for (const slug of slugs) {
    try {
      await syncLeagueBranding({ slug, dryRun });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}
