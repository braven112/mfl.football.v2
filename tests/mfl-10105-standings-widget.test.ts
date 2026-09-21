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
function makeFeeds(opts: { withVp: boolean; vp?: number[] }) {
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
    };
    if (opts.withVp) row.vp = String(opts.vp ? opts.vp[i] : 12 - i);
    return row;
  });
  return { league, leagueStandings: { leagueStandings: { franchise: rows } } };
}

/* ---------- run the real file ---------- */
async function run(opts: { withVp: boolean; vp?: number[]; config?: Record<string, number> }) {
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
    window: { location: { pathname: '/2026/home/10105' } },
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

const classCount = (body: El[], cls: string) =>
  body.filter((r) => r.className.split(' ').includes(cls)).length;

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
    const { body } = await run({ withVp: true, config: { DIVISION_LEADER_SEEDS: 3, RUNNER_UP_SEEDS: 3, WILD_CARD_SEEDS: 2 } });
    expect(classCount(body, 'division-row')).toBe(3);
    expect(classCount(body, 'runnerup-row')).toBe(3);
    expect(classCount(body, 'wildcard-row')).toBe(2);
  });

  it('takes division leaders and runners-up from MFL feed order, not by VP', async () => {
    /* Franchise 0002 is given the highest VP in division 00, but 0001 comes
     * first in MFL's order — so 0001 leads and 0002 is the runner-up. Re-sorting
     * MFL's rows is the bug this pins. */
    const vp = [1, 99, 2, 3, 50, 40, 30, 20, 45, 35, 25, 15];
    const { body } = await run({
      withVp: true,
      vp,
      config: { DIVISION_LEADER_SEEDS: 3, RUNNER_UP_SEEDS: 3, WILD_CARD_SEEDS: 2 },
    });
    const leaders = body.filter((r) => r.className.includes('division-row'));
    const names = leaders.map((r) => r.children[1].textContent);
    expect(names.some((n) => n.includes('0001'))).toBe(true);
    const seconds = body.filter((r) => r.className.includes('runnerup-row'));
    expect(seconds.map((r) => r.children[1].textContent).some((n) => n.includes('0002'))).toBe(true);
  });

  it('draws a cut line after the last qualifier', async () => {
    const { body } = await run({ withVp: true, config: { DIVISION_LEADER_SEEDS: 3, RUNNER_UP_SEEDS: 3, WILD_CARD_SEEDS: 2 } });
    const cut = body.find((r) => r.children[0]?.className === 'mp99-cut-cell');
    expect(cut?.textContent).toContain('8 QUALIFY');
  });

  it('flags a VP tie straddling the cut instead of breaking it silently', async () => {
    /* Leaders take 0001/0005/0009 and runners-up 0002/0006/0010, leaving
     * 0003 and 0004 both on 8 — one wild card place between them. */
    const vp = [10, 9, 8, 8, 10, 9, 5, 5, 10, 9, 5, 4];
    const { body } = await run({
      withVp: true,
      vp,
      config: { DIVISION_LEADER_SEEDS: 3, RUNNER_UP_SEEDS: 3, WILD_CARD_SEEDS: 1 },
    });
    const note = body.find((r) => r.children[0]?.className === 'mp99-note-cell');
    expect(note?.textContent).toMatch(/also on \d+ Victory Points/);
    expect(note?.textContent).toContain('league tiebreaker');
  });

  it('marks tied teams rather than presenting an arbitrary order as fact', async () => {
    const vp = new Array(12).fill(7);
    const { body } = await run({ withVp: true, vp, config: { DIVISION_LEADER_SEEDS: 3, RUNNER_UP_SEEDS: 3, WILD_CARD_SEEDS: 2 } });
    const tieMarks = body.filter((r) => r.children[3]?.textContent.includes('T'));
    expect(tieMarks.length).toBeGreaterThan(0);
  });

  it("prints MFL's own W-L-T record, unreformatted", async () => {
    const { body } = await run({ withVp: true });
    expect(body[0].children[2].textContent).toBe('2-0-0');
  });

  it('says so plainly when MFL does not publish Victory Points', async () => {
    const { body } = await run({ withVp: false });
    const text = body.map((r) => r.textContent).join(' ');
    expect(text).toContain('Victory Points are not published');
    expect(text).toContain('Setup');
    /* Never a table of plausible-looking zeros. */
    expect(classCount(body, 'division-row')).toBe(0);
  });

  it('never renders a red top scorer while every score is still zero', async () => {
    const { body } = await run({ withVp: true, vp: new Array(12).fill(0) });
    expect(classCount(body, 'highlight-row')).toBe(0);
  });
});
