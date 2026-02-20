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

    // Yahoo uses data-tst attributes for player info
    var playerDivs = document.querySelectorAll('[data-tst="player"]');
    if (!playerDivs || playerDivs.length === 0) {
      alert('No Yahoo player data found.\nMake sure you are on a Yahoo Fantasy Football Draft Analysis or ADP page.');
      return;
    }

    var players = [];
    for (var i = 0; i < playerDivs.length; i++) {
      var div = playerDivs[i];

      // Player name from data-tst="player-name"
      var nameEl = div.querySelector('[data-tst="player-name"]');
      if (!nameEl) continue;
      var name = nameEl.textContent.trim();

      // Position from data-tst="player-position" (e.g. "QB")
      var posEl = div.querySelector('[data-tst="player-position"]');
      var pos = posEl ? posEl.textContent.trim().toUpperCase() : '';

      // Team from text before the dash: "Buf - QB" → "Buf"
      var team = '';
      var infoDiv = posEl ? posEl.closest('div') : null;
      if (infoDiv) {
        var infoText = infoDiv.textContent.trim();
        var teamMatch = infoText.match(/^(\w{2,3})\s*-/);
        if (teamMatch) {
          team = teamMatch[1].toUpperCase();
        }
      }

      players.push({ rank: players.length + 1, name: name, pos: pos, team: team });
    }

    if (players.length === 0) {
      alert('Could not extract any players from the page.');
      return;
    }

    var output = JSON.stringify({
      source: 'yahoo',
      type: 'adp',
      exportedAt: new Date().toISOString(),
      players: players,
      metadata: { pageUrl: location.href }
    });

    if (!transferToImportPage(output, 'yahoo', players.length)) {
      alert(
        'Yahoo ADP extracted (' + players.length + ' players), but transfer failed.\n' +
        'Allow popups for this page and run the bookmarklet again.'
      );
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
})();
