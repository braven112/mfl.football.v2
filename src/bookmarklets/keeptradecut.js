(function () {
  'use strict';
  try {
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

    // Read from the playersArray JS variable embedded in the page.
    // This contains ALL dynasty-ranked players — no pagination needed.
    var arr = typeof playersArray !== 'undefined' ? playersArray : null;

    if (!arr || !Array.isArray(arr) || arr.length === 0) {
      alert('No KeepTradeCut player data found.\nMake sure you are on the KTC dynasty rankings page.');
      return;
    }

    // Determine format from URL: superflex vs 1QB
    var isSuperFlex = location.search.indexOf('format=2') > -1 ||
                      location.search.indexOf('format=superflex') > -1;

    var validPos = { QB: 1, RB: 1, WR: 1, TE: 1 };
    var players = [];

    for (var i = 0; i < arr.length; i++) {
      var p = arr[i];
      if (!p.playerName || !p.position) continue;

      var pos = p.position.toUpperCase();
      // Skip draft picks (position "PI" or similar) and non-fantasy positions
      if (!validPos[pos]) continue;

      var vals = isSuperFlex ? p.superflexValues : p.oneQBValues;
      if (!vals || !vals.rank) continue;

      players.push({
        rank: vals.rank,
        name: p.playerName,
        pos: pos,
        team: (p.team || '').toUpperCase(),
        tier: vals.overallTier || undefined
      });
    }

    // Sort by rank to ensure correct order
    players.sort(function (a, b) { return a.rank - b.rank; });

    if (players.length === 0) {
      alert('Could not extract any players from the page data.');
      return;
    }

    var output = JSON.stringify({
      source: 'keeptradecut',
      type: 'dynasty',
      exportedAt: new Date().toISOString(),
      players: players,
      metadata: { pageUrl: location.href }
    });

    if (!transferToImportPage(output, 'keeptradecut', players.length)) {
      alert(
        'KTC rankings extracted (' + players.length + ' players), but transfer failed.\n' +
        'Allow popups for this page and run the bookmarklet again.'
      );
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
})();
