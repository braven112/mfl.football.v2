/**
 * The demo league's sixteen fictional franchises.
 *
 * Nothing here may resemble a real franchise or owner in any league the site
 * runs — the post-build leak scan (scripts/demo/leak-scan.mjs) fails the demo
 * build if a real name survives anywhere in the output, and
 * tests/demo-generator.test.ts checks this list against the real configs.
 *
 * Colours are chosen to be distinct at a glance in a 16-row table and to read
 * on both white and a dark card; `toBroadcastPair`-style consumers derive
 * their own pairs from `colorPrimary`/`colorSecondary`.
 */

export const DEMO_DIVISIONS = ['Summit', 'Harbor', 'Prairie', 'Canyon'];

/**
 * id, city/name, short name, abbrev, owner, division index, primary, secondary.
 * Owners are invented full names; any match to a real person is coincidence.
 */
const RAW = [
  ['0001', 'Redwood Rangers', 'Rangers', 'RWR', 'Dana Whitlock', 0, '#2f6b3a', '#d8c79a'],
  ['0002', 'Lakeshore Lightning', 'Lightning', 'LSL', 'Marcus Ellery', 0, '#1f5fbf', '#f2c230'],
  ['0003', 'Ironbridge Anvils', 'Anvils', 'IBA', 'Priya Castellano', 0, '#4a4f57', '#e2733b'],
  ['0004', 'Copper Valley Coyotes', 'Coyotes', 'CVC', 'Theo Brandt', 0, '#b8642f', '#2a2a2a'],
  ['0005', 'Bayside Barracudas', 'Barracudas', 'BAY', 'Renee Okafor', 1, '#0e8a8a', '#0b2a3d'],
  ['0006', 'Tidewater Tritons', 'Tritons', 'TWT', 'Gus Halvorsen', 1, '#12467a', '#8fd3e8'],
  ['0007', 'Lighthouse Keepers', 'Keepers', 'LHK', 'Imani Reyes', 1, '#c8322f', '#f4efe4'],
  ['0008', 'Saltmarsh Herons', 'Herons', 'SMH', 'Owen Pritchard', 1, '#5b7f95', '#e9e4d8'],
  ['0009', 'Prairie Thunder', 'Thunder', 'PRT', 'Lena Novak', 2, '#6a3fa0', '#f0b429'],
  ['0010', 'Windmill City Millers', 'Millers', 'WCM', 'Hector Ruiz', 2, '#8a6d3b', '#1c1c1c'],
  ['0011', 'Golden Plains Bison', 'Bison', 'GPB', 'Carla Jennings', 2, '#7a4b24', '#e6c36a'],
  ['0012', 'Big Sky Falcons', 'Falcons', 'BSF', 'Nate Osei', 2, '#2b7bb9', '#b7c7d6'],
  ['0013', 'Mesa Vipers', 'Vipers', 'MSV', 'Sofia Lindqvist', 3, '#3f8f3a', '#111111'],
  ['0014', 'Red Rock Raptors', 'Raptors', 'RRR', 'Jamal Whitaker', 3, '#b3261e', '#f3d9b1'],
  ['0015', 'Desert Sun Scorpions', 'Scorpions', 'DSS', 'Ava Kowalski', 3, '#e08a1e', '#3b2314'],
  ['0016', 'Arroyo Outlaws', 'Outlaws', 'ARO', 'Felix Moreau', 3, '#262626', '#c9a227'],
];

/** Lighten a #rrggbb colour toward white by `amount` (0..1), for dark-theme variants. */
export function lighten(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (255 - c) * amount);
  };
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

export const DEMO_FRANCHISES = RAW.map(
  ([id, name, nameShort, abbrev, owner, divisionIndex, colorPrimary, colorSecondary]) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return {
      id,
      name,
      nameShort,
      abbrev,
      owner,
      ownerFirst: owner.split(' ')[0],
      slug,
      divisionIndex,
      division: DEMO_DIVISIONS[divisionIndex],
      colorPrimary,
      colorSecondary,
      colorPrimaryDark: lighten(colorPrimary, 0.25),
      colorSecondaryDark: lighten(colorSecondary, 0.6),
    };
  },
);

/** The demo league's own name — used wherever the real site prints its league name. */
export const DEMO_LEAGUE_NAME = 'The Demo League';
