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

    if (!window.ecrData || !window.ecrData.players) {
      alert('No FantasyPros ranking data found.\nMake sure you are on a FantasyPros rankings page.');
      return;
    }
    var d = window.ecrData;
    var type = 'overall';
    if (d.ranking_type_name === 'dynasty') type = 'dynasty';
    else if (d.ranking_type_name === 'draft' || d.ranking_type_name === 'ros') type = 'redraft';

    var players = d.players.map(function (p) {
      return {
        rank: p.rank_ecr,
        name: p.player_name,
        pos: p.player_position_id,
        team: p.player_team_id || '',
        tier: p.tier
      };
    });

    var output = JSON.stringify({
      source: 'fantasypros',
      type: type,
      exportedAt: new Date().toISOString(),
      players: players,
      metadata: { pageUrl: location.href }
    });

    if (!transferToImportPage(output, 'fantasypros', players.length)) {
      alert(
        'FantasyPros rankings extracted (' + players.length + ' players), but transfer failed.\n' +
        'Allow popups for this page and run the bookmarklet again.'
      );
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
})();
