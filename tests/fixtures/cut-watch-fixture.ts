/**
 * Synthetic Cut Watch fixture — value and acquisition recency deliberately
 * INVERTED so a value-based cut list and the real (newest-pickup-first)
 * auto-cut list share zero names. Used by both the deterministic suite
 * (tests/cut-watch-auto-cut-rule.test.ts) and the live generation eval
 * (tests/eval/cut-watch.eval.ts).
 *
 * Shape of the trap, under the REAL rule (august-cut-selection-core.mjs):
 *
 *   - 4 recent waiver/FA pickups (Okoye, Brennan, Whitlock, Aduba) — mid
 *     value, and the ONLY players with acquisition records → the first 4
 *     auto-cuts, newest first.
 *   - Long-held draft stock, including the actual dead weight (Lindqvist,
 *     Mbeki + filler, unranked in ADP) → cut last, so the "obvious" cuts
 *     survive an auto-cut untouched.
 *   - Two trade acquisitions close the roster: Salas (high value) and
 *     Traore (Jul 25 — the NEWEST acquisition on the team, and the
 *     cheapest). Trades never count as pickups, so the system treats both
 *     as long-held. Traore is the single discriminating datapoint: value
 *     logic cuts him first (worst value), recency-without-trade-scoping
 *     cuts him first (newest acquisition), the real rule reaches him last.
 *     He is simultaneously the #1 advisory cut candidate and a player the
 *     deadline job won't touch — the cleanest illustration of the
 *     advisory/mechanical split.
 *
 * Ground truth (team 9901, 28 active, limit 22, shed 6, nothing marked):
 *   auto-cut = Okoye, Brennan, Whitlock, Aduba (pickups, newest first),
 *              then Restrepo, Halvorsen (long-held pool, roster order).
 *   Traore & Salas: never reached. NOTE: that holds because they sit at the
 *   END of the roster array — trades are long-held, not absolutely exempt.
 */

// Mid-day UTC so the PT calendar date is stable.
const jul = (day: number) => String(Math.floor(Date.UTC(2026, 6, day, 19) / 1000));

export function fixturePlayers() {
  const players = [
    { id: '9002', name: 'Okoye, Daniel', position: 'WR' }, // waiver Jul 22
    { id: '9004', name: 'Brennan, Tom', position: 'TE' }, // FA Jul 15
    { id: '9005', name: 'Whitlock, James', position: 'RB' }, // waiver Jul 11
    { id: '9006', name: 'Aduba, Chike', position: 'WR' }, // FA Jul 8
    { id: '9007', name: 'Restrepo, Kai', position: 'WR' }, // long-held
    { id: '9008', name: 'Halvorsen, Gus', position: 'RB' }, // long-held
    { id: '9009', name: 'Lindqvist, Per', position: 'TE' }, // long-held dead weight
    { id: '9010', name: 'Mbeki, Sam', position: 'WR' }, // long-held dead weight
  ];
  // Pad to 26 with long-held filler…
  for (let i = 11; i <= 28; i++) {
    players.push({ id: `90${i}`, name: `Filler, P${i}`, position: 'RB' });
  }
  // …then the two trade acquisitions close the roster (28 total, 6 over).
  players.push({ id: '9001', name: 'Traore, Ludovic', position: 'RB' }); // trade Jul 25, unranked
  players.push({ id: '9003', name: 'Salas, Miguel', position: 'WR' }); // trade Jul 19, high value
  return players;
}

export function fixtureData() {
  return {
    players: {
      players: {
        player: fixturePlayers().map((p) => ({ ...p, team: 'FA' })),
      },
    },
    rosters: {
      rosters: {
        franchise: [
          {
            id: '9901',
            player: fixturePlayers().map((p) => ({
              id: p.id,
              status: 'ROSTER',
              // Traore is the cheapest roster spot so the salary tiebreak
              // puts him at the top of the unranked advisory pile — the #1
              // "should cut" while being a player the system never reaches.
              salary: p.id === '9001' ? '425000' : '450000',
              contractYear: '1',
            })),
          },
        ],
      },
    },
    transactions: {
      transactions: {
        transaction: [
          // Trades — must be ignored by acquisition ordering entirely.
          { type: 'TRADE', timestamp: jul(25), franchise: '9901', transaction: '9001,' },
          { type: 'TRADE', timestamp: jul(19), franchise: '9901', transaction: '9003,' },
          // Waiver / FA pickups — the real auto-cut order, newest first.
          { type: 'BBID_WAIVER', timestamp: jul(22), franchise: '9901', transaction: '9002,|5|,' },
          { type: 'FREE_AGENT', timestamp: jul(15), franchise: '9901', transaction: '9004|,' },
          { type: 'BBID_WAIVER', timestamp: jul(11), franchise: '9901', transaction: '9005,|3|,' },
          { type: 'FREE_AGENT', timestamp: jul(8), franchise: '9901', transaction: '9006|,' },
          // Another franchise's pickup of a player later traded to 9901 —
          // must NOT count as 9901's acquisition.
          { type: 'FREE_AGENT', timestamp: jul(2), franchise: '9902', transaction: '9003|,' },
        ],
      },
    },
  };
}

/** ADP maps: low pick = valuable. Dead weight + Traore are absent (unranked). */
export function fixtureAdp() {
  const redraft = new Map<string, number>([
    ['9002', 71], // Okoye — mid value
    ['9003', 12], // Salas — high value
    ['9004', 160], // Brennan
    ['9005', 80], // Whitlock
    ['9006', 110], // Aduba
    ['9007', 95], // Restrepo
    ['9008', 100], // Halvorsen
  ]);
  return { redraft, dynasty: new Map(redraft) };
}
