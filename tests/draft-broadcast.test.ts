/**
 * Pure logic behind the AFL draft broadcast board.
 *
 * The board-position line is what the room reacts to, so the keeper handling
 * behind it is pinned here. The AFL keeps 7 per franchise — 84 players gone
 * before 1.01 — and `duplicatePlayers` means the two conferences keep
 * INDEPENDENTLY. Pool the two and ~84 legitimately draftable players vanish
 * from a board they belong on.
 */

import { describe, it, expect } from 'vitest';
import {
  bestAvailableAt,
  formatBestAvailable,
  findOnTheClock,
  recentPicks,
  upcomingPicks,
  positionRunCount,
  applyRehearsal,
  darkenForWhiteText,
  contrastWithWhite,
  toBroadcastColor,
  toBroadcastPair,
} from '../src/utils/draft-broadcast';
import {
  assignBoardRanks,
  buildConferenceBoard,
  findRehearsalYear,
  loadConferenceKeepers,
} from '../src/utils/draft-broadcast-server';
import { existsSync, readFileSync } from 'node:fs';
import type { DraftRoomPick } from '../src/types/draft-room';
import type { BroadcastPlayer } from '../src/types/draft-broadcast';

function slot(overall: number, playerId = '', franchiseId = '0001'): DraftRoomPick {
  return {
    round: Math.ceil(overall / 12),
    pickInRound: ((overall - 1) % 12) + 1,
    overallPickNumber: overall,
    franchiseId,
    playerId,
    timestamp: '',
    comments: '',
    isTraded: false,
  };
}

function player(id: string, position: string, adp?: number): BroadcastPlayer {
  return {
    id,
    name: `Player ${id}`,
    position,
    nflTeam: 'KCC',
    headshot: '',
    adpAveragePick: adp,
  } as BroadcastPlayer;
}

describe('bestAvailableAt', () => {
  const players = new Map<string, BroadcastPlayer>([
    ['a', { ...player('a', 'RB'), boardRank: 1 } as BroadcastPlayer],
    ['b', { ...player('b', 'WR'), boardRank: 2 } as BroadcastPlayer],
    ['c', { ...player('c', 'TE'), boardRank: 3 } as BroadcastPlayer],
    ['d', { ...player('d', 'QB'), boardRank: 4 } as BroadcastPlayer],
    // A kept player carries no boardRank and must never occupy a position.
    ['kept', player('kept', 'RB')],
  ]);

  it('calls the top of the board the best available', () => {
    const board = [slot(1, 'a')];
    expect(bestAvailableAt(board, players, 1, 'a')).toBe(1);
  });

  it('promotes players as better ones come off the board', () => {
    // b is 2nd overall, but by pick 2 the only man above him is gone.
    const board = [slot(1, 'a'), slot(2, 'b')];
    expect(bestAvailableAt(board, players, 2, 'b')).toBe(1);
  });

  it('counts only the players still on the board at that pick', () => {
    // At pick 2, d (rank 4) trails b and c — a is already gone.
    const board = [slot(1, 'a'), slot(2, 'd')];
    expect(bestAvailableAt(board, players, 2, 'd')).toBe(3);
  });

  it('ignores picks that land AFTER the one being revealed', () => {
    // A queued reveal must not be re-ranked by picks made while it waited.
    const board = [slot(1, 'a'), slot(2, 'b'), slot(3, 'c'), slot(4, 'd')];
    expect(bestAvailableAt(board, players, 1, 'a')).toBe(1);
  });

  it('never lets a kept player occupy a board position', () => {
    const board = [slot(1, 'a')];
    expect(bestAvailableAt(board, players, 1, 'kept')).toBeUndefined();
  });
});

