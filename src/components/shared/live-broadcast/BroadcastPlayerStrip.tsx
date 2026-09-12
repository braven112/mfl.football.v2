/**
 * The rotating player strip — everything under the fixed header.
 *
 * Props-only. The island owns the timer and hands this one page at a time;
 * this renders it. Two pages are mounted during a handoff (outgoing + incoming)
 * so the cross-fade has something to fade FROM.
 */

import { BroadcastFace } from '../draft-broadcast/BroadcastFace';
import { normalizeTeamCode } from '../../../utils/nfl-logo';
import { padPage, type StripPage, type StripRow } from '../../../utils/broadcast-layout';

interface Props {
  page: StripPage | null;
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
          {row.nflTeam && <img className="lbc__nfl" src={nflLogo(row.nflTeam)} alt="" />}
          <span>{row.position}</span>
          <span>·</span>
          <span>{row.leagueName}</span>
        </span>
      </span>
      {/* WHICH of the owner's teams this player is on — non-negotiable on a
          cross-league board, where the same man can be on two of them. */}
      {row.crest && <img className="lbc__row-crest" src={row.crest} alt="" />}
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

export default function BroadcastPlayerStrip({ page, rowsPerPage, hidden, dimTail }: Props) {
  const rows = page ? padPage(page, rowsPerPage) : [];
  const dimFrom = dimTail > 0 ? rows.length - dimTail : rows.length;

  return (
    <div
      className={`lbc__strip${hidden ? ' is-hidden' : ''}`}
      aria-label="Your players"
      {...(hidden ? { inert: '' as unknown as boolean } : {})}
    >
      {page && (
        <div className="lbc__page is-in" key={page.key}>
          <p className="lbc__page-tag">{page.label}</p>
          {rows.map((row, i) => (
            <Row key={row?.key ?? `filler-${i}`} row={row} dim={i >= dimFrom} />
          ))}
        </div>
      )}
    </div>
  );
}
