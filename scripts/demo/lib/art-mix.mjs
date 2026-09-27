/**
 * Real artwork mixed into the demo leagues, to show that a custom site carries
 * custom graphics: crests from the site's own leagues (owner-approved,
 * 2026-09-27 — nothing NSFW, nothing naming a real team or person in the art)
 * and NFL club logos under a riff on the club's name.
 *
 * A team wearing league art gets a NEW name that fits the art, never its real
 * one: the demo still names no real franchise (the leak scan checks). The art
 * is embedded in the crest SVG the demo already writes, so no page or asset
 * path changes.
 *
 * The demo build deletes public/assets/{afl,theleague} before it writes the
 * fictional art, so a source missing from disk is read from git's copy.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** League art: key → [light file, dark file or null], under public/. */
const LEAGUE_ART = {
  amish: ['assets/afl/icons/amish.png', 'assets/afl/icons/amish_dark.png'],
  badd_boys: ['assets/afl/icons/badd_boys.png', 'assets/afl/icons/badd_boys_dark.png'],
  da_dangsters: ['assets/afl/icons/da_dangsters.png', 'assets/afl/icons/da_dangsters_dark.png'],
  herd: ['assets/afl/icons/herd.png', null],
  minty: ['assets/afl/icons/minty.png', 'assets/afl/icons/minty_dark.png'],
  ninjas: ['assets/afl/icons/ninjas.png', 'assets/afl/icons/ninjas_dark.png'],
  gobblers: ['assets/afl/icons/gobblers.png', null],
  ditka: ['assets/afl/icons/ditka.png', 'assets/afl/icons/ditka_dark.png'],
  swift: ['assets/afl/icons/swift.png', 'assets/afl/icons/swift_dark.png'],
  saints: ['assets/afl/icons/saints.png', 'assets/afl/icons/saints_dark.png'],
  bring_the_pain: ['assets/theleague/icons/bring_the_pain.png', 'assets/theleague/icons/bring_the_pain_dark.png'],
  cowboy_up: ['assets/theleague/icons/cowboy_up.png', 'assets/theleague/icons/cowboy_up_dark.png'],
  dark_magicians: ['assets/theleague/icons/dark_magicians.png', null],
  dead_cap_walking: ['assets/theleague/icons/dead_cap_walking.png', 'assets/theleague/icons/dead_cap_walking_dark.png'],
  fire_ready_aim: ['assets/theleague/icons/fire_ready_aim.png', 'assets/theleague/icons/fire_ready_aim_dark.png'],
  geeks: ['assets/theleague/icons/geeks.png', 'assets/theleague/icons/geeks_dark.png'],
  heavy_chevy: ['assets/theleague/icons/heavy_chevy.png', null],
  pigskins: ['assets/theleague/icons/pigskins.png', 'assets/theleague/icons/pigskins_dark.png'],
  the_dream: ['assets/theleague/icons/the_dream.png', 'assets/theleague/icons/the_dream_dark.png'],
  wabbits: ['assets/theleague/icons/wabbits.png', 'assets/theleague/icons/wabbits_dark.png'],
  highclimbers: ['assets/afl/history/highclimbers_icon.gif', null],
  maniacs: ['assets/afl/history/l_c_maniacs_icon.gif', null],
  lucky_buck: ['assets/afl/history/lucky_buck_icon.jpg', null],
  vitside: ['assets/afl/history/vitside_2010_icon.png', null],
  atf: ['assets/afl/history/atf_icon_100.png', null],
  // The white Cardinals bird derived for the NFL Brand Book (reversed cut).
  white_cardinal: ['assets/nfl-logos/reversed/ARI.svg', null],
  // The Browns' secondary (dog) mark: ESPN's brand-kit cut, trimmed to 320px
  // and committed with the demo, since the site itself never serves it.
  browns_dog: ['repo:scripts/demo/art/browns-dog.png', null],
};

/** Art that is white and needs its own ground in BOTH themes: key → disc colour. */
export const ART_BACKDROP = { white_cardinal: '#97233f' };

/** NFL clubs with a reversed (dark-ground) cut committed. */
const NFL_REVERSED = new Set(['ARI', 'DET', 'WSH']);