describe('formatBestAvailable', () => {
  it('names the top of the board without an ordinal', () => {
    expect(formatBestAvailable(1)).toBe('BEST AVAILABLE');
  });

  it('uses real English ordinals', () => {
    expect(formatBestAvailable(2)).toBe('2nd BEST AVAILABLE');
    expect(formatBestAvailable(3)).toBe('3rd BEST AVAILABLE');
    expect(formatBestAvailable(4)).toBe('4th BEST AVAILABLE');
    // The teens are the trap: 11/12/13 are th, not st/nd/rd.
    expect(formatBestAvailable(11)).toBe('11th BEST AVAILABLE');
    expect(formatBestAvailable(12)).toBe('12th BEST AVAILABLE');
    expect(formatBestAvailable(13)).toBe('13th BEST AVAILABLE');
    expect(formatBestAvailable(21)).toBe('21st BEST AVAILABLE');
    expect(formatBestAvailable(112)).toBe('112th BEST AVAILABLE');
  });

  it('says nothing when there is no rank', () => {
    expect(formatBestAvailable(undefined)).toBeNull();
    expect(formatBestAvailable(0)).toBeNull();
  });
});

describe('assignBoardRanks', () => {
  it('ranks by ADP and skips keepers entirely', () => {
    const pool = [
      { ...player('elite', 'RB', 2), id: 'elite' },
      { ...player('kept', 'WR', 1), id: 'kept' },
      { ...player('good', 'TE', 30), id: 'good' },
    ] as BroadcastPlayer[];
    const ranked = assignBoardRanks(pool, new Set(['kept']));
    const byId = new Map(ranked.map((p) => [p.id, p]));

    // The kept man has the best ADP and still gets no rank — he was never on
    // this board, so counting him would push everyone else down one.
    expect(byId.get('kept')?.boardRank).toBeUndefined();
    expect(byId.get('elite')?.boardRank).toBe(1);
    expect(byId.get('good')?.boardRank).toBe(2);
  });

  it('ranks on MFL ADP alone \u2014 the league\u2019s own sources are not an input', () => {
    // Brandon, 2026-08-27: the ranking sources are not for this screen. A
    // player MFL lists no ADP for stays off the board rather than being slotted
    // in from another source, so the board can never quietly become a blend.
    const pool = [
      { ...player('noAdp', 'WR'), consensusRank: 5 } as unknown as BroadcastPlayer,
      player('lateAdp', 'RB', 200),
    ];
    const byId = new Map(assignBoardRanks(pool, new Set()).map((p) => [p.id, p]));
    expect(byId.get('lateAdp')?.boardRank).toBe(1);
    expect(byId.get('noAdp')?.boardRank).toBeUndefined();
  });

  it('leaves a player with no ADP out of the board', () => {
    const pool = [player('ghost', 'TE')] as BroadcastPlayer[];
    expect(assignBoardRanks(pool, new Set())[0].boardRank).toBeUndefined();
  });
});

describe('loadConferenceKeepers', () => {
  // Reads the real AFL feed on purpose — the invariant is about how THIS
  // league's data is shaped, and a fixture keeps passing after the shape moves.
  //
  // But it asserts SHAPE, never a roster COUNT. `rosters.json` is cron-written:
  // the moment Saturday's picks land, every franchise goes from 7 keepers to
  // ~16, and a `toBe(84)` would fail on main on a data-only commit. That is the
  // exact trap `afl-draft-slot.ts` documents, and the first version of this
  // test walked straight into it.
  const AFL = 'data/afl-fantasy';
  const YEAR = 2026;
  const AL = new Set(
    Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(4, '0'))
  );
  const NL = new Set(
    Array.from({ length: 12 }, (_, i) => String(i + 13).padStart(4, '0'))
  );

  it('resolves each conference independently', () => {
    const al = loadConferenceKeepers(AFL, YEAR, AL, new Set());
    const nl = loadConferenceKeepers(AFL, YEAR, NL, new Set());
    expect(al.size).toBeGreaterThan(0);
    expect(nl.size).toBeGreaterThan(0);
    // Two conferences, two answers. Identical sets would mean the franchise
    // filter is not being applied at all.
    expect([...al].sort()).not.toEqual([...nl].sort());
  });

  it('does NOT let one conference\u2019s keeper leave the other\u2019s board', () => {
    // `duplicatePlayers` is on for the AFL: the same NFL player can be held in
    // both conferences at once. Pooling the two keeper sets would delete every
    // NL keeper from the AL's draftable pool — players wrongly gone from a
    // board they belong on. Asserting the AL set contains no NL-only franchise
    // player is the shape-level version of that guarantee.
    const al = loadConferenceKeepers(AFL, YEAR, AL, new Set());
    const both = loadConferenceKeepers(AFL, YEAR, new Set([...AL, ...NL]), new Set());
    // Pooling strictly grows the set; if it didn't, scoping is a no-op.
    expect(both.size).toBeGreaterThan(al.size);
  });

  it('excludes players already taken on the board', () => {
    const all = loadConferenceKeepers(AFL, YEAR, AL, new Set());
    const someKeeper = [...all][0];
    // MFL adds each pick to the drafting franchise's roster as it lands, so a
    // plain roster read mid-draft would count fresh picks as keepers and shrink
    // the pool under the board.
    const afterDraft = loadConferenceKeepers(AFL, YEAR, AL, new Set([someKeeper]));
    expect(afterDraft.has(someKeeper)).toBe(false);
    expect(afterDraft.size).toBe(all.size - 1);
  });

  it('returns an empty set for an unknown league path', () => {
    expect(loadConferenceKeepers('data/nope', YEAR, AL, new Set()).size).toBe(0);
  });
});

