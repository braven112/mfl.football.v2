/**
 * Roster-move transaction parsing for the Schefter scanner.
 *
 * MFL encodes FREE_AGENT / WAIVER / BBID_WAIVER moves as a positional,
 * pipe-delimited string where EMPTY SEGMENTS ARE MEANINGFUL. The added
 * player(s) live before the first pipe and the dropped player(s) after it:
 *
 *   FREE_AGENT / WAIVER:  "addId,|dropId,"   (either side may be empty)
 *   BBID_WAIVER:          "addId,|bid|dropId,"
 *
 * A pure drop therefore has an empty add segment: "|13134,". The previous
 * scanner stripped the leading pipe before splitting, which erased that
 * "nothing added" signal and reported every drop as a phantom "claims"
 * pickup. Parse positionally and never strip a leading pipe.
 */

/**
 * MFL's legacy "nothing was cut" marker in the drop segment of a pre-2017 BBID
 * row ("8838|425000|0000"). It is a SENTINEL, not a player: neither league has
 * a player with that id in any of its 20 seasons, it never appears in a
 * FREE_AGENT row or in any post-2016 shape, and it sits exactly where the
 * modern format writes an empty segment. 276 rows carry it.
 *
 * Returned as a dropped id it reaches `describePlayer` in schefter-scan.mjs,
 * whose lookup miss falls through to the literal prose `Player 0000` — the
 * same "a placeholder is not a safe degradation in a generator whose output
 * ships unread" failure as #1156, waiting on the first backfill that replays
 * an old season. Kept in step with src/utils/contract-eligibility.ts; the
 * parity test in tests/contract-eligibility.test.ts is what holds them equal.
 */
const NO_DROP_SENTINEL = '0000';

/** Extract numeric player IDs from one comma-delimited segment. */
function idsIn(segment) {
  return (segment ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => /^\d+$/.test(s) && s !== NO_DROP_SENTINEL);
}

/**
 * Parse a roster-move transaction string into added/dropped player IDs.
 * @param {string} txnStr raw MFL `transaction` field
 * @returns {{ addedIds: string[], droppedIds: string[], bbidAmount?: number }}
 */
export function parseRosterMove(txnStr) {
  const addedIds = [];
  const droppedIds = [];
  let bbidAmount;

  if (!txnStr || !txnStr.trim()) {
    return { addedIds, droppedIds, bbidAmount };
  }

  // BBID_WAIVER: "addId,|bid|dropId," — the middle segment is the bid amount,
  // not a player. The drop segment may be empty (add-only winning bid).
  //
  // Three variations are all real in this league's history, and a shape that
  // misses here does NOT fail — it falls through to the FREE_AGENT branch,
  // where the BID is read as a dropped player id and the caller sees no bid at
  // all (a $775K claim prices as $0). So the pattern has to cover them:
  //   - the add side's comma is OPTIONAL: MFL wrote "8838|425000|0000" through
  //     2016 and "8838,|425000|0000," from 2017 on.
  //   - the bid may be DECIMAL ("425000.5", and a bare trailing dot "425000.").
  //   - the drop side may name SEVERAL players, so it is parsed as a list.
  //   - the drop segment is read WHOLE and filtered by idsIn, rather than
  //     matched as `[\d,]*`. A stricter class does not reject a malformed drop
  //     side, it makes the ENTIRE row miss this branch and fall through to
  //     FREE_AGENT — where the bid becomes a dropped player id and the claim
  //     prices at $0, which is the failure this branch exists to prevent. It
  //     also kept this pattern out of step with the one in
  //     src/utils/contract-eligibility.ts for no gain.
  const bbid = txnStr.match(/^(\d+),?\|(\d+(?:\.\d*)?)\|(.*)$/);
  if (bbid) {
    addedIds.push(bbid[1]);
    bbidAmount = parseInt(bbid[2], 10);
    droppedIds.push(...idsIn(bbid[3]));
    return { addedIds, droppedIds, bbidAmount };
  }

  // FREE_AGENT / WAIVER: "added|dropped" — positional. A leading pipe means
  // the add side is empty (a pure drop); a trailing pipe means no drop.
  const parts = txnStr.split('|');
  addedIds.push(...idsIn(parts[0]));
  droppedIds.push(...idsIn(parts[1]));
  return { addedIds, droppedIds, bbidAmount };
}
