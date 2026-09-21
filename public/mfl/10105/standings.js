/*
 * MAD POWER 99 — automatic playoff standings
 * Archie's Fantasy Football League (MFL 10105)
 *
 * Loaded by the league's MFL home page module:
 *   <script src="https://v2.mfl.football/mfl/10105/standings.js" defer></script>
 *
 * Reads the league's own data from MyFantasyLeague on every page load and
 * rebuilds the standings table. There is no scheduled job and no stored copy
 * of anything — the table cannot go stale because it holds no data of its own.
 *
 * IMPORTANT: remove the module's existing inline <script> when installing
 * this. That script does its own ranking, sectioning and cell conversion; both
 * running at once will fight over the same table.
 *
 * Reference for the markup and CSS this reproduces: reference/existing-page.css
 * and reference/existing-page.js, captured from the live page 2026-09-20.
 */
(function () {
  'use strict';

  /* ==================================================================
   * CONFIGURATION — edit this block, nothing below it.
   * ================================================================== */

  /* Playoff structure. Season-level, not a weekly edit.
   * 9 + 9 + 12 = 30 qualify; the rest of the league fills out the table. */
  var DIVISION_LEADER_SEEDS = 9;   // seeds 1-9   — one per division
  var RUNNER_UP_SEEDS       = 9;   // seeds 10-18 — one per division
  var WILD_CARD_SEEDS       = 12;  // seeds 19-30 — next best on Victory Points

  /* Winnings, by MFL franchise id. MFL's accounting ledger for this league is
   * empty, so there is nothing to derive these from — they are the one figure
   * still entered by hand. A franchise left out shows no winnings.
   * Edit, push, deployed. */
  var WINNINGS = {
    // '0001': 239.00,
    // '0016': 125.00,
  };

  /* ================================================================== */

  var TIER = {
    leader: { row: 'division-row',  label: 'DIVISION LEADER' },
    second: { row: 'runnerup-row',  label: 'DIVISION 2ND' },
    wild:   { row: 'wildcard-row',  label: 'WILD CARD' },
    field:  { row: '',              label: '' }
  };

  /* MFL collapses a single-element array into a bare object. */
  function arr(x) {
    if (Array.isArray(x)) return x;
    return x ? [x] : [];
  }

  /* MFL returns errors as HTTP 200 with an error body, so res.ok is not
   * "the call worked". Both shapes appear in the wild. */
  function mflError(json) {
    if (!json || !json.error) return null;
    return typeof json.error === 'string' ? json.error : (json.error.$t || 'unknown MFL error');
  }

  /* The page is served at /<year>/home/<leagueId>, so the host, year and
   * league all come from the URL. Nothing here is hardcoded to one league:
   * a root-relative fetch follows whatever host served the page, which is why
   * this same file works on any wwwNN and in any league it is dropped into. */
  function readContext() {
    var m = /^\/(\d{4})\/home\/(\d+)/.exec(window.location.pathname);
    if (!m) return null;
    return { year: m[1], leagueId: m[2] };
  }

  function feed(ctx, type) {
    var url = '/' + ctx.year + '/export?TYPE=' + type + '&L=' + ctx.leagueId + '&JSON=1';
    return fetch(url, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error(type + ': HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      var err = mflError(json);
      if (err) throw new Error(type + ': ' + err);
      return json;
    });
  }

  /* ------------------------------------------------------------------
   * Building the table
   * ------------------------------------------------------------------ */

  function buildTeams(league, standings) {
    var franchises = arr(league.league && league.league.franchises && league.league.franchises.franchise);
    var divisions = arr(league.league && league.league.divisions && league.league.divisions.division);

    /* The status column is 20% of the width on a phone, and every entry in it
     * is a division — so the word "Division" is both redundant and the reason
     * "Joe Montana Division" wrapped onto three lines. */
    var divName = {};
    divisions.forEach(function (d) {
      divName[d.id] = (d.name || '').trim().replace(/\s+Division$/i, '');
    });

    var meta = {};
    franchises.forEach(function (f) {
      meta[f.id] = {
        id: f.id,
        name: (f.name || '').trim(),
        /* Icon paths embed the year each image was uploaded, so they cannot be
         * built from the current year — always take the feed's own url. */
        icon: f.icon || '',
        division: f.division,
        divisionName: divName[f.division] || ''
      };
    });

    var rows = arr(standings.leagueStandings && standings.leagueStandings.franchise);
    if (!rows.length) throw new Error('standings feed returned no franchises');

    /* Victory Points appear only when the league's standings display is
     * configured to show them — MFL's export returns the configured columns
     * and nothing else. Without them there is no seeding to compute. */
    if (!('vp' in rows[0])) {
      var e = new Error('no-vp');
      e.noVp = true;
      throw e;
    }

    return rows.map(function (r, i) {
      var m = meta[r.id] || { id: r.id, name: (r.fname || '').trim(), icon: '', divisionName: '' };
      return {
        id: r.id,
        name: m.name || (r.fname || '').trim(),
        icon: m.icon,
        division: m.division,
        divisionName: m.divisionName,
        vp: Number(r.vp) || 0,
        record: (r.h2hwlt || '').trim(),
        /* MFL's row order already applies the league's official tiebreaker
         * chain, some of which we cannot reproduce. Keep it as the stable
         * fallback order rather than inventing one. */
        feedOrder: i
      };
    });
  }

  /* MFL's row order IS the league's official order, so the first row of a
   * division is its leader and the second is its runner-up. Never re-sort to
   * work that out. */
  function tiers(teams) {
    var byDivision = {};
    teams.forEach(function (t) {
      (byDivision[t.division] = byDivision[t.division] || []).push(t);
    });

    var leaders = [];
    var seconds = [];
    Object.keys(byDivision).sort().forEach(function (d) {
      var g = byDivision[d];
      if (g[0]) leaders.push(g[0]);
      if (g[1]) seconds.push(g[1]);
    });
    leaders = leaders.slice(0, DIVISION_LEADER_SEEDS);
    seconds = seconds.slice(0, RUNNER_UP_SEEDS);

    var taken = {};
    leaders.concat(seconds).forEach(function (t) { taken[t.id] = true; });

    var byVp = function (a, b) { return (b.vp - a.vp) || (a.feedOrder - b.feedOrder); };
    var rest = teams.filter(function (t) { return !taken[t.id]; }).sort(byVp);

    var wild = rest.slice(0, WILD_CARD_SEEDS);
    var field = rest.slice(WILD_CARD_SEEDS);

    leaders.sort(byVp);
    seconds.sort(byVp);

    var out = [];
    var push = function (list, tier) {
      list.forEach(function (t, i) { out.push({ team: t, tier: tier, tierIndex: i }); });
    };
    push(leaders, 'leader');
    push(seconds, 'second');
    push(wild, 'wild');
    push(field, 'field');

    out.forEach(function (e, i) { e.seed = i + 1; });

    /* A Victory Point tie is shown, never silently broken. Mark any team whose
     * VP is shared inside its own tier, and flag the case that actually decides
     * something: a tie straddling the last wild card place. */
    var counts = {};
    out.forEach(function (e) {
      var k = e.tier + ':' + e.team.vp;
      counts[k] = (counts[k] || 0) + 1;
    });
    out.forEach(function (e) { e.tied = counts[e.tier + ':' + e.team.vp] > 1; });

    var lastIn = wild[wild.length - 1];
    var firstOut = field[0];
    var overflow = (lastIn && firstOut && lastIn.vp === firstOut.vp)
      ? field.filter(function (t) { return t.vp === lastIn.vp; }).length
      : 0;

    return { entries: out, cutAfter: leaders.length + seconds.length + wild.length, overflow: overflow, overflowVp: lastIn ? lastIn.vp : null };
  }

  /* ------------------------------------------------------------------
   * Rendering — reuses the page's own class names so its stylesheet does
   * the work. Only the new runner-up tier needs CSS of its own.
   * ------------------------------------------------------------------ */

  /* Styling lives in standings.css, loaded by the module's own <link>. It is
   * served rather than injected so the table is styled before this script
   * runs, and stays styled if it never does. */

  function cell(cls, text) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    if (text != null) td.textContent = text;
    return td;
  }

  function fullRow(cls, text) {
    var tr = document.createElement('tr');
    var td = cell(cls, text);
    td.colSpan = 6;
    tr.appendChild(td);
    return tr;
  }

  function stack(wrapCls, iconCls, ariaLabel, text, textCls) {
    var wrap = document.createElement('div');
    wrap.className = wrapCls;
    var icon = document.createElement('i');
    icon.className = iconCls;
    icon.setAttribute('aria-label', ariaLabel);
    wrap.appendChild(icon);
    if (text) {
      var span = document.createElement('span');
      span.className = textCls;
      span.textContent = text;
      wrap.appendChild(span);
    }
    return wrap;
  }

  function money(n) {
    return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function teamRow(entry, isTopScorer) {
    var t = entry.team;
    var tier = TIER[entry.tier];
    var tr = document.createElement('tr');

    var classes = [];
    if (tier.row) classes.push(tier.row);
    if (isTopScorer) classes.push('highlight-row');
    var won = WINNINGS[t.id];
    if (won) classes.push('winnings-row');
    if (classes.length) tr.className = classes.join(' ');

    tr.appendChild(cell('rank', String(entry.seed)));

    /* Team: banner above name, as the live page renders it. */
    var team = cell('team');
    var ts = document.createElement('div');
    ts.className = 'team-stack';
    if (t.icon) {
      var img = document.createElement('img');
      img.className = 'img-responsive team-banner';
      img.src = t.icon;
      img.alt = t.name + ' team banner';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.setAttribute('width', '300');
      img.setAttribute('height', '50');
      ts.appendChild(img);
    }
    var nm = document.createElement('span');
    nm.className = 'team-name';
    nm.textContent = t.name;
    ts.appendChild(nm);
    team.appendChild(ts);
    tr.appendChild(team);

    /* MFL's own W-L-T, printed as the feed gives it. */
    tr.appendChild(cell('record', t.record || '0-0-0'));

    var pts = cell('points', String(t.vp));
    if (entry.tied) {
      var tie = document.createElement('span');
      tie.className = 'mp99-tie';
      tie.textContent = 'T';
      tie.title = 'tied on Victory Points';
      pts.appendChild(tie);
    }
    tr.appendChild(pts);

    var w = cell('winnings-input');
    if (won) w.appendChild(stack('winnings-stack', 'fa-sharp fa-regular fa-money-bill-1 winnings-icon', 'winnings', money(won), 'winnings-amount'));
    tr.appendChild(w);

    /* Status cell: which tier, and for the two division tiers, which division. */
    var status;
    if (entry.tier === 'leader') {
      status = cell('division-leader-display');
      status.appendChild(stack('division-leader-stack', 'fa-sharp fa-solid fa-ranking-star division-leader-icon', 'division leader', t.divisionName, 'division-leader-name'));
    } else if (entry.tier === 'second') {
      /* Their own cell class, not one of ours: a runner-up cell is a division
       * placing like a leader's, so anything they style on
       * .division-leader-display should reach it. The tier is told apart by
       * the row background and the icon colour. */
      status = cell('division-leader-display');
      status.appendChild(stack('division-leader-stack', 'fa-sharp fa-solid fa-ranking-star runnerup-leader-icon', 'division runner-up', t.divisionName, 'division-leader-name'));
    } else if (entry.tier === 'wild') {
      /* Their "WC #1" note, which the commissioner used to type by hand —
       * now it numbers itself from the team's place in the wild card band. */
      status = cell('wildcard-leader-display');
      status.appendChild(stack('wildcard-leader-stack', 'fa-sharp fa-solid fa-cards wildcard-leader-icon', 'wild card', 'WC #' + (entry.tierIndex + 1), 'wildcard-leader-note'));
    } else {
      status = cell('wildcard-leader-display');
    }
    tr.appendChild(status);

    return tr;
  }

  function findTable() {
    return document.getElementById('wwwc') ||
           document.querySelector('#madmen table') ||
           null;
  }

  /* Everything after the header row is ours; the static rows in the module are
   * a fallback that is replaced on success. */
  function clearBody(table) {
    var rows = Array.prototype.slice.call(table.rows);
    rows.forEach(function (tr) {
      if (tr.getElementsByTagName('th').length) return;
      tr.parentNode.removeChild(tr);
    });
  }

  /* The module's header row is left in place — but two of its labels stop
   * being true once the widget takes over: the ranked column is Victory
   * Points, not a points average, and the status column now carries three
   * tiers. Retitle in place so a re-pasted module cannot drift from the data
   * underneath it. Everything else in the header, and the caption and
   * colgroup, are left exactly as the league wrote them. */
  function retitleHeader(table) {
    var ths = table.getElementsByTagName('th');
    Array.prototype.forEach.call(ths, function (th) {
      var text = (th.textContent || '').trim().toUpperCase();
      if (text === 'POINTS AVG' || text === 'POINTS') th.textContent = 'VICTORY PTS';
      else if (text === 'DIVISION LEADERS') th.textContent = 'PLAYOFF STATUS';
    });
  }

  function render(table, model) {
    retitleHeader(table);
    clearBody(table);
    var body = table.tBodies[0] || table;
    var top = null;

    model.entries.forEach(function (entry, i) {
      /* One red top scorer, and never while every score is still zero. */
      var isTop = (i === 0 && entry.team.vp > 0);
      if (isTop) top = entry;
      body.appendChild(teamRow(entry, isTop));

      if (entry.seed === model.cutAfter) {
        body.appendChild(fullRow('mp99-cut-cell', 'PLAYOFF CUT LINE · ' + model.cutAfter + ' QUALIFY'));
        if (model.overflow) {
          body.appendChild(fullRow(
            'mp99-note-cell',
            model.overflow + (model.overflow === 1 ? ' team below the line is' : ' teams below the line are') +
            ' also on ' + model.overflowVp + ' Victory Points. The league tiebreaker decides the final place.'
          ));
        }
      }
    });
    return top;
  }

  function fail(message, detail) {
    var table = findTable();
    if (!table) return;
    clearBody(table);
    var body = table.tBodies[0] || table;
    var tr = fullRow('mp99-error-cell', message);
    body.appendChild(tr);
    if (detail) {
      var note = fullRow('mp99-note-cell', detail);
      body.appendChild(note);
    }
  }

  /* ------------------------------------------------------------------ */

  function start() {
    var ctx = readContext();
    if (!ctx) return; /* not a league home page */
    if (!findTable()) return; /* module not on this page */

    Promise.all([feed(ctx, 'league'), feed(ctx, 'leagueStandings')])
      .then(function (r) {
        var teams = buildTeams(r[0], r[1]);
        var model = tiers(teams);
        render(findTable(), model);
      })
      .catch(function (err) {
        if (err && err.noVp) {
          fail(
            'Standings unavailable — Victory Points are not published by MyFantasyLeague.',
            'The league has Victory Points configured, but they are not part of its standings display, ' +
            'so MFL does not return them. A commissioner can add Victory Points under Setup → Standings.'
          );
          return;
        }
        fail(
          'Standings unavailable — MyFantasyLeague did not respond.',
          err && err.message ? String(err.message) : ''
        );
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
