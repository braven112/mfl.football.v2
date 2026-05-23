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

/** Extract numeric player IDs from one comma-delimited segment. */
function idsIn(segment) {
  return (segment ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => /^\d+$/.test(s));
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
  const bbid = txnStr.match(/^(\d+),\|(\d+)\|(\d*),?$/);
  if (bbid) {
    addedIds.push(bbid[1]);
    bbidAmount = parseInt(bbid[2], 10);
    if (bbid[3]) droppedIds.push(bbid[3]);
    return { addedIds, droppedIds, bbidAmount };
  }

  // FREE_AGENT / WAIVER: "added|dropped" — positional. A leading pipe means
  // the add side is empty (a pure drop); a trailing pipe means no drop.
  const parts = txnStr.split('|');
  addedIds.push(...idsIn(parts[0]));
  droppedIds.push(...idsIn(parts[1]));
  return { addedIds, droppedIds, bbidAmount };
}
