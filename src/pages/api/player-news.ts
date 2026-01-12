import type { APIRoute } from 'astro';

export const prerender = false;

interface ESPNNewsItem {
  headline: string;
  description: string;
  published: string;
  links?: {
    web?: {
      href: string;
    };
  };
}

interface PlayerNewsResponse {
  playerId: string;
  playerName?: string;
  news: ESPNNewsItem | null;
  source: 'espn' | 'fallback' | 'none';
  error?: string;
}

/**
 * Fetch player news from ESPN's hidden API
 * Fallback to searching by player name if ESPN ID not available
 */
export const GET: APIRoute = async ({ url }) => {
  const playerId = url.searchParams.get('playerId');
  const playerName = url.searchParams.get('playerName');
  const espnId = url.searchParams.get('espnId');

  if (!playerId) {
    return new Response(JSON.stringify({ error: 'playerId parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let newsData: ESPNNewsItem | null = null;
    let source: 'espn' | 'fallback' | 'none' = 'none';

    // Strategy 1: Try ESPN ID if provided
    if (espnId) {
      try {
        const response = await fetch(
          `https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId=${espnId}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)',
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data?.articles && data.articles.length > 0) {
            const article = data.articles[0];
            newsData = {
              headline: article.headline || '',
              description: article.description || '',
              published: article.published || '',
              links: article.links,
            };
            source = 'espn';
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch news for ESPN ID ${espnId}:`, error);
      }
    }

    // Strategy 2: Try general NFL news feed and filter by player name
    if (!newsData && playerName) {
      try {
        const response = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)',
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data?.articles && data.articles.length > 0) {
            // Find article that mentions the player name
            const playerArticle = data.articles.find((article: any) =>
              article.headline?.toLowerCase().includes(playerName.toLowerCase())
            );

            if (playerArticle) {
              newsData = {
                headline: playerArticle.headline || '',
                description: playerArticle.description || '',
                published: playerArticle.published || '',
                links: playerArticle.links,
              };
              source = 'fallback';
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch news feed for ${playerName}:`, error);
      }
    }

    const response: PlayerNewsResponse = {
      playerId,
      playerName,
      news: newsData,
      source,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error('Error fetching player news:', error);
    return new Response(
      JSON.stringify({
        playerId,
        playerName,
        news: null,
        source: 'none',
        error: 'Failed to fetch player news',
      } as PlayerNewsResponse),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