describe('findOnTheClock', () => {
  it('returns the first EMPTY slot, not one past the last filled', () => {
    // MFL lets a commissioner fill a slot out of order. Taking "last filled + 1"
    // would skip whoever is actually still on the clock.
    const board = [slot(1, 'a'), slot(2), slot(3, 'c'), slot(4)];
    expect(findOnTheClock(board)?.overallPickNumber).toBe(2);
  });

  it('returns null on a complete board', () => {
    expect(findOnTheClock([slot(1, 'a'), slot(2, 'b')])).toBeNull();
  });
});

describe('recentPicks / upcomingPicks', () => {
  const board = [slot(1, 'a'), slot(2, 'b'), slot(3, 'c'), slot(4), slot(5), slot(6), slot(7)];

  it('lists the newest selections first', () => {
    expect(recentPicks(board, 2).map((p) => p.overallPickNumber)).toEqual([3, 2]);
  });

  it('lists the slots after the one on the clock', () => {
    // On the clock is 4, so "up next" starts at 5.
    expect(upcomingPicks(board, 2).map((p) => p.overallPickNumber)).toEqual([5, 6]);
  });

  it('returns nothing upcoming when the board is complete', () => {
    expect(upcomingPicks([slot(1, 'a')], 3)).toEqual([]);
  });
});

describe('positionRunCount', () => {
  const players = new Map<string, BroadcastPlayer>([
    ['a', player('a', 'RB')],
    ['b', player('b', 'WR')],
    ['c', player('c', 'RB')],
    ['d', player('d', 'RB')],
  ]);

  it('counts the position within the window, including the pick just made', () => {
    const board = [slot(1, 'a'), slot(2, 'b'), slot(3, 'c'), slot(4, 'd')];
    expect(positionRunCount(board, players, 4, 'RB', 8)).toBe(3);
  });

  it('ignores picks outside the window', () => {
    const board = [slot(1, 'a'), slot(20, 'c'), slot(21, 'd')];
    expect(positionRunCount(board, players, 21, 'RB', 8)).toBe(2);
  });

  it('never counts picks that come after the one being revealed', () => {
    // A reveal replayed from the queue must not narrate the future.
    const board = [slot(1, 'a'), slot(2, 'c'), slot(3, 'd')];
    expect(positionRunCount(board, players, 1, 'RB', 8)).toBe(1);
  });

  it('returns 0 for an unknown position', () => {
    expect(positionRunCount([slot(1, 'a')], players, 1, '', 8)).toBe(0);
  });
});

describe('applyRehearsal', () => {
  it('keeps picks up to N and empties the rest, preserving slot identity', () => {
    const board = [slot(1, 'a', '0001'), slot(2, 'b', '0002'), slot(3, 'c', '0003')];
    const rehearsed = applyRehearsal(board, 2);

    expect(rehearsed.map((p) => p.playerId)).toEqual(['a', 'b', '']);
    // The emptied slot must keep its franchise, or the board forgets who is
    // on the clock — which is the entire point of rehearsing.
    expect(rehearsed[2].franchiseId).toBe('0003');
    expect(rehearsed[2].overallPickNumber).toBe(3);
  });

  it('empties the whole board at 0', () => {
    const rehearsed = applyRehearsal([slot(1, 'a'), slot(2, 'b')], 0);
    expect(rehearsed.every((p) => p.playerId === '')).toBe(true);
  });
});


