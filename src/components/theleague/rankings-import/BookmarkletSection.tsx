import type { BookmarkletSiteConfig } from '../../../types/rankings-import';
import BookmarkletCard from './BookmarkletCard';

interface Props {
  siteConfigs: BookmarkletSiteConfig[];
}

export default function BookmarkletSection({ siteConfigs }: Props) {
  return (
    <section className="ri-section">
      <h2 className="ri-section__title">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
        Get Bookmarklets
      </h2>
      <p className="ri-section__desc">
        Bookmarklets scrape rankings directly from your favorite sites by creating a special bookmark in your browser. Drag a bookmark button below to your bookmarks bar (or right-click and choose "Add to Bookmarks"), then visit the site and click it to import.
        <span className="ri-section__note">Desktop only — bookmarklets require a browser with a bookmarks bar. On mobile, use the Sleeper button above.</span>
      </p>
      <div className="bm-grid">
        {siteConfigs.map((site) => (
          <BookmarkletCard key={site.id} site={site} />
        ))}
      </div>
    </section>
  );
}
