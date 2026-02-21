(function () {
  'use strict';
  function transferToImportPage(payload, source, count) {
    var importBaseUrl = '__MFL_IMPORT_URL__';

    function toBase64Utf8(str) {
      return btoa(unescape(encodeURIComponent(str)));
    }

    var envelope = {
      version: 3,
      source: source,
      playerCount: count,
      payload: payload,
      pageUrl: location.href,
      transferredAt: new Date().toISOString()
    };

    var encoded = encodeURIComponent(toBase64Utf8(JSON.stringify(envelope)));
    var separator = importBaseUrl.indexOf('#') > -1 ? '&' : '#';
    var targetUrl = importBaseUrl + separator + 'bm=' + encoded;

    var tab = window.open(targetUrl, '_blank');
    if (tab) return true;

    try {
      window.location.href = targetUrl;
      return true;
    } catch (err) {
      return false;
    }
  }

  alert('Fetching Sleeper player data... this may take a few seconds.');
  fetch('https://api.sleeper.app/v1/players/nfl')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      // Filter to relevant positions and sort by search_rank
      var validPositions = { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DEF: 1 };
      var entries = Object.values(data)
        .filter(function (p) {
          return p.active && validPositions[p.position] && p.search_rank && p.search_rank < 9999;
        })
        .sort(function (a, b) { return (a.search_rank || 9999) - (b.search_rank || 9999); })
        .slice(0, 500); // Top 500

      var players = entries.map(function (p, idx) {
        return {
          rank: idx + 1,
          name: (p.first_name + ' ' + p.last_name).trim(),
          pos: p.position,
          team: p.team || ''
        };
      });

      var output = JSON.stringify({
        source: 'sleeper',
        type: 'adp',
        exportedAt: new Date().toISOString(),
        players: players,
        metadata: { pageUrl: 'https://api.sleeper.app/v1/players/nfl' }
      });

      if (!transferToImportPage(output, 'sleeper', players.length)) {
        alert(
          'Sleeper rankings extracted (' + players.length + ' players), but transfer failed.\n' +
          'Allow popups for this page and run the bookmarklet again.'
        );
      }
    })
    .catch(function (e) {
      alert('Failed to fetch Sleeper data: ' + e.message);
    });
})();
