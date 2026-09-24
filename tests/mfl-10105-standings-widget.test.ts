/**
 * Guard for the client standings widget at public/mfl/10105/standings.js.
 *
 * That file runs inside someone else's page on MyFantasyLeague's domain, so
 * nothing about it can be checked by loading this repo's app. It is exercised
 * here the way it actually runs: the real source, evaluated in a vm against a
 * DOM shim and synthetic MFL feeds.
 *
 * Each assertion below is a decision recorded in public/mfl/10105/DECISIONS.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import path from 'node:path';

const SOURCE = path.join(process.cwd(), 'public/mfl/10105/standings.js');

/* ---------- a DOM small enough to read, big enough to render into ---------- */
class El {
  tagName: string;
  children: El[] = [];
  attrs: Record<string, string> = {};
  className = '';
  id = '';
  style: Record<string, string> = {};
  parentNode: El | null = null;
  loading?: string;
  decoding?: string;
  src?: string;
  alt?: string;
  title?: string;
  colSpan?: number;
  private own = '';

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  appendChild(c: El) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  removeChild(c: El) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
  getElementsByTagName(t: string): El[] {
    const out: El[] = [];
    const walk = (n: El) => {
      for (const c of n.children) {
        if (c.tagName === t.toUpperCase()) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  set textContent(v: string) {
    this.own = String(v);
    this.children = [];
  }
  get textContent(): string {
    return this.own + this.children.map((c) => c.textContent).join('');
  }
  get firstChild(): El | null {
    return this.children[0] ?? null;
  }
  get rows() {
    return this.getElementsByTagName('tr');
  }
  get tBodies() {
    return this.getElementsByTagName('tbody');
  }
  querySelector() {
    return null;
  }
}

/* ---------- synthetic MFL feeds: 3 divisions of 4, 12 franchises ---------- */
function makeFeeds(opts: { withVp: boolean; vp?: number[]; pf?: number[] }) {
  const divisions = ['00', '01', '02'];
  const franchise = [];
  for (let d = 0; d < 3; d++) {
    for (let t = 0; t < 4; t++) {
      const id = String(d * 4 + t + 1).padStart(4, '0');
      franchise.push({
        id,
        name: `Team ${id}`,
        icon: `https://www48.myfantasyleague.com/fflnetdynamic2024/10105_franchise_icon${id}.png`,
        division: divisions[d],
      });
    }
  }
  const league = {
    league: {
      franchises: { franchise },
      divisions: {
        count: '3',
        division: divisions.map((id, i) => ({ id, name: `Division ${i}` })),
      },
    },
  };
  /* leagueStandings order is MFL's official order — the widget must honour it
   * for division placings rather than re-deriving them. */
  const rows = franchise.map((f, i) => {
    const row: Record<string, string> = {
      id: f.id,
      fname: f.name,
      h2hwlt: '2-0-0',
      /* MFL publishes the AVERAGE for this league, not the total. */
      avgpf: String(opts.pf ? opts.pf[i] : 100),
    };
    if (opts.withVp) row.vp = String(opts.vp ? opts.vp[i] : 12 - i);
    return row;
  });
  return { league, leagueStandings: { leagueStandings: { franchise: rows } } };
}

/* ---------- run the real file ---------- */
async function run(opts: {
  withVp: boolean;
  vp?: number[];
  pf?: number[];
  config?: Record<string, number>;
  winnings?: Record<string, unknown>;
}) {
  let source = readFileSync(SOURCE, 'utf8');
  if (opts.config) {
    for (const [k, v] of Object.entries(opts.config)) {
      source = source.replace(new RegExp(`var ${k}\\s*=\\s*\\d+`), `var ${k} = ${v}`);
    }
  }

  const table = new El('table');
  table.id = 'wwwc';
  const header = new El('tr');
  header.appendChild(new El('th'));
  table.appendChild(header);
  const head = new El('head');

  const feeds = makeFeeds(opts);
  const fetched: string[] = [];

  const document = {
    readyState: 'complete',
    head,
    createElement: (t: string) => new El(t),
    createTextNode: (t: string) => {
      const e = new El('#text');
      e.textContent = t;
      return e;
    },
    getElementById: (id: string) =>
      id === 'wwwc' ? table : head.children.find((c) => c.id === id) ?? null,
    querySelector: () => null,
    addEventListener: () => {},
  };

  const fetchStub = (url: string) => {
    fetched.push(url);
    const type = /TYPE=(\w+)/.exec(url)![1] as 'league' | 'leagueStandings';
    return Promise.resolve({ ok: true, json: () => Promise.resolve(feeds[type]) });
  };

  const ctx = createContext({
    window: {
      location: { pathname: '/2026/home/10105' },
      MAD_POWER_99_WINNINGS: opts.winnings,
    },
    document,
    fetch: fetchStub,
    Promise,
    Array,
    Object,
    Number,
    String,
    RegExp,
    console,
  });
  runInContext(source, ctx);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const body = table.rows.filter((r) => r.getElementsByTagName('th').length === 0);
  return { table, body, fetched, head };
}

/* Tiles and list rows live inside colspan cells, so count across the tree. */
function all(root: El): El[] {
  const out: El[] = [];
  const walk = (n: El) => { for (const c of n.children) { out.push(c); walk(c); } };
  walk(root);
  return out;
}
const classCount = (table: El, cls: string) =>
  all(table).filter((e) => e.className.split(' ').includes(cls)).length;
const textOf = (table: El, cls: string) =>
  all(table).filter((e) => e.className.split(' ').includes(cls)).map((e) => e.textContent);

describe('MAD POWER 99 standings widget (MFL 10105)', () => {
  it('reads league and year from the page URL, never a hardcoded id', async () => {
    const { fetched } = await run({ withVp: true });
    expect(fetched).toEqual([
      '/2026/export?TYPE=league&L=10105&JSON=1',
      '/2026/export?TYPE=leagueStandings&L=10105&JSON=1',
    ]);
    /* Root-relative, so it follows whichever wwwNN served the page. */
    for (const url of fetched) expect(url.startsWith('/')).toBe(true);
  });

  it('builds the four tiers at their configured sizes', async () => {
    const { table } = await run({ withVp: true, config: { DIVISION_LEADER_SEEDS: 3, RUNNER_UP_SEEDS: 3, WILD_CARD_SEEDS: 2 } });
    expect(classCount(table, 'division-row')).toBe(3);
    expect(classCount(table, 'runnerup-row')).toBe(3);
    expect(classCount(table, 'wildcard-row')).toBe(2);
    /* Everyone below the cut is a list row, not a tile. */
    expect(classCount(table, 'mp99-tile')).toBe(8);
    expect(classCount(table, 'mp99-list-row')).toBe(4);
  });

  it('takes division leaders and runners-up from MFL feed order, not by VP', async () => {
    /* Franchise 0002 is given the highest VP in division 00, but 0001 comes
     * first in MFL's order — so 0001 leads and 0002 is the runner-up. Re-sorting
     * MFL's rows is the bug this pins. */
    const vp = [1, 99, 2, 3, 50, 40, 30, 20, 45, 35, 25, 15];
    const { table } = await run({
      withVp: true,
      vp,
      config: { DIVISION_LEADER_SEEDS: 3, RUNNER_UP_SEEDS: 3, WILD_CARD_SEEDS: 2 },
    });
    const leaders = all(table).filter((e) => e.className.includes('division-row'));
    expect(leaders.map((e) => e.textContent).some((n) => n.includes('0001'))).toBe(true);
    const seconds = all(table).filter((e) => e.className.includes('runnerup-row'));
    expect(seconds.map((e) => e.textContent).some((n) => n.includes('0002'))).toBe(true);
  });

  it('draws a cut line after the last qualifier', async () => {
    const { table } = await run({ withVp: true, config: { DIVISION_LEADER_SEEDS: 3, RUNNER_UP_SEEDS: 3, WILD_CARD_SEEDS: 2 } });
    expect(textOf(table, 'mp99-cut-cell')[0]).toContain('8 QUALIFY');
  });

  it('names who just missed at the cut, and what separated them', async () => {
    /* Leaders take 0001/0005/0009 and runners-up 0002/0006/0010, leaving
     * 0003 and 0004 both on 8 — one wild card place between them. */
    const vp = [10, 9, 8, 8, 10, 9, 5, 5, 10, 9, 5, 4];
    const { table } = await run({
      withVp: true,
      vp,
      config: { DIVISION_LEADER_SEEDS: 3, RUNNER_UP_SEEDS: 3, WILD_CARD_SEEDS: 1 },
    });
    const note = textOf(table, 'mp99-note-cell')[0];
    expect(note).toMatch(/also on \d+ Victory Points/);
    /* Points For decides it now, so the note explains rather than defers. */
    expect(note).toContain('Points For');
    expect(note).not.toContain('league tiebreaker');
  });

  it('breaks a Victory Point tie on Points For', async () => {
    /* All level on VP, so Points For alone decides the order. 0003 scores
     * most, 0001 least. */
    const vp = new Array(12).fill(5);
    const pf = [100, 120, 140, 110, 101, 121, 141, 111, 102, 122, 142, 112];
    const { table } = await run({
      withVp: true, vp, pf,
      config: { DIVISION_LEADER_SEEDS: 3, RUNNER_UP_SEEDS: 3, WILD_CARD_SEEDS: 2 },
    });
    /* Wild cards are drawn from whoever is left, highest Points For first:
     * 0007 (141) then 0011 (142)... both above the rest. */
    const wild = all(table).filter((e) => e.className.includes('wildcard-row'));
    const names = wild.map((e) => e.textContent);
    expect(names.some((n) => n.includes('0011'))).toBe(true);
    expect(names.some((n) => n.includes('0007'))).toBe(true);
  });

  it('falls back to the average when MFL does not publish a Points For total', async () => {
    /* This league's standings display carries avgpf, not pf. Every team has
     * played the same number of games, so the two rank identically. */
    const source = readFileSync(SOURCE, 'utf8');
    expect(source).toContain('r.pf != null ? r.pf : r.avgpf');
  });

  it('marks tied teams rather than presenting an arbitrary order as fact', async () => {
    const vp = new Array(12).fill(7);
    const { table } = await run({ withVp: true, vp, config: { DIVISION_LEADER_SEEDS: 3, RUNNER_UP_SEEDS: 3, WILD_CARD_SEEDS: 2 } });
    expect(classCount(table, 'mp99-tie')).toBeGreaterThan(0);
  });

  it("prints MFL's own W-L-T record, unreformatted", async () => {
    const { table } = await run({ withVp: true });
    expect(textOf(table, 'mp99-tile-meta').every((t) => t.includes('2-0-0'))).toBe(true);
  });

  it('hides the six-column header, which no longer describes the layout', async () => {
    const { table } = await run({ withVp: true });
    const header = table.rows.find((r) => r.getElementsByTagName('th').length > 0);
    expect(header?.className).toContain('mp99-hide');
  });

  it('says so plainly when MFL does not publish Victory Points', async () => {
    const { body, table } = await run({ withVp: false });
    const text = body.map((r) => r.textContent).join(' ');
    expect(text).toContain('Victory Points are not published');
    expect(text).toContain('Setup');
    /* Never a table of plausible-looking zeros. */
    expect(classCount(table, 'division-row')).toBe(0);
  });

  it('never renders a red top scorer while every score is still zero', async () => {
    const { table } = await run({ withVp: true, vp: new Array(12).fill(0) });
    expect(classCount(table, 'highlight-row')).toBe(0);
  });
});

describe('prize money — the one hand-entered figure', () => {
  const DASH = '\u2014';
  const prizes = (table: El) =>
    [...textOf(table, 'mp99-prize'), ...textOf(table, 'mp99-list-prize')]
      .filter((t) => t && t !== DASH);

  it('reads the module block and formats it as currency', async () => {
    const { table } = await run({ withVp: true, winnings: { '0001': 239 } });
    expect(prizes(table)).toContain('$239.00');
  });

  it('accepts an amount typed with a dollar sign', async () => {
    const { table } = await run({ withVp: true, winnings: { '0001': '$1,250.50' } });
    expect(prizes(table)).toContain('$1,250.50');
  });

  it('shows a prize on a team below the cut, not just on qualifiers', async () => {
    /* 0004 is the lowest VP in division 00, so it falls into the field. */
    const { table } = await run({
      withVp: true,
      vp: [10, 9, 8, 1, 10, 9, 8, 2, 10, 9, 8, 3],
      config: { DIVISION_LEADER_SEEDS: 3, RUNNER_UP_SEEDS: 3, WILD_CARD_SEEDS: 2 },
      winnings: { '0004': 60 },
    });
    expect(textOf(table, 'mp99-list-prize').filter(Boolean)).toContain('$60.00');
  });

  it('shows a dash, not a blank, for a team left out or set to zero', async () => {
    const { table } = await run({ withVp: true, winnings: { '0001': 0 } });
    expect(prizes(table)).toEqual([]);
    /* The field is still visible on every team: with the header hidden, an
     * unset prize would otherwise leave no sign the column exists at all, and
     * tiles came out different heights. */
    expect(classCount(table, 'mp99-prize-none')).toBe(12);
  });

  it('survives junk without taking the table down', async () => {
    const { table } = await run({
      withVp: true,
      winnings: { '0001': 'not a number', '0002': null, '0003': 50 },
    });
    expect(classCount(table, 'mp99-tile') + classCount(table, 'mp99-list-row')).toBe(12);
    expect(prizes(table)).toContain('$50.00');
    expect(prizes(table).join(' ')).not.toContain('NaN');
  });

  it('renders no amounts when the module defines none, but keeps the field', async () => {
    const { table } = await run({ withVp: true });
    expect(prizes(table)).toEqual([]);
    expect(classCount(table, 'mp99-prize-none')).toBe(12);
  });
});

/**
 * The module shipped once carrying the table alone. That stripped the league's
 * page: the module also held the #madmen wrapper, the banner and a 7.7 KB
 * stylesheet, and every CSS rule is scoped to #madmen, so losing the wrapper
 * un-styled everything. These pin the parts that must survive a rebuild.
 */
describe('module.html — the complete MESSAGE6 module', () => {
  const module = readFileSync(path.join(process.cwd(), 'public/mfl/10105/module.html'), 'utf8');

  it('keeps the #madmen wrapper every CSS rule is scoped to', () => {
    expect(module).toContain('id="madmen"');
    expect(module).toContain('id="wwwc"');
    /* The stylesheet scopes every rule to that wrapper, so dropping it from
     * the module un-styles the page even though the CSS still loads. */
    const css = readFileSync(path.join(process.cwd(), 'public/mfl/10105/standings.css'), 'utf8');
    expect(css).toContain('#madmen #wwwc');
  });

  it('links the served stylesheet, which carries every scoped rule', () => {
    expect(module).toContain('https://v2.mfl.football/mfl/10105/standings.css');
    const css = readFileSync(path.join(process.cwd(), 'public/mfl/10105/standings.css'), 'utf8');
    /* The league's own rules and the widget's additions both live there. */
    for (const rule of ['.division-row', '.wildcard-row', '.winnings-row', '.highlight-row',
                        '.runnerup-row', '.mp99-cut-cell', '.mp99-tie', '.mp99-tile',
                        '.mp99-grid', '.mp99-list-row', '.mp99-prize', '.mp99-list-prize']) {
      expect(css).toContain(`#madmen #wwwc ${rule}`);
    }
    const league = readFileSync(
      path.join(process.cwd(), 'public/mfl/10105/reference/existing-page.css'), 'utf8',
    ).trim();
    expect(css).toContain(league);
  });

  it('keeps the banner, caption and column widths', () => {
    expect(module).toContain('https://v2.mfl.football/mfl/10105/banner.png');
    expect(module).toContain('<caption>MAD POWER 99</caption>');
    for (const col of ['col-rank', 'col-team', 'col-record', 'col-points', 'col-winnings', 'col-division']) {
      expect(module).toContain(col);
    }
  });

  it('carries the prize block the commissioner edits', () => {
    expect(module).toContain('window.MAD_POWER_99_WINNINGS');
    /* Commented examples only — never real amounts committed to the repo. */
    expect(module).toMatch(/\/\/\s*"0001":/);
  });

  it('carries the hosted widget and no hand-written team rows', () => {
    expect(module).toContain('https://v2.mfl.football/mfl/10105/standings.js');
    /* One <tr> for the #madmen wrapper, one for the header. No data rows.
     * Checked by their markup, not by class names — the stylesheet mentions
     * .team-banner legitimately. */
    expect((module.match(/<tr>/g) ?? []).length).toBe(2);
    expect(module).not.toContain('<td class="team"');
    expect(module).not.toContain('<td class="rank"');
  });
});
