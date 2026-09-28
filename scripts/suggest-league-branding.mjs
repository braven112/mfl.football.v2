#!/usr/bin/env node
/**
 * Suggest a league's team branding from MFL — the starting draft a
 * commissioner edits rather than a blank form (docs/plans/league-chat-and-persona.md).
 *
 *   node scripts/suggest-league-branding.mjs --league archies            # print a summary
 *   node scripts/suggest-league-branding.mjs --league archies --write    # write the config
 *
 * For every franchise:
 *   - name, division and icon come straight from MFL's league export;
 *   - nameMedium (<= 15), nameShort (<= 10) and abbrev (<= 5) are derived by
 *     rule from the name, the same limits `chooseTeamName` enforces;
 *   - colorPrimary / colorSecondary are the two most prominent saturated
 *     colours in the franchise's MFL art;
 *   - banner is the MFL art itself (it is banner-shaped), and icon is a
 *     128px centre crop of it written to public/assets/<league>/icons/.
 *
 * Dark-surface variants (`colorPrimaryDark` …) are deliberately NOT guessed:
 * every reader already falls back to the primary, and a hand-tuned dark cut
 * is the commissioner's call in the branding editor.
 *
 * `--write` refuses to overwrite a config that already has teams unless
 * `--force` is passed: once a commissioner has edited branding, a re-run from
 * MFL would silently throw their work away.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export const LIMITS = Object.freeze({ medium: 15, short: 10, abbrev: 5 });

/** Collapse whitespace; MFL names carry stray trailing spaces ("Goats "). */
export function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim();
}

/** The longest leading run of whole words that fits `max`, else a hard cut. */
export function fitWords(name, max) {
  if (name.length <= max) return name;
  const words = name.split(' ');
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  // A single word longer than the limit: prefer the LAST word (usually the
  // mascot — "Philadelphia" vs "Eagles") before truncating.
  const last = words[words.length - 1];
  return last.length <= max ? last : name.slice(0, max);
}

/**
 * Name versions for one franchise. Multi-word names shorten to their last
 * word (the mascot) for the short form, which is how owners refer to teams.
 */
export function suggestNames(rawName, rawAbbrev) {
  const name = cleanName(rawName);
  const words = name.split(' ');
  const mascot = words[words.length - 1];
  const nameMedium = fitWords(name, LIMITS.medium);
  const nameShort =
    name.length <= LIMITS.short ? name : mascot.length <= LIMITS.short ? mascot : fitWords(name, LIMITS.short);
  const abbrevSource = cleanName(rawAbbrev) || mascot;
  let abbrev = abbrevSource.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (abbrev.length > LIMITS.abbrev) {
    abbrev =
      words.length > 1
        ? words.map((w) => w[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, LIMITS.abbrev)
        : abbrev.slice(0, LIMITS.abbrev);
  }
  const aliases = [...new Set([mascot, nameShort, nameMedium].filter((a) => a && a !== name))];
  return { name, nameMedium, nameShort, abbrev: abbrev || 'TEAM', aliases };
}

const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * The two brand colours of an image, from its raw RGBA pixels.
 *
 * MFL franchise art in this package is busy illustration, not a flat logo, so
 * the most COMMON colour is usually the dark background. Colours are scored by
 * coverage x chroma instead: a teal that covers 6% of the art beats a
 * charcoal that covers 40%. Transparent pixels are ignored; near-neutral
 * colours only win when the art has nothing saturated at all.
 *
 * @param {Uint8Array | Buffer} rgba
 * @returns {{ primary: string, secondary: string } | null}
 */
export function dominantColors(rgba) {
  const buckets = new Map();
  let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    total += 1;
    // 16 levels per channel: coarse enough to pool a colour's shading.
    const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n += 1;
    b.r += rgba[i];
    b.g += rgba[i + 1];
    b.b += rgba[i + 2];
    buckets.set(key, b);
  }
  if (total === 0) return null;

  const colors = [...buckets.values()].map((b) => {
    const rgb = [b.r / b.n, b.g / b.n, b.b / b.n];
    const max = Math.max(...rgb);
    const min = Math.min(...rgb);
    // Chroma relative to brightness, so a deep navy still counts as a colour.
    const chroma = max === 0 ? 0 : (max - min) / max;
    const lively = max > 60 ? 1 : max / 60; // near-black is never a brand colour
    return { rgb, share: b.n / total, chroma, score: (b.n / total) * (chroma * lively) ** 2 };
  });

  // Pool near-identical shades so one colour's gradient can't fill both slots.
  const pooled = [];
  for (const c of colors.sort((a, b) => b.score - a.score)) {
    const hit = pooled.find((m) => dist(m.rgb, c.rgb) < 48);
    if (hit) {
      hit.score += c.score;
      hit.share += c.share;
    } else pooled.push({ ...c });
  }
  pooled.sort((a, b) => b.score - a.score);

  const vivid = pooled.filter((c) => c.chroma >= 0.25 && c.share >= 0.01);
  const primary = vivid[0] ?? [...pooled].sort((a, b) => b.share - a.share)[0];
  const secondary =
    vivid.find((c) => c !== primary && dist(c.rgb, primary.rgb) >= 90) ??
    pooled.find((c) => c !== primary && dist(c.rgb, primary.rgb) >= 90) ??
    null;
  const lum = primary.rgb[0] * 0.299 + primary.rgb[1] * 0.587 + primary.rgb[2] * 0.114;
  const fallback = lum > 150 ? [24, 24, 24] : [240, 240, 240];
  return { primary: hex(...primary.rgb), secondary: hex(...(secondary?.rgb ?? fallback)) };
}

