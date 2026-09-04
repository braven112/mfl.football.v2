/**
 * The Owners' Poll — ballot strip on the Set Lineup page.
 *
 * This is the turnout lever the GroupMe posts cannot be. Setting a lineup is
 * the one obligatory weekly action in this league, so it is the only page
 * every active owner reliably visits — and since the ballot now closes at the
 * first kickoff, the two deadlines are the same deadline. Voting here costs no
 * navigation at all: it is the real builder, inline.
 *
 * It renders NOTHING unless a ballot is actually open, so the lineup page is
 * unchanged for most of the year. The status fetch is the only cost, and it is
 * behind `client:visible`.
 */

import { useEffect, useState } from 'react';
import BallotBuilder, { type BallotTeam } from './BallotBuilder';

interface Props {
  teams: BallotTeam[];
  slots: number;
  quorum: number;
  leagueParam: string;
  ownFranchiseId: string;
  ballotHref: string;
  columnHref: string;
}

interface Status {
  status: 'open' | 'pending' | 'closed' | 'none';
  ballot: { ranking: string[] } | null;
  turnout?: { ballotsIn: number; eligible: number };
}

export default function LineupBallotStrip(props: Props) {
  const { teams, slots, quorum, leagueParam, ownFranchiseId, ballotHref, columnHref } = props;
  const [status, setStatus] = useState<Status | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/owners-poll/ballot?league=${encodeURIComponent(leagueParam)}`,
          { credentials: 'same-origin' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as Status;
        if (!cancelled) setStatus(data);
      } catch {
        // Silent. This is a bonus panel on someone else's page — a failed
        // status read must never put an error banner between an owner and
        // their lineup.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueParam]);

  // No ballot open (or we couldn't tell) → the lineup page is untouched.
  if (!status || status.status !== 'open') return null;

  const voted = Boolean(status.ballot);
  const turnout = status.turnout;

  return (
    <section className={`op-lineup ${voted ? 'op-lineup--done' : ''}`} aria-label="The Owners' Poll">
      <button
        type="button"
        className="op-lineup__head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="op-lineup__title">
          {voted ? '✓ Your Owners’ Poll ballot is in' : `Owners’ Poll — rank your top ${slots}`}
        </span>
        <span className="op-lineup__meta">
          {turnout ? `${turnout.ballotsIn}/${turnout.eligible} in` : ''}
          {turnout && turnout.ballotsIn < quorum
            ? ` · ${quorum - turnout.ballotsIn} more for quorum`
            : ''}
        </span>
        <span className="op-lineup__chev" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>

      {!expanded && (
        <p className="op-lineup__sub">
          {voted ? (
            <>Closes with your lineup. <button type="button" className="op-lineup__link" onClick={() => setExpanded(true)}>Change it</button> or <a href={columnHref}>read the column</a>.</>
          ) : (
            <>Same deadline as your lineup. <button type="button" className="op-lineup__link" onClick={() => setExpanded(true)}>Vote right here</button> — about a minute.</>
          )}
        </p>
      )}

      {expanded && (
        <div className="op-lineup__body">
          <BallotBuilder
            teams={teams}
            slots={slots}
            leagueParam={leagueParam}
            ownFranchiseId={ownFranchiseId}
            columnHref={ballotHref}
          />
        </div>
      )}
    </section>
  );
}
