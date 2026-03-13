import { useState, useEffect, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────
interface EspnArticle {
  headline: string;
  description: string;
  published: string;
  links: { web?: { href?: string } };
  images?: { url: string; width?: number; height?: number }[];
  type: string;
}

interface TrendingPlayer {
  name: string;
  position: string;
  team: string;
  count: number;
}

// ── Constants ──────────────────────────────────────────────
const ESPN_NEWS_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=12';
const TRENDING_API_URL = '/api/news/trending';
const CACHE_KEY_ESPN = 'mfl_espn_news';
const CACHE_KEY_TRENDING = 'mfl_sleeper_trending';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Helpers ────────────────────────────────────────────────
function readCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return data as T;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* quota exceeded — ignore */ }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Component ──────────────────────────────────────────────
export default function NewsFeed() {
  const [articles, setArticles] = useState<EspnArticle[]>([]);
  const [trending, setTrending] = useState<TrendingPlayer[]>([]);
  const [loadingNews, setLoadingNews] = useState(true);
  const [loadingTrending, setLoadingTrending] = useState(true);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [trendingError, setTrendingError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'news' | 'trending'>('news');

  // Fetch ESPN news
  const fetchNews = useCallback(async () => {
    const cached = readCache<EspnArticle[]>(CACHE_KEY_ESPN);
    if (cached) {
      setArticles(cached);
      setLoadingNews(false);
      return;
    }
    try {
      const res = await fetch(ESPN_NEWS_URL);
      if (!res.ok) throw new Error(`ESPN ${res.status}`);
      const json = await res.json();
      const items: EspnArticle[] = json.articles ?? [];
      setArticles(items);
      writeCache(CACHE_KEY_ESPN, items);
    } catch (err: unknown) {
      setNewsError(err instanceof Error ? err.message : 'Failed to load news');
    } finally {
      setLoadingNews(false);
    }
  }, []);

  // Fetch Sleeper trending via our API route
  const fetchTrending = useCallback(async () => {
    const cached = readCache<TrendingPlayer[]>(CACHE_KEY_TRENDING);
    if (cached) {
      setTrending(cached);
      setLoadingTrending(false);
      return;
    }
    try {
      const res = await fetch(TRENDING_API_URL);
      if (!res.ok) throw new Error(`Trending ${res.status}`);
      const data: TrendingPlayer[] = await res.json();
      setTrending(data);
      writeCache(CACHE_KEY_TRENDING, data);
    } catch (err: unknown) {
      setTrendingError(err instanceof Error ? err.message : 'Failed to load trending');
    } finally {
      setLoadingTrending(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
    fetchTrending();
  }, [fetchNews, fetchTrending]);

  return (
    <div className="nf" role="complementary" aria-label="NFL News Feed">
      {/* Tab bar */}
      <div className="nf__tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'news'}
          className={`nf__tab ${activeTab === 'news' ? 'nf__tab--active' : ''}`}
          onClick={() => setActiveTab('news')}
        >
          Latest News
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'trending'}
          className={`nf__tab ${activeTab === 'trending' ? 'nf__tab--active' : ''}`}
          onClick={() => setActiveTab('trending')}
        >
          Trending Players
        </button>
      </div>

      {/* News panel */}
      {activeTab === 'news' && (
        <div className="nf__panel" role="tabpanel">
          {loadingNews && <SkeletonList count={5} />}
          {newsError && <ErrorMsg msg={newsError} onRetry={fetchNews} />}
          {!loadingNews && !newsError && articles.length === 0 && (
            <p className="nf__empty">No articles available right now.</p>
          )}
          <ul className="nf__list">
            {articles.map((a, i) => (
              <li key={i} className="nf__article">
                <a
                  href={a.links?.web?.href ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nf__article-link"
                >
                  {a.images?.[0]?.url && (
                    <img
                      src={a.images[0].url}
                      alt=""
                      className="nf__article-img"
                      loading="lazy"
                    />
                  )}
                  <div className="nf__article-body">
                    <span className="nf__article-headline">{a.headline}</span>
                    <span className="nf__article-meta">
                      <span className="nf__source">ESPN</span>
                      {a.published && (
                        <span className="nf__time">{timeAgo(a.published)}</span>
                      )}
                    </span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Trending panel */}
      {activeTab === 'trending' && (
        <div className="nf__panel" role="tabpanel">
          {loadingTrending && <SkeletonList count={8} />}
          {trendingError && <ErrorMsg msg={trendingError} onRetry={fetchTrending} />}
          {!loadingTrending && !trendingError && trending.length === 0 && (
            <p className="nf__empty">No trending data available right now.</p>
          )}
          <ol className="nf__trending-list">
            {trending.map((p, i) => (
              <li key={i} className="nf__trending-row">
                <span className="nf__trending-rank">{i + 1}</span>
                <span className="nf__trending-info">
                  <span className="nf__trending-name">{p.name}</span>
                  <span className="nf__trending-meta">
                    {p.position} · {p.team || 'FA'}
                  </span>
                </span>
                <span className="nf__trending-count" title="Adds in last 24h">
                  +{p.count.toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
          <p className="nf__attribution">
            Data from <strong>Sleeper</strong> — adds in last 24 hours
          </p>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────
function SkeletonList({ count }: { count: number }) {
  return (
    <div className="nf__skeletons" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="nf__skeleton-row" />
      ))}
    </div>
  );
}

function ErrorMsg({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="nf__error">
      <p>{msg}</p>
      <button onClick={onRetry} className="nf__retry-btn">Retry</button>
    </div>
  );
}