/**
 * Per demo: franchise id → [art, name, short name, abbrev, primary, secondary].
 * `art` is a LEAGUE_ART key or `nfl:<CODE>`.
 */
export const ART_ASSIGNMENTS = {
  dynasty: {
    '0001': ['pigskins', 'Razorback Ridge Boars', 'Boars', 'RRB', '#b3261e', '#1c1c1c'],
    '0002': ['geeks', 'Gridiron Grinners', 'Grinners', 'GGR', '#1f4e8c', '#f28c28'],
    '0006': ['white_cardinal', 'Redbird Cardinals', 'Cardinals', 'RBC', '#97233f', '#ffb612'],
    '0003': ['nfl:PIT', 'Steel Town Steelers', 'Steelers', 'STS', '#101820', '#ffb612'],
    '0005': ['bring_the_pain', 'Crossbones Corsairs', 'Corsairs', 'XBC', '#1a1a1a', '#d9d9d9'],
    '0007': ['nfl:GB', 'Frozen Tundra Packers', 'Packers', 'FTP', '#203731', '#ffb612'],
    '0009': ['dark_magicians', 'Midnight Spellbinders', 'Spellbinders', 'MSB', '#1b2a6b', '#39c3e6'],
    '0011': ['nfl:CHI', 'Windy City Bears', 'Bears', 'WCB', '#0b162a', '#c83803'],
    '0013': ['cowboy_up', 'Red Boot Ramblers', 'Ramblers', 'RBR', '#c8323c', '#f4efe4'],
    '0016': ['ditka', 'Old School Sergeants', 'Sergeants', 'OSS', '#0b3d91', '#c8102e'],
  },
  keeper: {
    '0002': ['wabbits', 'Warren Wreckers', 'Wreckers', 'WWR', '#111111', '#f5f5f5'],
    '0003': ['white_cardinal', 'Cactus League Cardinals', 'Cardinals', 'CLC', '#97233f', '#ffb612'],
    '0004': ['the_dream', 'Open Field Stampede', 'Stampede', 'OFS', '#1d4f91', '#e87722'],
    '0006': ['heavy_chevy', 'Motor Row Hot Rods', 'Hot Rods', 'MRH', '#b01c2e', '#c0c0c0'],
    '0008': ['fire_ready_aim', 'Tin Star Deputies', 'Deputies', 'TSD', '#6b5b3e', '#d4a017'],
    '0009': ['nfl:MIN', 'North Star Vikings', 'Vikings', 'NSV', '#4f2683', '#ffc62f'],
    '0011': ['swift', 'Lakeside Songbirds', 'Songbirds', 'LSB', '#c2185b', '#f8bbd0'],
    '0012': ['nfl:DEN', 'Mile High Broncos', 'Broncos', 'MHB', '#fb4f14', '#002244'],
  },
  redraft: {
    '0001': ['amish', 'Harvest Hill Barnraisers', 'Barnraisers', 'HHB', '#7a1f2b', '#9ec7e6'],
    '0003': ['white_cardinal', 'Big Red Cardinals', 'Cardinals', 'BRC', '#97233f', '#ffb612'],
    '0002': ['nfl:LV', 'Sin City Raiders', 'Raiders', 'SCR', '#000000', '#a5acaf'],
    '0004': ['badd_boys', 'Back Alley Bosses', 'Bosses', 'BAB', '#2b2b2b', '#bdbdbd'],
    '0006': ['nfl:KC', 'Arrowhead Chiefs', 'Chiefs', 'ARC', '#e31837', '#ffb81c'],
    '0007': ['da_dangsters', 'Smoke Room Dons', 'Dons', 'SRD', '#16324f', '#c9a227'],
    '0009': ['nfl:SF', 'Gold Rush 49ers', '49ers', 'GRN', '#aa0000', '#b3995d'],
    '0010': ['saints', 'Night Watch Vigilantes', 'Vigilantes', 'NWV', '#8b0000', '#1a1a1a'],
  },
  bigleague: {
    '0002': ['white_cardinal', 'Desert Heat Cardinals', 'Cardinals', 'DHC', '#97233f', '#ffb612'],
    '0007': ['atf', 'Alcohol Tobacco and Firearms', 'ATF', 'ATF', '#343a52', '#d4a70a'],
    '0005': ['herd', 'Bronze Legion', 'Legion', 'BRL', '#9e1b32', '#e0a526'],
    '0009': ['nfl:ATL', 'Peach State Falcons', 'Falcons', 'PSF', '#a71930', '#101820'],
    '0014': ['nfl:BAL', 'Charm City Ravens', 'Ravens', 'CCR', '#241773', '#9e7c0c'],
    '0017': ['minty', 'Greenleaf Guardians', 'Guardians', 'GLG', '#1b6b35', '#f0c419'],
    '0021': ['nfl:BUF', 'Snow Belt Bills', 'Bills', 'SBB', '#00338d', '#c60c30'],
    '0026': ['nfl:CAR', 'Queen City Panthers', 'Panthers', 'QCP', '#0085ca', '#101820'],
    '0029': ['ninjas', 'Fiesta Shadows', 'Shadows', 'FSH', '#1e5631', '#c8102e'],
    '0033': ['nfl:CIN', 'Jungle Bengals', 'Bengals', 'JUB', '#fb4f14', '#000000'],
    '0038': ['nfl:CLE', 'Lake Erie Browns', 'Browns', 'LEB', '#311d00', '#ff3c00'],
    '0030': ['browns_dog', 'Dawg Pound Bulldogs', 'Bulldogs', 'DPB', '#311d00', '#ff3c00'],
    '0041': ['dead_cap_walking', 'Graveyard Ghouls', 'Ghouls', 'GYG', '#2f4f2f', '#a4c639'],
    '0045': ['nfl:DAL', 'Big D Cowboys', 'Cowboys', 'BDC', '#041e42', '#869397'],
    '0050': ['nfl:DET', 'Motor City Lions', 'Lions', 'MCL', '#0076b6', '#b0b7bc'],
    '0053': ['highclimbers', 'Hilltop Hooligans', 'Hooligans', 'HTH', '#c8102e', '#1a1a1a'],
    '0057': ['nfl:HOU', 'Space City Texans', 'Texans', 'SCT', '#03202f', '#a71930'],
    '0062': ['nfl:IND', 'Crossroads Colts', 'Colts', 'CRC', '#002c5f', '#a2aaad'],
    '0065': ['maniacs', 'Spiral Eye Mystics', 'Mystics', 'SEM', '#e87722', '#1a1a1a'],
    '0069': ['nfl:JAX', 'Duval Jaguars', 'Jaguars', 'DVJ', '#006778', '#d7a22a'],
    '0074': ['nfl:LAC', 'Bolt Coast Chargers', 'Chargers', 'BCC', '#0080c6', '#ffc20e'],
    '0077': ['lucky_buck', 'Four Leaf Fortunes', 'Fortunes', 'FLF', '#1d2d6b', '#f2c200'],
    '0081': ['nfl:LAR', 'Hollywood Rams', 'Rams', 'HWR', '#003594', '#ffd100'],
    '0086': ['nfl:MIA', 'South Beach Dolphins', 'Dolphins', 'SBD', '#008e97', '#fc4c02'],
    '0089': ['vitside', 'Crimson Wyverns', 'Wyverns', 'CWY', '#b3001b', '#111111'],
    '0093': ['nfl:NE', 'Minuteman Patriots', 'Patriots', 'MMP', '#002244', '#c60c30'],
    '0010': ['nfl:NO', 'Big Easy Saints', 'Saints', 'BES', '#101820', '#d3bc8d'],
    '0022': ['nfl:NYG', 'Big Blue Giants', 'Giants', 'BBG', '#0b2265', '#a71930'],
    '0034': ['nfl:NYJ', 'Gotham Jets', 'Jets', 'GOJ', '#125740', '#ffffff'],
    '0046': ['nfl:PHI', 'Liberty Bell Eagles', 'Eagles', 'LBE', '#004c54', '#a5acaf'],
    '0058': ['nfl:SEA', 'Emerald City Seahawks', 'Seahawks', 'ECS', '#002244', '#69be28'],
    '0070': ['nfl:TB', 'Pewter Bay Buccaneers', 'Buccaneers', 'PBB', '#d50a0a', '#34302b'],
    '0082': ['nfl:TEN', 'Volunteer Titans', 'Titans', 'VOT', '#0c2340', '#4b92db'],
    '0094': ['nfl:WAS', 'Capital Commanders', 'Commanders', 'CAP', '#5a1414', '#ffb612'],
    '0060': ['gobblers', 'Sweatband Strutters', 'Strutters', 'SWS', '#e91e63', '#212121'],
  },
};

