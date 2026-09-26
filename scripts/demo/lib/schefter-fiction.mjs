/**
 * Pre-written Schefter posts about the demo league — generated at build time
 * from the simulated season, so the news feed is alive without a live LLM or
 * a real transaction. The voice follows the real feed's: headline in caps
 * energy, a two-sentence body, a link to the page the story is about.
 *
 * League-neutral posts from the real feed (the NFL wire, Vegas lines) are kept
 * by content.mjs after a denylist filter; everything league-specific is here.
 */

const OPENERS = ['BOOM.', 'Sources confirm:', 'I’m told', 'Breaking:', 'Per league sources,', 'Don’t look now, but'];

const fmtMoney = (n) => `$${(Number(n) / 1_000_000).toFixed(2)}M`;
const iso = (unixSeconds) => new Date(Number(unixSeconds) * 1000).toISOString();

function playerName(players, pid) {
  const p = players.get(pid);
  if (!p) return 'a mystery man';
  if (p.position === 'Def') return p.name.split(',').reverse().join(' ').trim() + ' D/ST';
  const [last, first] = p.name.split(',').map((s) => s.trim());
  return first ? `${first} ${last}` : last;
}

export function fictionalSchefterPosts({ season, franchises, rng, league = 'theleague' }) {
  const team = new Map(franchises.map((f) => [f.id, f]));
  const name = (fid) => team.get(fid)?.name ?? 'a rival front office';
  const posts = [];

  // Trades — every player-for-player deal gets its own break.
  for (const t of season.transactions.filter((x) => x.type === 'TRADE')) {
    const gaveA = t.franchise1_gave_up.split(',').filter(Boolean);
    const gaveB = t.franchise2_gave_up.split(',').filter(Boolean);
    const describe = (ids) =>
      ids.map((id) => (id.startsWith('FP_') ? `a ${id.split('_')[2]} round-${id.split('_')[3]} pick` : playerName(season.players, id))).join(' and ') || 'future considerations';
    posts.push({
      id: `demo_trade_${t.timestamp}_${t.franchise}`,
      timestamp: iso(t.timestamp),
      type: 'transaction',
      transactionSubType: 'trade',
      tier: 'breaking',
      headline: `TRADE: ${team.get(t.franchise)?.nameShort ?? 'Team'} and ${team.get(t.franchise2)?.nameShort ?? 'Team'} swap pieces`,
      body: `${rng.pick(OPENERS)} The ${name(t.franchise)} send ${describe(gaveA)} to the ${name(t.franchise2)} for ${describe(gaveB)}. Both front offices believe they won this one.`,
      authorId: 'claude',
      franchiseIds: [t.franchise, t.franchise2],
      playerIds: [...gaveA, ...gaveB].filter((id) => !id.startsWith('FP_')),
      league,
      link: `/${league}/transactions`,
      linkLabel: 'See the deal',
    });
  }

  // The biggest waiver bids of the season.
  const claims = season.transactions
    .filter((x) => x.type === 'BBID_WAIVER')
    .map((x) => {
      const [add, bid] = x.transaction.split('|');
      return { ...x, add: add.replace(/,$/, ''), bid: Number(bid) };
    })
    .sort((a, b) => b.bid - a.bid)
    .slice(0, 6);
  for (const c of claims) {
    posts.push({
      id: `demo_waiver_${c.timestamp}_${c.franchise}`,
      timestamp: iso(c.timestamp),
      type: 'transaction',
      transactionSubType: 'waiver',
      tier: 'standard',
      headline: `${team.get(c.franchise)?.nameShort ?? 'Team'} win the ${playerName(season.players, c.add)} sweepstakes`,
      body: `${rng.pick(OPENERS)} the ${name(c.franchise)} landed ${playerName(season.players, c.add)} on waivers with a ${fmtMoney(c.bid)} bid. That’s real cap space for a real bet.`,
      authorId: 'claude',
      franchiseIds: [c.franchise],
      playerIds: [c.add],
      league,
      link: `/${league}/transactions`,
      linkLabel: 'All transactions',
    });
  }

  // A recap for every played regular-season week.
  for (const w of season.weekly.filter((x) => x.regularSeason)) {
    const games = w.games.map(([home, away, hid, aid]) => ({ hid, aid, hs: home.score, as: away.score }));
    const blowout = [...games].sort((a, b) => Math.abs(b.hs - b.as) - Math.abs(a.hs - a.as))[0];
    const nailBiter = [...games].sort((a, b) => Math.abs(a.hs - a.as) - Math.abs(b.hs - b.as))[0];
    const top = games.flatMap((g) => [[g.hid, g.hs], [g.aid, g.as]]).sort((a, b) => b[1] - a[1])[0];
    const winLose = (g) => (g.hs >= g.as ? [g.hid, g.aid, g.hs, g.as] : [g.aid, g.hid, g.as, g.hs]);
    const [bw, bl, bws, bls] = winLose(blowout);
    const [nw, nl, nws, nls] = winLose(nailBiter);
    const kickoff = season.weekStart?.(w.week) ?? 0;
    posts.push({
      id: `demo_recap_${season.year}_w${String(w.week).padStart(2, '0')}`,
      timestamp: new Date((kickoff + 6 * 86_400) * 1000).toISOString(),
      type: 'article',
      category: 'articles',
      tier: 'standard',
      headline: `Week ${w.week} Recap: ${team.get(top[0])?.nameShort} explode for ${top[1].toFixed(1)}`,
      body: `The ${name(top[0])} put up the week’s best score. The ${name(bw)} hammered the ${name(bl)} ${bws.toFixed(1)}–${bls.toFixed(1)}, while the ${name(nw)} survived the ${name(nl)} by ${(nws - nls).toFixed(2)}.`,
      content: [
        `<p>Week ${w.week} is in the books, and the ${name(top[0])} owned it — ${top[1].toFixed(2)} points, the best mark in the league.</p>`,
        `<p>The blowout of the week: the ${name(bw)} over the ${name(bl)}, ${bws.toFixed(2)} to ${bls.toFixed(2)}. Somebody check on that bench.</p>`,
        `<p>The nail-biter: the ${name(nw)} escaped the ${name(nl)} ${nws.toFixed(2)}–${nls.toFixed(2)}. Set your lineups early, folks.</p>`,
      ],
      authorId: 'claude',
      franchiseIds: [top[0], bw, bl, nw, nl],
      league,
      link: `/${league}/news/demo_recap_${season.year}_w${String(w.week).padStart(2, '0')}`,
      linkLabel: 'Read the recap',
    });
  }

  return posts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
