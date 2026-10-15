/**
 * The handheld board — the same Sunday, for a phone or tablet beside the owner.
 *
 * A second RENDERING of the island's poll, not a second board: the island
 * still owns the poll, the carry, the reveal queue and every timer, and hands
 * this component the results. Nothing here fetches, and nothing here decides
 * what earns a moment.
 *
 * It is a separate component with its own root class (`.lbh`) and its own
 * stylesheet (`live-broadcast-handheld.css`) on purpose. The TV board must not
 * change, and the only way to make that a fact rather than a hope is for the
 * handheld layout to share no selector with it:
 * `tests/broadcast-handheld-isolation.test.ts` fails on any `.lbh` rule in the
 * TV stylesheet and any rule in this one outside `.lbh`.
 *
 * What a phone does NOT inherit from the television, and why:
 *  - No full-screen takeover. A glance at a phone should never land on a
 *    fourteen-second animation; every moment is a slide-in banner.
 *  - No screensaver and no burn-in drift. A phone is not on for eight hours
 *    at one brightness, and a quiet board is still the owner's scores.
 *  - No hidden cursor or chrome. There is no cursor, and this screen is
 *    touched.
 *
 * Tap a matchup and a sheet opens over the cards with both STARTING lineups
 * (never bench: `scoreLeague` sends starters only). Tap a player in it for a
 * small card with that player's points and projection. The open sheet is keyed by league
 * and matchup index (`matchupKey`), so a poll never closes it or swaps it for
 * another game. While it is open a moment banner sits inside its header rather
 * than over the lineups.
 *
 * Everything else is props, so it renders under `renderToString` in tests.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type {
  BroadcastLeaguePanel,
  BroadcastLeagueScore,
  BroadcastTeam,
} from '../../../types/live-broadcast';
import type { NflGame, PlayerMeta } from '../../../types/live-scoring';
import type { BroadcastMoment, RedZoneAlert } from '../../../utils/broadcast-moments';
import { matchupTimeLeft } from '../../../utils/broadcast-layout';
import { crestStrokeProps } from '../../../utils/draft-broadcast';
import { handheldLineup, matchupKey, type HandheldPlayer } from '../../../utils/broadcast-handheld';
import { BroadcastFace } from '../draft-broadcast/BroadcastFace';

interface Props {
  week: number;
  /** Every enabled league — the handheld has no featured / compact split. */
  panels: readonly BroadcastLeaguePanel[];
  scores: Record<string, BroadcastLeagueScore>;
  games: readonly NflGame[];
  meta: Record<string, PlayerMeta>;
  /** Is any game being played right now? */
  live: boolean;
  /** The moment the queue is showing, or null. Rendered as a banner. */
  moment: BroadcastMoment | null;
  /** The franchise the moment belongs to, for its colours and crest. */
  momentTeam: BroadcastTeam | null;
  /** "84.2 – 79.8" — what the play did to the matchup. */
  momentScoreLine: string;
  redZone: readonly RedZoneAlert[];
  /** The freshness line, or '' when the scores are current. */
  statusText: string;
  statusError: boolean;
  demoText?: string;
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');
/** A number, or an em-dash when this league's feed could not be read. */
const score = (n: number | undefined, ok: boolean) => (ok ? fmt(n ?? 0) : '—');
const pct = (n: number) => `${Math.round(n * 100)}%`;
const shortName = (t: BroadcastTeam) => t.nameShort || t.name;

/** How far a downward swipe on the sheet's header must travel to close it. */
const SWIPE_CLOSE_PX = 60;

function Crest({ team }: { team: BroadcastTeam }) {
  return (
    <span className="lbh__crest">
      {team.iconSmall && (
        <img {...crestStrokeProps('', team.iconSmallStroke, 'lbc')} src={team.iconSmall} alt="" />
      )}
    </span>
  );
}

function Banner({
  moment,
  team,
  scoreLine,
  inline,
}: {
  moment: BroadcastMoment;
  team: BroadcastTeam | null;
  scoreLine: string;
  /** Inside the open sheet, in the flow, so it never covers the lineups. */
  inline: boolean;
}) {
  return (
    <aside
      className={`lbh__banner${moment.side === 'mine' ? ' is-mine' : ' is-theirs'}${inline ? ' is-inline' : ''}`}
      style={team ? ({ ['--lbh-banner' as string]: team.primary } as Record<string, string>) : undefined}
      aria-hidden="true"
    >
      {team && <Crest team={team} />}
      <span className="lbh__banner-who">
        <span className="lbh__banner-kicker">
          {moment.side === 'mine' ? 'Your player' : 'Against you'} · {moment.leagueName}
        </span>
        <span className="lbh__banner-name">{moment.playerName}</span>
        <span className="lbh__banner-play">{moment.text}</span>
      </span>
      <span className="lbh__banner-end">
        {moment.scoreValue > 0 && <span className="lbh__banner-pts">{`+${moment.scoreValue}`}</span>}
        {scoreLine && <span className="lbh__banner-line">{scoreLine}</span>}
      </span>
    </aside>
  );
}

