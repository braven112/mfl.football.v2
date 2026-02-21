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

    var rows = document.querySelectorAll('.single-ranking');
    if (!rows || rows.length === 0) {
      alert('No KeepTradeCut rankings found.\nMake sure you are on the KTC dynasty rankings page.');
      return;
    }

    var players = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var rankEl = row.querySelector('.rank-number');
      var nameEl = row.querySelector('.player-name a');
      var teamEl = row.querySelector('.player-name .player-team');
      var posEl = row.querySelector('.position-team .position');

      if (!nameEl) continue;

      var rank = rankEl ? parseInt(rankEl.textContent.trim(), 10) : players.length + 1;
      var name = nameEl.textContent.trim();
      var team = teamEl ? teamEl.textContent.trim() : '';

      // Position comes as "RB1", "WR3" etc — strip the number
      var posText = posEl ? posEl.textContent.trim() : '';
      var pos = posText.replace(/\d+/g, '');

      players.push({ rank: rank, name: name, pos: pos, team: team });
    }

    if (players.length === 0) {
      alert('Could not extract any players from the page.');
      return;
    }

    // Note: KTC paginates 50 at a time. Let user know.
    var note = players.length < 100
      ? '\nNote: KTC shows 50 players per page. Navigate to the next page and run again to get more.'
      : '';

    var output = JSON.stringify({
      source: 'keeptradecut',
      type: 'dynasty',
      exportedAt: new Date().toISOString(),
      players: players,
      metadata: { pageUrl: location.href }
    });

    if (!transferToImportPage(output, 'keeptradecut', players.length)) {
      alert(
        'KTC rankings extracted (' + players.length + ' players), but transfer failed.' + note + '\n' +
        'Allow popups for this page and run the bookmarklet again.'
      );
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
})();
