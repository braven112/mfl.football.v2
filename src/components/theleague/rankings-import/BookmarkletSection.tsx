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
        Drag a bookmarklet to your bookmarks bar, or right-click it and choose "Add to Bookmarks." Then visit the rankings site and click it — your rankings will be copied to your clipboard.
      </p>
      <div className="bm-grid">
        {siteConfigs.map((site) => (
          <BookmarkletCard key={site.id} site={site} />
        ))}
      </div>
    </section>
  );
}