/** The open player, by side and id — enough to find the live row each poll. */
interface OpenPlayer {
  side: 'mine' | 'opponent';
  id: string;
}

function PlayerCard({
  player,
  side,
  onClose,
}: {
  player: HandheldPlayer;
  side: 'mine' | 'opponent';
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, [player.id]);
  const meta = [player.position, player.nflTeam].filter(Boolean).join(' · ');
  return (
    <div className={`lbh__pcard${side === 'opponent' ? ' is-theirs' : ''}`} role="group" aria-label={`${player.name}, ${meta}`}>
      <BroadcastFace
        player={{ id: player.id, mflId: player.id, position: player.position, nflTeam: player.nflTeam, headshot: player.headshot }}
        className="lbh__pcard-face"
      />
      <div className="lbh__pcard-who">
        <p className="lbh__pcard-name">{player.name}</p>
        <p className="lbh__pcard-meta">
          {meta}
          {meta ? ' · ' : ''}
          {player.clock}
        </p>
      </div>
      <dl className="lbh__pcard-stats">
        <div>
          <dt>Points</dt>
          <dd>{fmt(player.points)}</dd>
        </div>
        <div>
          <dt>Projected</dt>
          <dd>{player.projected === null ? '—' : fmt(player.points + (player.projectedLeft ?? 0))}</dd>
        </div>
        <div>
          <dt>Still to come</dt>
          <dd>{player.projectedLeft === null ? '—' : fmt(player.projectedLeft)}</dd>
        </div>
      </dl>
      <button ref={closeRef} type="button" className="lbh__pcard-close" onClick={onClose} aria-label="Close player card">
        ×
      </button>
    </div>
  );
}