/** Square icon size. Small on purpose: 99 of these live in the repo. */
export const ICON_SIZE = 128;

async function fetchImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function colorsFromImage(buf) {
  const { data } = await sharp(buf).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return dominantColors(data);
}

/**
 * A suggested square icon: the centre square of the franchise art. This
 * package's MFL art is a wide banner (1500x636), and the team's mascot and
 * wordmark sit in the middle of it, so the centre crop is the best
 * no-human-involved guess. `attention` would chase busy background detail.
 */
async function squareIcon(buf) {
  return sharp(buf).resize(ICON_SIZE, ICON_SIZE, { fit: 'cover', position: 'centre' }).webp({ quality: 82 }).toBuffer();
}

function arrayOf(v) {
  return Array.isArray(v) ? v : v ? [v] : [];
}

function parseArgs(argv) {
  const opts = { league: null, write: false, force: false, year: new Date().getFullYear() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--league') opts.league = argv[++i];
    else if (argv[i] === '--year') opts.year = Number(argv[++i]);
    else if (argv[i] === '--write') opts.write = true;
    else if (argv[i] === '--force') opts.force = true;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const league = opts.league ? getLeagueBySlug(opts.league) : null;
  if (!league) {
    console.error('Usage: node scripts/suggest-league-branding.mjs --league <slug> [--year N] [--write] [--force]');
    process.exit(1);
  }
  const outPath = path.join(ROOT, league.configPath);
  if (opts.write && !opts.force && fs.existsSync(outPath)) {
    const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    if (Array.isArray(existing.teams) && existing.teams.length > 0) {
      console.error(`${league.configPath} already has teams — pass --force to replace edited branding.`);
      process.exit(1);
    }
  }

  const url = `https://${league.mflHost}/${opts.year}/export?TYPE=league&L=${league.id}&JSON=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MFL league export: HTTP ${res.status}`);
  const mfl = (await res.json()).league;
  const divisions = arrayOf(mfl.divisions?.division).map((d) => ({ id: d.id, name: cleanName(d.name) }));
  const divisionName = new Map(divisions.map((d) => [d.id, d.name]));

  const teams = [];
  for (const f of arrayOf(mfl.franchises?.franchise).sort((a, b) => a.id.localeCompare(b.id))) {
    const names = suggestNames(f.name, f.abbrev);
    const art = f.logo || f.icon || null;
    let colors = null;
    let icon = null;
    try {
      const buf = art ? await fetchImage(art) : null;
      if (buf) {
        colors = await colorsFromImage(buf);
        if (opts.write) {
          const rel = `assets/${league.slug}/icons/${f.id}.webp`;
          const abs = path.join(ROOT, 'public', rel);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, await squareIcon(buf));
          icon = `/${rel}`;
        }
      }
    } catch (err) {
      console.warn(`  ${f.id} ${names.name}: could not read the MFL art (${err.message}) — neutral colours, no icon.`);
    }
    teams.push({
      franchiseId: f.id,
      name: names.name,
      nameMedium: names.nameMedium,
      nameShort: names.nameShort,
      abbrev: names.abbrev,
      aliases: names.aliases,
      division: divisionName.get(f.division) ?? f.division ?? '',
      divisionId: f.division ?? '',
      color: colors?.primary ?? '#4b5563',
      colorPrimary: colors?.primary ?? '#4b5563',
      colorSecondary: colors?.secondary ?? '#e5e7eb',
      ...(icon ? { icon } : {}),
      // The MFL art itself is the banner: it is already banner-shaped.
      ...(art ? { banner: art } : {}),
    });
  }

  const config = {
    $comment:
      `${league.name} (MFL ${league.id}). Branding SUGGESTED from MFL by scripts/suggest-league-branding.mjs ` +
      '— names by rule, colours from each MFL icon. The commissioner edits it from here; do not regenerate over edits.',
    leagueId: league.id,
    name: league.name,
    structure: 'divisions',
    divisions,
    loaderLines: ['Loading the league…'],
    teams,
  };

  if (!opts.write) {
    for (const t of teams) {
      console.log(`${t.franchiseId}  ${t.name.padEnd(24)} ${t.nameShort.padEnd(11)} ${t.abbrev.padEnd(6)} ${t.colorPrimary} ${t.colorSecondary}  ${t.division}`);
    }
    console.log(`\n${teams.length} teams, ${divisions.length} divisions. Re-run with --write to save ${league.configPath}.`);
    return;
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Wrote ${league.configPath}: ${teams.length} teams, ${divisions.length} divisions.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
