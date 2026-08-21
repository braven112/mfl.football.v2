import { describe, it, expect } from 'vitest';
import {
  isAflDraftWindowOpen,
  pickTitleSpotlight,
  resolveAflDraftSpotlight,
  resolveAflTitleSpotlight,
  resolveAflStreakSpotlight,
  resolveAflRecordSpotlight,
  resolveAflTeamSpotlight,
  type AflDraftSlot,
  type TitleTrophy,
} from '../src/utils/afl-team-spotlight';
import { getFranchiseTrophyCase } from '../src/utils/afl-awards';
import aflConfig from '../data/afl-fantasy/afl.config.json';

/**
 * The AFL homepage's offseason "spotlight" tile — the slot that used to be
 * "Keepers — X of 7 protected" and rendered `—` for every owner, forever.
 *
 * What these lock down, in order of how easy each is to break:
 *
 *   1. The tier chain never returns nothing. That was the original bug: a tile
 *      whose only source could not produce a value had no fallback, so it just
 *      showed a dash. `resolveAflRecordSpotlight` is total and every path ends
 *      there.
 *   2. "Best" and "most recent" title are BOTH surfaced. They disagree for 12
 *      of the 24 franchises, so a resolver that silently picks one is wrong for
 *      half the league and looks right on whichever team you spot-checked.
 *   3. The streak tier never renders a drought. Every franchise that currently
 *      reaches that tier is on one (the Micks have not made it since 2006);
 *      rendering it would put a misery counter on their own homepage.
 *   4. The draft asterisk fires on a MOVED round-1 pick and not on a missing
 *      board. "No board published yet" and "board says you kept your pick" are
 *      different states and must not collapse.
 *
 * Title-tier behaviour is pinned through `pickTitleSpotlight` with fixtures,
 * NOT against live awards: `awards-history.json` gains a season every January,
 * so an assertion that Smokane's last title is the 2025 AL North fails on the
 * season rolling over rather than on a bug. Assertions that do read live data
 * derive their expectation from that data instead of hardcoding it.
 */

const trophy = (slug: string, year: number, label: string): TitleTrophy =>
  ({ slug, year, label }) as TitleTrophy;

const slot = (over: Partial<AflDraftSlot> = {}): AflDraftSlot => ({
  basePick: 10,
  heldPicks: [10],
  conferenceShort: 'AL',
  draftYear: 2026,
  ...over,
});

describe('isAflDraftWindowOpen', () => {
  it('opens when the AFL league year names the draft year and the board is unfinished', () => {
    expect(
      isAflDraftWindowOpen({
        aflLeagueYear: 2026,
        calendarYear: 2026,
        conferenceDraftComplete: false,
      })
    ).toBe(true);
  });

  it('closes once this conference has finished drafting', () => {
    expect(
      isAflDraftWindowOpen({
        aflLeagueYear: 2026,
        calendarYear: 2026,
        conferenceDraftComplete: true,
      })
    ).toBe(false);
  });

  it('stays closed before the June 1 rollover, when the league year is still last season', () => {
    // Jan-May 2026: getAflLeagueYear() still returns 2025. The floor is checked
    // against the calendar, NOT inferred from last year's board being finished
    // — a missing prior board would otherwise leave a stale slot up all winter,
    // which is why `conferenceDraftComplete` is false here and it still closes.
    expect(
      isAflDraftWindowOpen({
        aflLeagueYear: 2025,
        calendarYear: 2026,
        conferenceDraftComplete: false,
      })
    ).toBe(false);
  });
});

describe('resolveAflDraftSpotlight', () => {
  it('shows the earned slot with no asterisk when the board agrees', () => {
    const s = resolveAflDraftSpotlight(slot());
    expect(s.kind).toBe('draft');
    expect(s.value).toBe('1.10');
    expect(s.sub).toBe('AL · 2026');
  });

  it('does not asterisk when the board has not been published yet', () => {
    // null heldPicks is "no board", which must not read as "traded away".
    const s = resolveAflDraftSpotlight(slot({ heldPicks: null }));
    expect(s.value).toBe('1.10');
  });

  it('asterisks the base slot and names the real pick when a trade moved it', () => {
    const s = resolveAflDraftSpotlight(slot({ heldPicks: [3] }));
    expect(s.value).toBe('1.10*');
    expect(s.sub).toBe('traded · now 1.03');
    expect(s.hint).toContain('1.03');
  });

  it('handles a franchise holding two round-1 picks', () => {
    const s = resolveAflDraftSpotlight(slot({ heldPicks: [3, 10] }));
    expect(s.value).toBe('1.10*');
    expect(s.sub).toBe('traded · now 1.03, 1.10');
  });

  it('says so when the franchise traded out of round 1 entirely', () => {
    const s = resolveAflDraftSpotlight(slot({ heldPicks: [] }));
    expect(s.value).toBe('1.10*');
    expect(s.sub).toBe('traded away');
  });
});

