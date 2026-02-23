import { useEffect, useRef } from 'react';
import type { BookmarkletSiteConfig } from '../../../types/rankings-import';

interface Props {
  site: BookmarkletSiteConfig;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: '#068050',
  medium: '#b45309',
  hard: '#dc2626',
};

export default function BookmarkletCard({ site }: Props) {
  const bookmarkletLinkRef = useRef<HTMLAnchorElement | null>(null);
  const runtimeOrigin = typeof window !== 'undefined'
    ? window.location.origin
    : 'https://www.theleague.us';
  const runtimeImportUrl = `${runtimeOrigin}/theleague/import-rankings`;
  const bookmarkletHref = site.bookmarkletUri
    .replaceAll('__MFL_IMPORT_ORIGIN__', encodeURIComponent(runtimeOrigin))
    .replaceAll('__MFL_IMPORT_URL__', encodeURIComponent(runtimeImportUrl));

  useEffect(() => {
    if (!bookmarkletLinkRef.current) return;
    // React sanitizes javascript: href values in JSX; set it directly on the DOM node.
    bookmarkletLinkRef.current.setAttribute('href', bookmarkletHref);
  }, [bookmarkletHref]);

  return (
    <div className="bm-card">
      <div className="bm-card__header">
        <span className="bm-card__name">{site.name}</span>
        <div className="bm-card__badges">
          <span
            className="bm-card__badge"
            style={{ background: DIFFICULTY_COLORS[site.difficulty], color: '#fff' }}
          >
            {site.difficulty}
          </span>
          {site.requiresAuth && (
            <span className="bm-card__badge bm-card__badge--auth">login</span>
          )}
        </div>
      </div>

      <p className="bm-card__desc">{site.description}</p>

      <div className="bm-card__instructions">
        <strong>How to use:</strong> {site.instructions}
      </div>

      {site.requiresAuth && site.authNote && (
        <p className="bm-card__auth-note">{site.authNote}</p>
      )}

      <div className="bm-card__actions">
        <a
          ref={bookmarkletLinkRef}
          href="#"
          className="bm-card__drag-link"
          title="Drag to your bookmarks bar, or right-click → Add to Bookmarks"
          onClick={(e) => {
            e.preventDefault();
            alert(
              `To install this bookmarklet:\n\n` +
              `• Drag the "${site.bookmarkletLabel}" link to your bookmarks bar\n` +
              `• Or right-click it and choose "Add to Bookmarks" / "Bookmark This Link"\n\n` +
              `Then visit ${site.name} and click the bookmark — your rankings will be automatically imported.`,
            );
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          {site.bookmarkletLabel}
        </a>
      </div>

      {site.links && site.links.length > 0 && (
        <div className="bm-card__links">
          {site.links.map((link, i) =>
            link.type ? (
              <a
                key={i}
                href={link.url}
                className={`bm-card__rankings-btn bm-card__rankings-btn--${link.type}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
              </a>
            ) : (
              <a
                key={i}
                href={link.url}
                className="bm-card__site-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label} &rarr;
              </a>
            )
          )}
        </div>
      )}
    </div>
  );
}
