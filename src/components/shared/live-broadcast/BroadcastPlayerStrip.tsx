/**
 * The rotating player strip — everything under the fixed header.
 *
 * Props-only. The island owns the timer and hands this one page at a time;
 * this renders it. Two pages are mounted during a handoff (outgoing + incoming)
 * so the cross-fade has something to fade FROM.
 */

import { memo } from 'react';
import { BroadcastFace } from '../draft-broadcast/BroadcastFace';
import { normalizeTeamCode } from '../../../utils/nfl-logo';
import { padPage, type StripPage, type StripRow } from '../../../utils/broadcast-layout';
import { crestStrokeProps } from '../../../utils/draft-broadcast';

interface Props {
  page: StripPage | null;
  /**
   * The page being faded OUT, if any.
   *
   * Both pages have to be mounted for the cross-fade to have something to fade
   * from — a transition does not run on mount, so a single swapped-in page
   * lands already at its final state and every rotation is a hard cut. The
   * island owns the handoff timing and hands both pages here for its duration.
   */
  outgoing: StripPage | null;
  rowsPerPage: number;
  hidden: boolean;
  /** Rows the lower-third band covers, dimmed rather than hidden. */
  dimTail: number;
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');

const nflLogo = (team: string) => (team ? `/assets/nfl-logos/${normalizeTeamCode(team)}.svg` : '');

function Row({ row, dim }: { row: StripRow | null; dim: boolean }) {
  if (!row) {
    // A rail-only filler, so a short page does not change the strip's height.
    return (
      <div className="lbc__row is-filler" aria-hidden="true">
        <span className="lbc__rail" />
      </div>
    );
  }

  return (
    <div
      className={`lbc__row${row.side === 'opponent' ? ' is-theirs' : ''}`}
      style={dim ? { opacity: 0.35 } : undefined}
    >
      <span className="lbc__rail" />
      <BroadcastFace
        player={{ id: row.playerId, mflId: row.playerId, position: row.position, nflTeam: row.nflTeam, headshot: row.headshot }}
        className="lbc__face"
      />
      <span className="lbc__who">
        <span className="lbc__name">{row.name}</span>
        <span className="lbc__meta">
          {/* DEF hides the meta-row logo — `BroadcastFace` opts a team defense
              into its NFL logo AS the face ("a team defense is a crest, not a
              person"), so rendering it again here is the same club's mark
              twice on one row, a few pixels apart. `LiveScoreboard` has
              suppressed this since the shared PlayerCell did; this row is the
              surface that forgot to. */}
          {row.nflTeam && row.position.toUpperCase() !== 'DEF' && (
            <img className="lbc__nfl" src={nflLogo(row.nflTeam)} alt="" />
          )}
          <span>{row.position}</span>
          <span>·</span>
          <span>{row.leagueName}</span>
        </span>
      </span>
      {/* WHICH of the owner's teams this player is on — non-negotiable on a
          cross-league board, where the same man can be on two of them. */}
      {row.crest && (
        <img
          {...crestStrokeProps('lbc__row-crest', row.crestStroke, 'lbc')}
          src={row.crest}
          alt=""
        />
      )}
      <span className="lbc__pts">{fmt(row.points)}</span>
      <span className="lbc__clock">
        <span
          className={`lbc__dot ${row.state === 'in-progress' ? 'is-live' : row.state === 'final' ? 'is-final' : 'is-pre'}`}
        />
        {row.clock}
      </span>
    </div>
  );
}

function Page({
  page,
  rowsPerPage,
  dimTail,
  out,
}: {
  page: StripPage;
  rowsPerPage: number;
  dimTail: number;
  out: boolean;
}) {
  const rows = padPage(page, rowsPerPage);
  const dimFrom = dimTail > 0 ? rows.length - dimTail : rows.length;
  return (
    <div className={`lbc__page ${out ? 'is-out' : 'is-in'}`} aria-hidden={out || undefined}>
      <p className="lbc__page-tag">{page.label}</p>
      {rows.map((row, i) => (
        <Row key={row?.key ?? `filler-${i}`} row={row} dim={i >= dimFrom} />
      ))}
    </div>
  );
}

function BroadcastPlayerStrip({ page, outgoing, rowsPerPage, hidden, dimTail }: Props) {

  return (
    <div
      className={`lbc__strip${hidden ? ' is-hidden' : ''}`}
      aria-label="Your players"
      // A real boolean: React treats `inert=""` as FALSE and warns, so the
      // empty-string spelling silently never applied.
      inert={hidden}
    >
      {outgoing && outgoing.key !== page?.key && (
        <Page key={outgoing.key} page={outgoing} rowsPerPage={rowsPerPage} dimTail={dimTail} out />
      )}
      {page && (
        <Page key={page.key} page={page} rowsPerPage={rowsPerPage} dimTail={dimTail} out={false} />
      )}
    </div>
  );
}

/**
 * Memoised because the island ticks once a SECOND to age the freshness pill
 * and drive the screensaver clock, and this component depends on none of that.
 * Unmemoised, a 1 Hz heartbeat re-renders the whole visible board ~28,800
 * times over an eight-hour Sunday — on set-top hardware, and concurrently
 * with the reveal transitions that are the one thing on this screen allowed
 * to cost a frame budget. Props here are already memoised upstream, so the
 * bailout is free and changes no behaviour.
 */
export default memo(BroadcastPlayerStrip);
