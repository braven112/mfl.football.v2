import React, { useState } from 'react';
import type { ImageAttachment } from '../../../types/suggestions';

interface Props {
  images: ImageAttachment[];
  /** Allow removing images (editing mode) */
  onRemove?: (index: number) => void;
}

export default function ImageGallery({ images, onRemove }: Props) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  if (!images || images.length === 0) return null;

  return (
    <>
      <div className="sb-gallery">
        {images.map((img, i) => (
          <div key={img.url} className="sb-gallery__item">
            <img
              src={img.url}
              alt={img.alt || 'Attached image'}
              className="sb-gallery__img"
              loading="lazy"
              onClick={() => setLightboxIdx(i)}
            />
            {onRemove && (
              <button
                type="button"
                className="sb-gallery__remove"
                onClick={e => { e.stopPropagation(); onRemove(i); }}
                title="Remove image"
                aria-label="Remove image"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <div
          className="sb-lightbox"
          onClick={() => setLightboxIdx(null)}
          role="dialog"
          aria-label="Image preview"
        >
          <img
            src={images[lightboxIdx].url}
            alt={images[lightboxIdx].alt || 'Full size image'}
            className="sb-lightbox__img"
          />
          <button
            type="button"
            className="sb-lightbox__close"
            onClick={() => setLightboxIdx(null)}
            aria-label="Close preview"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