/**
 * Real names the owner has approved for the demo (2026-09-27), exempt from the
 * name scrub, the leak scan and the demo tests. Every other real franchise or
 * person stays blocked; keep this list to explicit owner requests.
 */
export const APPROVED_REAL_NAMES = ['Alcohol Tobacco and Firearms', 'Alcohol, Tobacco and Firearms', 'ATF'];

/** Every NFL club nickname: a demo club may carry one (an NFL-art team). */
export const NFL_NICKNAMES = [
  'Cardinals', 'Falcons', 'Ravens', 'Bills', 'Panthers', 'Bears', 'Bengals', 'Browns', 'Cowboys', 'Broncos',
  'Lions', 'Packers', 'Texans', 'Colts', 'Jaguars', 'Chiefs', 'Raiders', 'Chargers', 'Rams', 'Dolphins',
  'Vikings', 'Patriots', 'Saints', 'Giants', 'Jets', 'Eagles', 'Steelers', '49ers', 'Seahawks', 'Buccaneers',
  'Titans', 'Commanders',
];

const MIME = { '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };

const cache = new Map();

/** franchises.mjs#lighten, repeated here: franchises.mjs imports this module. */
function lighten(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (255 - c) * amount);
  };
  return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('')}`;
}

/** An art file's bytes (public/, or repo-relative with `repo:`) — from disk, or git's committed copy once the build has wiped it. */
function readPublic(rel) {
  if (cache.has(rel)) return cache.get(rel);
  // `repo:` art lives outside public/ (demo-only files the site never serves).
  const repoPath = rel.startsWith('repo:') ? rel.slice(5) : `public/${rel}`;
  const onDisk = path.join(ROOT, repoPath);
  const bytes = fs.existsSync(onDisk)
    ? fs.readFileSync(onDisk)
    : execFileSync('git', ['show', `HEAD:${repoPath}`], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });
  cache.set(rel, bytes);
  return bytes;
}

function artFiles(art) {
  if (art.startsWith('nfl:')) {
    const code = art.slice(4);
    return [`assets/nfl-logos/${code}.svg`, NFL_REVERSED.has(code) ? `assets/nfl-logos/reversed/${code}.svg` : null];
  }
  const files = LEAGUE_ART[art];
  if (!files) throw new Error(`demo art: unknown art "${art}"`);
  return files;
}

/** Whether the art has its own cut for a dark ground. */
export function hasDarkCut(art) {
  return Boolean(artFiles(art)[1]);
}

/** `data:` URI for a franchise's art, light or dark cut (falling back to light). */
export function artDataUri(art, { dark = false } = {}) {
  const [light, darkFile] = artFiles(art);
  const rel = (dark && darkFile) || light;
  const mime = MIME[path.extname(rel).toLowerCase()];
  if (!mime) throw new Error(`demo art: no media type for ${rel}`);
  return `data:${mime};base64,${readPublic(rel).toString('base64')}`;
}

/**
 * Apply a demo's assignments to its franchise list: the assigned teams take
 * the art, a name fitted to it, and its colours. Everything else about the
 * franchise (id, owner, division) is untouched.
 */
export function withArt(demo, franchises, { slugOf } = {}) {
  const assignments = ART_ASSIGNMENTS[demo] ?? {};
  return franchises.map((f) => {
    const a = assignments[f.id];
    if (!a) return f;
    const [art, name, nameShort, abbrev, colorPrimary, colorSecondary] = a;
    const next = { ...f, art, name, nameShort, abbrev, colorPrimary, colorSecondary };
    // The dark-theme variants were derived from the old colours.
    if ('colorPrimaryDark' in f) next.colorPrimaryDark = lighten(colorPrimary, 0.25);
    if ('colorSecondaryDark' in f) next.colorSecondaryDark = lighten(colorSecondary, 0.6);
    if (slugOf && 'slug' in f) next.slug = slugOf(name);
    return next;
  });
}

/** Every art key an assignment may name — for the tests. */
export const ART_KEYS = [...Object.keys(LEAGUE_ART)];
