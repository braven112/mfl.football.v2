/**
 * WhatsNewCard - Clickable card for a single What's New entry.
 *
 * Displays thumbnail (or no image area), category badge, optional "NEW" dot,
 * icon + title, date, and a 2-line-clamped summary. The entire card is a link
 * to the entry's detail page.
 */
import type { EnrichedWhatsNewEntry } from '../../../utils/whats-new-helpers';
import { WHATS_NEW_CATEGORY_LABELS } from '../../../types/whats-new';

interface Props {
  entry: EnrichedWhatsNewEntry;
  featured?: boolean;
}

const MULTICOLOR_ICONS = ['nfl'];

export default function WhatsNewCard({ entry, featured }: Props) {
  const iconId = entry.icon ? `icon-${entry.icon}` : null;
  const isMulticolor = entry.icon ? MULTICOLOR_ICONS.includes(entry.icon) : false;
  const imagePath = entry.image ? `/assets/whats-new/${entry.image}` : null;

  return (
    <a
      href={`/theleague/whats-new/${entry.id}`}
      className={`wn-card wn-card--${entry.category}${featured ? ' wn-card--featured' : ''}`}
    >
      {imagePath && (
        <div className="wn-card__thumbnail">
          <img
            src={imagePath}
            alt={entry.imageAlt || entry.title}
            className="wn-card__thumbnail-img"
            loading="lazy"
          />
        </div>
      )}

      <div className="wn-card__content">
        <div className="wn-card__meta">
          <span className={`wn-card__badge wn-card__badge--${entry.category}`}>
            {WHATS_NEW_CATEGORY_LABELS[entry.category]}
          </span>
          {entry.isNew && (
            <span className="wn-card__new-badge" title="New since your last visit">
              <span className="wn-card__new-dot" aria-hidden="true" />
              NEW
            </span>
          )}
        </div>

        <div className="wn-card__header">
          {iconId && (
            <svg
              className={`wn-card__icon${isMulticolor ? ' wn-card__icon--multicolor' : ''}`}
              aria-hidden="true"
            >
              <use href={`/assets/icons/sprite.svg#${iconId}`} />
            </svg>
          )}
          <h3 className="wn-card__title">{entry.title}</h3>
        </div>

        <span className="wn-card__date">{entry.formattedDate}</span>

        <p className="wn-card__summary">{entry.summary}</p>

        <span className="wn-card__read-more" aria-hidden="true">
          Read more &rarr;
        </span>
      </div>
    </a>
  );
}
