/**
 * The pill that proves the page is still working.
 *
 * Ported to the kit unchanged in behaviour, because every one of its choices
 * is a bug report. It replaced a static "Live" badge that was true by
 * assertion — it lit from the game-day clock and then never changed, so a
 * board sitting at 0.0–0.0 (preseason, pre-kickoff, an MFL feed that has not
 * opened) looked exactly like a dead page. Owner report, 2026-08-21.
 *
 *  - **A relative age, ticking.** "updated 14s ago" counts up every second and
 *    snaps to "just now" when a poll lands, so the element itself is the
 *    evidence. An absolute clock time reads as a caption; this reads as a
 *    heartbeat.
 *  - **The tick is local to this component.** A 1s interval one level up would
 *    re-render every starter row on the board once a second.
 *  - **It renders nothing when no feed is enabled.** With both pollers off
 *    (a bundled sample, a story) there is no freshness to report, and a pill
 *    stuck on "Connecting…" would be a lie in the other direction.
 *  - **The timer starts only once something has landed.** Before that the
 *    label is "Connecting…" with no age to age, so a timer would be churn —
 *    and it keeps the first client render byte-identical to the server's.
 *
 * `describeFeedFreshness` is imported, not reimplemented: "we could not reach
 * the feed" outranking "nothing is happening" is the rule that keeps a failed
 * poll showing the last good scores while the pill stops claiming they are
 * current, and a second copy of that decision is how the two drift.
 */
import { useEffect, useState, type JSX } from 'react';
import { describeFeedFreshness, type FeedSnapshot } from '../../../utils/live-scoring-view';

export interface LvFeedStatusProps {
  /** ONLY the pollers actually running for this render. Empty → no pill. */
  feeds: FeedSnapshot[];
  /** Whether a real NFL game is in progress right now. */
  anyLive: boolean;
  /** How many NFL games are being played right now. 0 hides the clause. */
  gamesLive: number;
  /** Detail view: drop the games clause, that header is already tight. */
  compact?: boolean;
}

export default function LvFeedStatus({
  feeds,
  anyLive,
  gamesLive,
  compact,
}: LvFeedStatusProps): JSX.Element | null {
  const [now, setNow] = useState(0);
  const newest = feeds.reduce((max, f) => Math.max(max, f.fetchedAt), 0);

  useEffect(() => {
    if (!newest) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [newest]);

  if (feeds.length === 0) return null;

  const fresh = describeFeedFreshness(feeds, anyLive, now || newest);
  const games =
    !compact && gamesLive > 0 ? `${gamesLive} game${gamesLive === 1 ? '' : 's'} live` : '';

  return (
    <span
      className={`lv-status lv-status--${fresh.tone}`}
      role="status"
      title={
        fresh.tone === 'error'
          ? 'The live feed did not answer the last poll — these numbers are the last we could confirm.'
          : 'Live feed check-in. The page re-reads the feeds automatically.'
      }
    >
      <span
        className={`lv-dot lv-dot--${
          fresh.tone === 'live' ? 'live' : fresh.tone === 'error' ? 'err' : 'pre'
        }`}
      />
      <span className="lv-status__lbl">{fresh.label}</span>
      {games && <span className="lv-status__sub">{games}</span>}
      {fresh.age && <span className="lv-status__age">updated {fresh.age}</span>}
    </span>
  );
}