describe('findRehearsalYear', () => {
  // The rehearsal link is the one control on this page that can dead-end:
  // pointed at a season with no board it drops the operator onto a broadcast
  // that never reveals anything, which looks exactly like the page being
  // broken. So it resolves off the real feeds, and only ever returns a season
  // it has confirmed is complete.
  const AFL = 'data/afl-fantasy';

  it('skips the current (empty) season and lands on a completed one', () => {
    // 2026's board exists but is all-empty until draft night — the whole
    // reason a rehearsal mode exists at all.
    const year = findRehearsalYear(AFL, 2026, 'CONFERENCE00');
    expect(year).toBeDefined();
    expect(year).toBeLessThan(2026);
  });

  it('returns a board that is genuinely complete, not merely present', () => {
    const year = findRehearsalYear(AFL, 2026, 'CONFERENCE00')!;
    const { picks } = buildConferenceBoard(
      JSON.parse(
        readFileSync(`${AFL}/mfl-feeds/${year}/draftResults.json`, 'utf-8')
      ),
      'CONFERENCE00'
    );
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((p) => p.playerId)).toBe(true);
  });

  it('resolves per conference — a finished AL board does not vouch for the NL', () => {
    // duplicatePlayers lets the two conferences draft independently, and in
    // 2025 they ran on different DAYS. Each board answers for itself.
    for (const unit of ['CONFERENCE00', 'CONFERENCE01']) {
      const year = findRehearsalYear(AFL, 2026, unit);
      expect(year, unit).toBeDefined();
    }
  });

  it('returns undefined for an unknown unit rather than a wrong board', () => {
    expect(findRehearsalYear(AFL, 2026, 'CONFERENCE99')).toBeUndefined();
  });

  it('returns undefined when the data path has no feeds at all', () => {
    expect(findRehearsalYear('data/nope', 2026, 'CONFERENCE00')).toBeUndefined();
  });
});


