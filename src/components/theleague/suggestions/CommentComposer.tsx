import React, { useState, useRef, useCallback, useEffect } from 'react';
import ImageUploader from './ImageUploader';
import ImageGallery from './ImageGallery';

interface Props {
  onSubmit: (body: string, imageUrls?: string[]) => Promise<boolean>;
  placeholder?: string;
  onCancel?: () => void;
}

export default function CommentComposer({ onSubmit, placeholder, onCancel }: Props) {
  const [body, setBody] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  useEffect(() => { autoResize(); }, [body, autoResize]);

  const canSubmit = (body.trim().length >= 1 || imageUrls.length > 0) && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const ok = await onSubmit(body.trim(), imageUrls.length > 0 ? imageUrls : undefined);
      if (ok) {
        setBody('');
        setImageUrls([]);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="sb-comment-composer">
      <textarea
        ref={textareaRef}
        className="sb-comment-composer__input"
        value={body}
        onChange={e => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Add a comment...'}
        maxLength={3000}
        rows={1}
        disabled={isSubmitting}
        aria-label="Write a comment"
      />
      {imageUrls.length > 0 && (
        <ImageGallery
          images={imageUrls.map(url => ({ url }))}
          onRemove={i => setImageUrls(prev => prev.filter((_, idx) => idx !== i))}
        />
      )}
      <div className="sb-comment-composer__actions">
        <ImageUploader
          onUpload={url => setImageUrls(prev => [...prev, url])}
          disabled={isSubmitting}
        />
        {onCancel && (
          <button className="sb-btn sb-btn--small sb-btn--ghost" onClick={onCancel} type="button">
            Cancel
          </button>
        )}
        <button
          className="sb-btn sb-btn--small sb-btn--primary"
          onClick={handleSubmit}
          disabled={!canSubmit}
          type="button"
        >
          {isSubmitting ? 'Posting...' : 'Reply'}
        </button>
      </div>
    </div>
  );
}