function Lineup({
  team,
  total,
  players,
  side,
  openId,
  onOpen,
}: {
  team: BroadcastTeam;
  total: string;
  players: readonly HandheldPlayer[];
  side: 'mine' | 'opponent';
  openId: string | null;
  onOpen: (p: OpenPlayer) => void;
}) {
  return (
    <section className={`lbh__lineup${side === 'opponent' ? ' is-theirs' : ''}`} aria-label={`${team.name} starters`}>
      <header className="lbh__lineup-head">
        <Crest team={team} />
        <span className="lbh__tn">{shortName(team)}</span>
        <span className="lbh__lineup-total">{total}</span>
      </header>
      {players.length === 0 ? (
        <p className="lbh__note">No starters reported yet</p>
      ) : (
        <ul className="lbh__players">
          {players.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={`lbh__player${openId === p.id ? ' is-open' : ''}`}
                aria-pressed={openId === p.id}
                onClick={() => onOpen({ side, id: p.id })}
              >
                <span className="lbh__player-pos">{p.position}</span>
                <span className="lbh__player-who">
                  <span className="lbh__player-name">{p.name}</span>
                  <span className="lbh__player-clock">{p.clock}</span>
                </span>
                <span className="lbh__player-pts">{fmt(p.points)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HandheldBoard({
  week,
  panels,
  scores,
  games,
  meta,
  live,
  moment,
  momentTeam,
  momentScoreLine,
  redZone,
  statusText,
  statusError,
  demoText,
}: Props) {
  const redZoneNames = redZone.flatMap((a) =>
    a.players.map((p) => `${p.playerName}${p.side === 'opponent' ? ' (against you)' : ''}`),
  );
  const redZoneDd = redZone.find((a) => a.downDistance)?.downDistance ?? '';

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openPlayer, setOpenPlayer] = useState<OpenPlayer | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const swipeFrom = useRef<number | null>(null);

  // The open matchup, re-found on every render from live props. A sheet whose
  // matchup is gone (the owner changed leagues) simply is not drawn.
  const open = (() => {
    if (!openKey) return null;
    for (const panel of panels) {
      if (panel.status === 'unavailable') continue;
      for (const matchup of panel.matchups) {
        if (matchupKey(panel.leagueId, matchup.index) === openKey) return { panel, matchup };
      }
    }
    return null;
  })();

  const closeSheet = useCallback(() => {
    const key = openKey;
    setOpenPlayer(null);
    setOpenKey(null);
    // Hand focus back to the card that opened the sheet.
    if (key && typeof document !== 'undefined') {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`.lbh [data-matchup="${CSS.escape(key)}"]`)?.focus();
      });
    }
  }, [openKey]);

  const sheetOpen = open !== null;

  useEffect(() => {
    if (!sheetOpen) return;
    closeRef.current?.focus();
    // The cards underneath must not scroll while the sheet is up.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      // The player card first, then the sheet.
      if (openPlayer) setOpenPlayer(null);
      else closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [sheetOpen, openPlayer, closeSheet]);

  const lineupFor = (franchiseId: string | undefined, leagueId: string) => {
    const rows = franchiseId ? scores[leagueId]?.teams[franchiseId]?.players : undefined;
    return handheldLineup(rows ?? [], meta, games);
  };

  return (
    <main className="lbh" data-mode="handheld" aria-label="Live scoring broadcast">
      <header className="lbh__bar">
        <span className={`lbh__live${live ? ' is-live' : ''}`}>{live ? 'Live' : 'Not live'}</span>
        <span className="lbh__week">Week {week}</span>
        {statusText && (
          <span className={`lbh__status${statusError ? ' is-error' : ''}`}>{statusText}</span>
        )}
        {demoText && <span className="lbh__status">{demoText}</span>}
      </header>

      {redZone.length > 0 && (
        <p className="lbh__redzone" aria-hidden="true">
          <span className="lbh__redzone-tag">Red zone</span>
          <span className="lbh__redzone-who">{redZoneNames.join(' · ')}</span>
          {redZoneDd && <span className="lbh__redzone-dd">{redZoneDd}</span>}
        </p>
      )}

      <ul className="lbh__cards">
        {panels.map((panel) => {
          const leagueScore = scores[panel.leagueId];
          const readable = panel.status !== 'unavailable';

          if (panel.matchups.length === 0) {
            return (
              <li key={panel.leagueId} className="lbh__card is-empty">
                <p className="lbh__tag">{panel.leagueName}</p>
                <p className="lbh__note">
                  {panel.status === 'unavailable' ? 'Feed unavailable' : 'No matchup this week'}
                </p>
              </li>
            );
          }

          // Every matchup is its own card — a doubleheader league is two real
          // games against two different opponents, never `matchups[0]`.
          return panel.matchups.map((matchup) => {
            const mine = leagueScore?.teams[matchup.mine.franchiseId];
            const theirs = matchup.opponent
              ? leagueScore?.teams[matchup.opponent.franchiseId]
              : undefined;
            const wp = leagueScore?.winProbability[matchup.index] ?? 0.5;
            const mineLive = mine?.live ?? 0;
            const theirsLive = theirs?.live ?? 0;
            const clock = matchupTimeLeft(
              [...(mine?.players ?? []), ...(theirs?.players ?? [])],
              games,
              meta,
            );
            const doubleheader = panel.matchups.length > 1;
            const key = matchupKey(panel.leagueId, matchup.index);
            const summary = `${panel.leagueName}: ${matchup.mine.name} ${score(mineLive, readable)}${
              matchup.opponent
                ? `, ${matchup.opponent.name} ${score(theirsLive, readable)}.${readable ? ` Win probability ${pct(wp)}.` : ''}`
                : '. No opponent this week.'
            }${readable ? '' : ' This league’s feed could not be read.'}`;

            return (
              <li
                key={key}
                className={`lbh__card${readable ? ' is-tappable' : ' is-unavailable'}`}
                style={{
                  ['--lbh-mine' as string]: matchup.mine.swatch,
                  ['--lbh-theirs' as string]: matchup.opponent?.swatch ?? '#334155',
                }}
              >
                {/* The whole card is the button. Its text is the summary a
                    screen reader needs; the drawn card beside it is hidden
                    from one, so nothing is read twice. An unreadable feed has
                    no lineups to show, so it gets no button. */}
                {readable ? (
                  <button
                    type="button"
                    className="lbh__card-hit"
                    data-matchup={key}
                    aria-haspopup="dialog"
                    onClick={() => {
                      setOpenPlayer(null);
                      setOpenKey(key);
                    }}
                  >
                    <span className="visually-hidden">{`${summary} Show lineups.`}</span>
                  </button>
                ) : (
                  <p className="visually-hidden">{summary}</p>
                )}

                <div aria-hidden="true">
                  <p className="lbh__tag">
                    <span>
                      {panel.leagueName}
                      {doubleheader ? ` · Game ${matchup.index + 1}` : ''}
                    </span>
                    {clock && readable && <span className="lbh__clock">{clock}</span>}
                    {!readable && <span className="lbh__clock">Feed unavailable</span>}
                  </p>

                  <div className={`lbh__side is-mine${readable && mineLive >= theirsLive ? ' is-leading' : ''}`}>
                    <Crest team={matchup.mine} />
                    <span className="lbh__ident">
                      <span className="lbh__tn">{shortName(matchup.mine)}</span>
                      <span className="lbh__ytp">
                        {readable ? `${mine?.yetToPlay ?? 0} to play · Proj ${score(mine?.projectedFinal, readable)}` : ''}
                      </span>
                    </span>
                    <span className="lbh__score">{score(mineLive, readable)}</span>
                  </div>

                  {matchup.opponent && readable && (
                    <div className="lbh__wp">
                      <div className="lbh__wp-fill" style={{ width: pct(wp) }} />
                    </div>
                  )}

                  {matchup.opponent ? (
                    <div className={`lbh__side${readable && theirsLive > mineLive ? ' is-leading' : ''}`}>
                      <Crest team={matchup.opponent} />
                      <span className="lbh__ident">
                        <span className="lbh__tn">{shortName(matchup.opponent)}</span>
                        <span className="lbh__ytp">
                          {readable ? `${theirs?.yetToPlay ?? 0} to play · Proj ${score(theirs?.projectedFinal, readable)}` : ''}
                        </span>
                      </span>
                      <span className="lbh__score">{score(theirsLive, readable)}</span>
                    </div>
                  ) : (
                    <p className="lbh__note">Bye week</p>
                  )}

                  {matchup.opponent && readable && <p className="lbh__wp-label">{pct(wp)} win</p>}
                </div>
              </li>
            );
          });
        })}
      </ul>

      {open && (() => {
        const { panel, matchup } = open;
        const leagueScore = scores[panel.leagueId];
        const mineScore = leagueScore?.teams[matchup.mine.franchiseId];
        const theirScore = matchup.opponent ? leagueScore?.teams[matchup.opponent.franchiseId] : undefined;
        const mineLineup = lineupFor(matchup.mine.franchiseId, panel.leagueId);
        const theirLineup = matchup.opponent ? lineupFor(matchup.opponent.franchiseId, panel.leagueId) : [];
        const cardPlayer = openPlayer
          ? (openPlayer.side === 'mine' ? mineLineup : theirLineup).find((p) => p.id === openPlayer.id) ?? null
          : null;
        const title = `${panel.leagueName}${panel.matchups.length > 1 ? ` · Game ${matchup.index + 1}` : ''}`;
        return (
          <>
            <div className="lbh__backdrop" onClick={closeSheet} aria-hidden="true" />
            <section
              className="lbh__sheet"
              style={{
                ['--lbh-mine' as string]: matchup.mine.swatch,
                ['--lbh-theirs' as string]: matchup.opponent?.swatch ?? '#334155',
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="lbh-sheet-title"
            >
              <header
                className="lbh__sheet-head"
                onTouchStart={(e) => {
                  swipeFrom.current = e.touches[0]?.clientY ?? null;
                }}
                onTouchEnd={(e) => {
                  const from = swipeFrom.current;
                  swipeFrom.current = null;
                  const to = e.changedTouches[0]?.clientY;
                  if (from !== null && to !== undefined && to - from > SWIPE_CLOSE_PX) closeSheet();
                }}
              >
                <span className="lbh__grabber" aria-hidden="true" />
                <h2 id="lbh-sheet-title" className="lbh__sheet-title">{title}</h2>
                <button ref={closeRef} type="button" className="lbh__sheet-close" onClick={closeSheet} aria-label="Close lineups">
                  ×
                </button>
              </header>

              {moment && <Banner key={moment.key} moment={moment} team={momentTeam} scoreLine={momentScoreLine} inline />}

              <div className="lbh__lineups">
                <Lineup
                  team={matchup.mine}
                  total={fmt(mineScore?.live ?? 0)}
                  players={mineLineup}
                  side="mine"
                  openId={openPlayer?.side === 'mine' ? openPlayer.id : null}
                  onOpen={setOpenPlayer}
                />
                {matchup.opponent && (
                  <Lineup
                    team={matchup.opponent}
                    total={fmt(theirScore?.live ?? 0)}
                    players={theirLineup}
                    side="opponent"
                    openId={openPlayer?.side === 'opponent' ? openPlayer.id : null}
                    onOpen={setOpenPlayer}
                  />
                )}
              </div>

              {cardPlayer && openPlayer && (
                <PlayerCard player={cardPlayer} side={openPlayer.side} onClose={() => setOpenPlayer(null)} />
              )}
            </section>
          </>
        );
      })()}

      {/* Every moment is a banner here — the owner's own plays included. The
          colour asymmetry carries over from the TV: a field of MY colour for
          mine, a dark card with their colour as a rule for theirs. Keyed on
          the moment so each one slides in fresh. While a sheet is open the
          banner moves inside it instead (above), so it never covers a lineup. */}
      {moment && !sheetOpen && (
        <Banner key={moment.key} moment={moment} team={momentTeam} scoreLine={momentScoreLine} inline={false} />
      )}
    </main>
  );
}

export default memo(HandheldBoard);