describe('darkenForWhiteText', () => {
  // The reveal card paints white copy straight onto franchise brand colours,
  // and nine of the AFL's 24 franchises have a gradient stop white cannot be
  // read against — six of them the near-white #e9e9e9. On a laptop that is a
  // squint; on the TV it is an unreadable card in front of the whole league.
  const AFL = 'data/afl-fantasy/afl.config.json';

  it('leaves a colour that already passes completely alone', () => {
    for (const dark of ['#181818', '#002244', '#1c497c']) {
      expect(darkenForWhiteText(dark)).toBe(dark);
    }
  });

  it('darkens every failing colour to at least the 4.5 floor', () => {
    for (const light of ['#e9e9e9', '#ffcd00', '#e8aea6', '#ffffff']) {
      expect(contrastWithWhite(darkenForWhiteText(light))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('holds the floor for EVERY stop of EVERY AFL franchise', () => {
    // The real registry, not a fixture: the invariant is about this league's
    // actual brand colours, and a new franchise must not be able to ship a
    // stop the board cannot render text on.
    const cfg = JSON.parse(readFileSync(AFL, 'utf-8'));
    for (const t of cfg.teams) {
      for (const key of ['colorPrimary', 'colorSecondary']) {
        if (!t[key]) continue;
        const ratio = contrastWithWhite(darkenForWhiteText(t[key]));
        expect(ratio, `${t.nameMedium || t.name} ${key} ${t[key]}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the hue rather than washing to grey', () => {
    // Scaling toward black preserves the channel ratios, so a light pink stays
    // pink. Mixing in grey instead would hand the league a set of muddy cards.
    const out = darkenForWhiteText('#e8aea6');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThanOrEqual(b);
  });

  it('scores an unparseable colour as FAILING, so the guards can catch it', () => {
    // Returning the floor value here read as "passes" to every caller, so a
    // typo'd or non-hex brand colour sailed through all three league-wide
    // guards and reached the card untouched.
    for (const junk of ['#e9e9e9ff', 'rgb(233,233,233)', 'rebeccapurple', '']) {
      expect(contrastWithWhite(junk)).toBe(0);
    }
  });

  it('returns a malformed colour untouched instead of throwing', () => {
    // Draft night is the wrong time to discover a typo'd brand colour crashes
    // the reveal — degrade to today's behaviour.
    for (const junk of ['', 'rebeccapurple', '#12', 'not-a-color']) {
      expect(darkenForWhiteText(junk)).toBe(junk);
    }
  });
});


describe('toBroadcastColor', () => {
  // A TV across a lit room eats subtlety: accurate-but-flat brand colours read
  // washed out, and light ones make the copy unreadable. Saturate, then floor.
  const hsl = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const s = mx === mn ? 0 : l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
    return { s, l };
  };

  it('holds the contrast floor for every AFL brand stop', () => {
    const cfg = JSON.parse(readFileSync('data/afl-fantasy/afl.config.json', 'utf-8'));
    for (const t of cfg.teams) {
      for (const key of ['colorPrimary', 'colorSecondary']) {
        if (!t[key]) continue;
        expect(
          contrastWithWhite(toBroadcastColor(t[key])),
          `${t.nameMedium || t.name} ${key}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('comes out MORE saturated, not just darker', () => {
    // The whole point of the boost. Darkening alone costs saturation, which is
    // why the boost is applied first.
    for (const brand of ['#429b3f', '#42a349', '#529fcc']) {
      expect(hsl(toBroadcastColor(brand)).s).toBeGreaterThan(hsl(brand).s);
    }
  });

  it('leaves a greyscale brand grey instead of inventing a hue', () => {
    const out = toBroadcastColor('#e9e9e9');
    expect(hsl(out).s).toBe(0);
    expect(contrastWithWhite(out)).toBeGreaterThanOrEqual(4.5);
  });

  it('passes a malformed colour through untouched', () => {
    expect(toBroadcastColor('not-a-color')).toBe('not-a-color');
  });
});


describe('AFL franchise crest art', () => {
  // The broadcast crest renders at ~52vh — roughly 560px on a 1080p TV — so
  // the 100x100 `icon` files upscale more than 5x and visibly pixelate across
  // a room. draft-broadcast.astro prefers groupMeDark -> groupMe -> icon; this
  // pins that the preferred art actually EXISTS, because a 404 here degrades
  // silently to no crest at all rather than to the small one.
  const cfg = JSON.parse(readFileSync('data/afl-fantasy/afl.config.json', 'utf-8'));

  it('points every declared crest path at a real file', () => {
    for (const t of cfg.teams) {
      for (const key of ['icon', 'iconDark', 'groupMe', 'groupMeDark']) {
        if (!t[key]) continue;
        expect(
          existsSync(`public${t[key]}`),
          `${t.nameMedium || t.name} ${key} -> ${t[key]}`
        ).toBe(true);
      }
    }
  });

  it('gives every franchise crest art bigger than the 100px icon', () => {
    // Not a nice-to-have: this is the difference between a crisp crest and a
    // pixelated one on the only screen this page is built for.
    for (const t of cfg.teams) {
      expect(t.groupMe || t.groupMeDark, `${t.nameMedium || t.name} has no group-me art`)
        .toBeTruthy();
    }
  });

  it('never declares a dark cut that does not exist on disk', () => {
    // The resolution order falls back groupMeDark -> groupMe, so a declared but
    // missing dark path is strictly worse than not declaring one.
    for (const t of cfg.teams) {
      if (!t.groupMeDark) continue;
      expect(existsSync(`public${t.groupMeDark}`), `${t.name} groupMeDark`).toBe(true);
    }
  });
});


describe('toBroadcastPair', () => {
  // Six AFL franchises pair a real brand colour with the near-white #e9e9e9.
  // Resolved stop-by-stop that grey has no hue to keep, so it can only darken
  // to grey — Suh Girls' warm brown faded into a dead slate halfway across the
  // card. The pair lets a grey borrow the hue of the stop that has one.
  const sat = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    return mx === mn ? 0 : l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
  };
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (mx === mn) return 0;
    const d = mx - mn;
    const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return h / 6;
  };

  it('tints a greyscale stop with the partner stop hue', () => {
    // Suh Girls: brown -> near-white must come out brown -> brown.
    const out = toBroadcastPair('#b97c46', '#e9e9e9');
    expect(sat(out.secondary)).toBeGreaterThan(0.3);
    expect(Math.abs(hue(out.secondary) - hue(out.primary))).toBeLessThan(0.06);
  });

  it('borrows from the SECOND stop when the first is the grey one', () => {
    // Avenging Amish lead with #e9e9e9 and carry their blue second.
    const out = toBroadcastPair('#e9e9e9', '#529fcc');
    expect(sat(out.primary)).toBeGreaterThan(0.3);
    expect(Math.abs(hue(out.primary) - hue(out.secondary))).toBeLessThan(0.06);
  });

  it('preserves a near-BLACK stop instead of repainting it in the partner hue', () => {
    // Ten franchises pair a colour with #181818. Black is greyscale, so a
    // saturation-only grey test tinted it: Vitside Mafia's black half came out
    // red and the card flattened to colour-on-colour. Black already passes the
    // floor, so it needs no rescuing.
    for (const [p, sec] of [['#181818', '#aa322b'], ['#2b972b', '#181818'], ['#ffcd00', '#181818']]) {
      const out = toBroadcastPair(p, sec);
      expect(p === '#181818' ? out.primary : out.secondary).toBe('#181818');
    }
  });

  it('leaves a genuinely greyscale franchise grey', () => {
    // Titsburgh are grey on both stops — that IS the brand, so there is no hue
    // to borrow and inventing one would be worse than leaving it.
    const out = toBroadcastPair('#8b8f93', '#181818');
    expect(sat(out.primary)).toBeLessThan(0.12);
    expect(sat(out.secondary)).toBeLessThan(0.12);
  });

  it('still holds the contrast floor on both stops, league-wide', () => {
    const cfg = JSON.parse(readFileSync('data/afl-fantasy/afl.config.json', 'utf-8'));
    for (const t of cfg.teams) {
      const out = toBroadcastPair(t.colorPrimary, t.colorSecondary || t.colorPrimary);
      for (const k of ['primary', 'secondary'] as const) {
        expect(
          contrastWithWhite(out[k]),
          `${t.nameMedium || t.name} ${k}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});


describe('idle screen and reveal card share one colour treatment', () => {
  // The idle board is on screen between every pick and hands straight off to a
  // reveal. It used to paint RAW brand colours while the reveal painted treated
  // ones, so a light franchise flashed washed-out, then deep and saturated a
  // second later. Both call toBroadcastPair now; this pins that neither can
  // quietly go back to reading colorPrimary/colorSecondary directly.
  const read = (f: string) => readFileSync(`src/components/afl/draft-broadcast/${f}`, 'utf-8');

  /** Source with comments removed — the first version of this guard matched
   *  `toBroadcastPair` in the explanatory comment sitting directly above the
   *  call, so deleting the call itself kept the suite green. */
  const code = (f: string) =>
    read(f)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');

  it('both components CALL toBroadcastPair, not merely mention it', () => {
    for (const f of ['OnTheClock.tsx', 'BroadcastRevealCard.tsx']) {
      expect(code(f), `${f} must call toBroadcastPair(...)`).toMatch(
        /toBroadcastPair\s*\(/
      );
    }
  });

  it('neither component reads a raw brand colour for its background', () => {
    // The original bug was a local `const primary = team?.colorPrimary || …`
    // feeding the CSS variable, which a rule keyed on the variable name alone
    // would not have caught. Ban the raw property read outright instead.
    for (const f of ['OnTheClock.tsx', 'BroadcastRevealCard.tsx']) {
      expect(
        /team[?.]*\.color(Primary|Secondary)/.test(code(f)),
        `${f} reads team.color* directly — go through resolveSplashColors + toBroadcastPair`
      ).toBe(false);
    }
  });

  // Matching the COLOURS was not enough. Both screens ran the same pair through
  // the same treatment and still disagreed, because each COMPOSED that pair its
  // own way — the reveal at 115/315deg, the idle board at 150deg with reversed
  // stops and a stop running off the canvas at 130%. Midwestside is what proved
  // it: a gold-dominant idle screen handing off to a near-black reveal, twice a
  // minute, for the same franchise. Both surfaces now paint the franchise's one
  // `broadcastGradient` string (Brandon, 2026-08-28).
  it('both components resolve the franchise gradient', () => {
    for (const f of ['OnTheClock.tsx', 'BroadcastRevealCard.tsx']) {
      expect(code(f), `${f} must call resolveBroadcastGradient(...)`).toMatch(
        /resolveBroadcastGradient\s*\(/
      );
    }
  });

  it('both components hand it to the SAME custom property', () => {
    // Two different variable names would type-check, pass every unit test, and
    // silently give the two screens separate paint paths again.
    //
    // Quote-agnostic on purpose (Copilot, #641): pinning the single quotes would
    // fail on a formatter run that flipped them, which is a non-behavioural
    // change. The property NAME is the thing being guarded.
    for (const f of ['OnTheClock.tsx', 'BroadcastRevealCard.tsx']) {
      expect(code(f), `${f} must set --dbc-gradient`).toMatch(/['"`]--dbc-gradient['"`]/);
    }
  });

  it('both surfaces READ that property, with the derived pair as fallback', () => {
    const css = readFileSync('src/styles/draft-broadcast.css', 'utf-8');
    for (const sel of ['.dbc-idle', '.dbc-reveal']) {
      // Anchored to column 0 with `m`: the TOP-LEVEL rule, not one of the
      // indented `.dbc-idle { height: 100vh }` overrides inside a media query,
      // which is what an unanchored match found first.
      const block =
        new RegExp(`^\\${sel} \\{[\\s\\S]*?\\n\\}`, 'm').exec(css)?.[0] ?? '';
      expect(block, `${sel} rule not found`).not.toBe('');
      expect(block, `${sel} must paint var(--dbc-gradient, …)`).toMatch(
        /background:\s*var\(\s*--dbc-gradient,/
      );
      // The fallback has to stay a real gradient, or a franchise without one
      // (or a board with no team at all) renders with no background.
      expect(block, `${sel} must keep a gradient fallback`).toMatch(/linear-gradient\(/);
    }
  });
});

describe('exit-full-screen chip hides on hover-capable devices only', () => {
  // On a laptop driving the TV the chip should vanish once the board is
  // fullscreen and come back on hover. On a touchscreen there IS no hover to
  // bring it back, so hiding it there strands the viewer in fullscreen with no
  // way out but the OS. The whole rule therefore has to sit inside a
  // `hover: hover` query, and the component has to emit the attribute it keys
  // on — either half missing ships one of those two failures.
  const css = readFileSync('src/styles/draft-broadcast.css', 'utf-8');
  const tsx = readFileSync(
    'src/components/afl/draft-broadcast/DraftBroadcast.tsx',
    'utf-8'
  );

  it('the component marks the button with data-in-fullscreen', () => {
    expect(tsx).toMatch(/data-in-fullscreen=\{/);
  });

  it('every rule that hides the chip sits inside a hover-capable query', () => {
    // Slice the file into the @media blocks and the top level outside them, so
    // a hiding rule added at the top level (where a touchscreen would read it)
    // is what fails this.
    const hoverBlocks: string[] = [];
    let outside = '';
    let i = 0;
    while (i < css.length) {
      const at = css.indexOf('@media', i);
      if (at === -1) {
        outside += css.slice(i);
        break;
      }
      outside += css.slice(i, at);
      const open = css.indexOf('{', at);
      let depth = 0;
      let j = open;
      for (; j < css.length; j += 1) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const block = css.slice(at, j + 1);
      if (/hover:\s*hover/.test(block)) hoverBlocks.push(block);
      else outside += block;
      i = j + 1;
    }

    const hides = /\[data-in-fullscreen=['"]true['"]\][^{]*\{[^}]*opacity:\s*0\s*[;}]/;
    expect(
      hides.test(outside),
      'a touchscreen would read this rule and lose its only way out of fullscreen'
    ).toBe(false);
    expect(
      hoverBlocks.some((b) => hides.test(b)),
      'nothing hides the chip on a hover-capable device — the ask was hover-only there'
    ).toBe(true);
  });

  it('hover and keyboard focus both bring it back', () => {
    const revealed = css.match(
      /\[data-in-fullscreen=['"]true['"]\]:(hover|focus-visible)/g
    );
    expect(revealed).toContain("[data-in-fullscreen='true']:hover");
    expect(revealed).toContain("[data-in-fullscreen='true']:focus-visible");
  });
});