describe('pickTitleSpotlight', () => {
  it('headlines the most recent title and appends the best when they differ', () => {
    // Smokane's real shape as of 2025: newest is a division title, best is a
    // championship a decade older. Both have to survive onto the tile.
    const s = pickTitleSpotlight(
      [
        trophy('al-north', 2025, 'AL North'),
        trophy('afl-championship', 2013, 'AFL Champion'),
      ],
      '0001'
    );
    expect(s).not.toBeNull();
    expect(s!.kind).toBe('title');
    expect(s!.value).toBe('2025');
    expect(s!.sub).toBe("AL North · AFL '13");
    expect(s!.hint).toContain('2013');
  });

  it('collapses to one line when the most recent title IS the best', () => {
    const s = pickTitleSpotlight(
      [
        trophy('afl-championship', 2025, 'AFL Champion'),
        trophy('nl-east', 2019, 'NL East'),
      ],
      '0015'
    );
    expect(s!.value).toBe('2025');
    expect(s!.sub).toBe('AFL Champion');
  });

  it('ranks by the league order, not by recency, for the "best" half', () => {
    const s = pickTitleSpotlight(
      [
        trophy('nit', 2025, 'NIT Champion'),
        trophy('premier-league', 2020, 'Premier League'),
        trophy('al-south', 2024, 'AL South'),
      ],
      '0008'
    );
    // Newest is the 2025 NIT; best is the Premier League, which outranks both
    // the division and consolation titles regardless of being older.
    expect(s!.value).toBe('2025');
    expect(s!.sub).toBe("NIT · Premier '20");
  });

  it('breaks a same-year tie toward the better trophy', () => {
    const s = pickTitleSpotlight(
      [
        trophy('al-north', 2025, 'AL North'),
        trophy('afl-championship', 2025, 'AFL Champion'),
      ],
      '0001'
    );
    expect(s!.sub).toBe('AFL Champion');
  });

  it('shortens BOTH halves when the line carries two trophies', () => {
    // "NIT Champion · D-League '18" wraps the tile to two lines; "NIT" alone
    // does not. The solo case keeps the long label — see the sibling test.
    const s = pickTitleSpotlight(
      [
        trophy('nit', 2021, 'NIT Champion'),
        trophy('dleague-champion', 2018, 'D-League Champion'),
      ],
      '0003'
    );
    expect(s!.sub).toBe("NIT · D-League '18");
    expect(s!.sub.length).toBeLessThanOrEqual(25);
  });

  it('keeps the full label when there is only one trophy to show', () => {
    const s = pickTitleSpotlight([trophy('nit', 2016, 'NIT Champion')], '0019');
    expect(s!.sub).toBe('NIT Champion');
  });

  it('ignores undated trophies and returns null when none remain', () => {
    expect(pickTitleSpotlight([], '0013')).toBeNull();
    expect(
      pickTitleSpotlight([{ slug: 'nit', label: 'NIT Champion' } as TitleTrophy], '0013')
    ).toBeNull();
  });
});

describe('resolveAflTitleSpotlight (live awards)', () => {
  it('agrees with the pure picker for every franchise', () => {
    // Wires the real trophy case in without pinning any franchise's result.
    // NOTE the source: `getFranchiseTrophyCase` routes award years through
    // `attributeAwardYear`, so a franchise inherits its predecessors' hardware.
    // A raw scan of awards-history by franchiseId gives a DIFFERENT, wrong
    // answer — see insights/features/afl-team-rename.md.
    for (const team of aflConfig.teams) {
      const trophies = getFranchiseTrophyCase(team.franchiseId);
      expect(resolveAflTitleSpotlight(team.franchiseId)).toEqual(
        pickTitleSpotlight(trophies, team.franchiseId)
      );
    }
  });

  it('renders a 4-digit year and a non-empty sub wherever it resolves', () => {
    for (const team of aflConfig.teams) {
      const s = resolveAflTitleSpotlight(team.franchiseId);
      if (!s) continue;
      expect(s.value, team.name).toMatch(/^\d{4}$/);
      expect(s.sub.length, team.name).toBeGreaterThan(0);
      expect(s.sub.length, `${team.name} sub wraps the tile`).toBeLessThanOrEqual(28);
    }
  });
});

describe('resolveAflStreakSpotlight', () => {
  it('counts an active streak back to its first season', () => {
    const s = resolveAflStreakSpotlight([
      { year: 2025, playoffResult: 'playoffs' },
      { year: 2024, playoffResult: 'playoffs' },
      { year: 2023, playoffResult: 'missed' },
    ]);
    expect(s!.kind).toBe('streak');
    expect(s!.value).toBe('2');
    expect(s!.hint).toContain('2024');
  });

  it('singularizes a one-season streak', () => {
    const s = resolveAflStreakSpotlight([
      { year: 2025, playoffResult: 'playoffs' },
      { year: 2024, playoffResult: 'missed' },
    ]);
    expect(s!.sub).toBe('straight season');
  });

  it('never renders a drought', () => {
    // The whole point of this tier's rule: a team that missed last season gets
    // nothing here, not a "16 years since" counter.
    expect(
      resolveAflStreakSpotlight([
        { year: 2025, playoffResult: 'missed' },
        { year: 2024, playoffResult: 'playoffs' },
      ])
    ).toBeNull();
  });

  it('returns null with no seasons at all', () => {
    expect(resolveAflStreakSpotlight([])).toBeNull();
  });
});

describe('resolveAflRecordSpotlight', () => {
  it('formats a record without ties', () => {
    const s = resolveAflRecordSpotlight('0013', {
      wins: 78,
      losses: 72,
      ties: 0,
      firstYear: 2005,
    });
    expect(s.value).toBe('78-72');
    expect(s.sub).toBe('since 2005');
  });

  it('includes ties when there are any', () => {
    const s = resolveAflRecordSpotlight('0013', {
      wins: 10,
      losses: 8,
      ties: 1,
      firstYear: 2020,
    });
    expect(s.value).toBe('10-8-1');
  });

  it('never renders a dash for a franchise with no games — the chain must be total', () => {
    // The regression this whole tile exists to kill. An expansion franchise
    // has no entry in the career stats at all, and `—` here would put the dead
    // keeper tile straight back on the newest owner's homepage.
    const s = resolveAflRecordSpotlight('9999', undefined);
    expect(s.kind).toBe('record');
    expect(s.value).toBe('0-0');
    expect(s.value).not.toBe('—');
    expect(s.sub).toBe('first season');
  });
});

describe('resolveAflTeamSpotlight (tier chain)', () => {
  it('prefers the draft slot over everything when the window is open', async () => {
    // 0015 has a 2025 AFL Championship and still shows the draft slot: the
    // draft is the timely fact in June-August.
    const s = await resolveAflTeamSpotlight({
      franchiseId: '0015',
      draftSlot: slot(),
    });
    expect(s.kind).toBe('draft');
  });

  it('falls to the title tier once the draft window closes', async () => {
    const s = await resolveAflTeamSpotlight({ franchiseId: '0015' });
    expect(s.kind).toBe('title');
  });

  it('falls past titles and a drought to the all-time record', async () => {
    // Found at runtime, not hardcoded: a franchise pinned as "has no hardware"
    // stops being one the season it finally wins something.
    const trophyless = aflConfig.teams.find(
      (t) => !resolveAflTitleSpotlight(t.franchiseId)
    );
    if (!trophyless) {
      console.info('[afl-team-spotlight] every franchise now owns a trophy — fallthrough untested');
      return;
    }
    const s = await resolveAflTeamSpotlight({ franchiseId: trophyless.franchiseId });
    // Streak or record depending on last season; never the title tier, and
    // never a drought counter.
    expect(['streak', 'record'], trophyless.name).toContain(s.kind);
    if (s.kind === 'record') expect(s.value).toMatch(/^\d+-\d+/);
  });

  it('always resolves a tile for every current franchise', async () => {
    // The regression that started this: a tile with no fallback rendering '—'.
    for (const team of aflConfig.teams) {
      const s = await resolveAflTeamSpotlight({ franchiseId: team.franchiseId });
      expect(s.value, `${team.name} rendered an empty spotlight`).not.toBe('—');
      expect(s.sub.length, `${team.name} rendered an empty sub`).toBeGreaterThan(0);
    }
  });
});
