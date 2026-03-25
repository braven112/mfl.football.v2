import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { IdeaCategory, WebsiteFields, WebsiteSuggestionType } from '../../../types/suggestions';
import ImageUploader from './ImageUploader';
import ImageGallery from './ImageGallery';

interface SubmitData {
  title: string;
  body: string;
  category: IdeaCategory;
  websiteFields?: WebsiteFields;
  imageUrls?: string[];
}

interface Props {
  onSubmit: (data: SubmitData) => Promise<void>;
  /** Pre-fill for editing (free-form only) */
  initialTitle?: string;
  initialBody?: string;
  initialCategory?: IdeaCategory;
  /** Show cancel button when editing */
  onCancel?: () => void;
  submitLabel?: string;
}

const CATEGORY_OPTIONS: { value: IdeaCategory; label: string; spriteId: string }[] = [
  { value: 'rule-change', label: 'Rule Change', spriteId: 'icon-gavel' },
  { value: 'website', label: 'Website Suggestion', spriteId: 'icon-wrench' },
  { value: 'general', label: 'General Discussion', spriteId: 'icon-beer' },
];

export default function IdeaComposer({ onSubmit, initialTitle, initialBody, initialCategory, onCancel, submitLabel }: Props) {
  const [title, setTitle] = useState(initialTitle ?? '');
  const [category, setCategory] = useState<IdeaCategory>(initialCategory ?? 'rule-change');
  const [body, setBody] = useState(initialBody ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(!!(initialTitle || initialBody));

  // Image attachments
  const [imageUrls, setImageUrls] = useState<string[]>([]);

  // Website-specific fields
  const [wsType, setWsType] = useState<WebsiteSuggestionType>('feature');
  const [wsPage, setWsPage] = useState('');
  const [wsProblem, setWsProblem] = useState('');
  const [wsDesired, setWsDesired] = useState('');

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, []);

  useEffect(() => { autoResize(); }, [body, autoResize]);

  const isWebsite = category === 'website';

  const canSubmit = (() => {
    if (isSubmitting) return false;
    if (title.trim().length < 5) return false;
    if (isWebsite) {
      return wsPage.trim().length >= 2 && wsProblem.trim().length >= 10 && wsDesired.trim().length >= 10;
    }
    return body.trim().length >= 10;
  })();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      if (isWebsite) {
        const websiteFields: WebsiteFields = {
          type: wsType,
          pageOrFeature: wsPage.trim(),
          problem: wsProblem.trim(),
          desiredBehavior: wsDesired.trim(),
        };
        // Build a readable body from the structured fields for display/search
        const composedBody = `**Type:** ${wsType === 'bug' ? 'Bug Report' : 'Feature Request'}\n**Page/Feature:** ${websiteFields.pageOrFeature}\n\n**The Problem:**\n${websiteFields.problem}\n\n**Desired Behavior:**\n${websiteFields.desiredBehavior}`;
        await onSubmit({ title: title.trim(), body: composedBody, category, websiteFields, imageUrls: imageUrls.length > 0 ? imageUrls : undefined });
      } else {
        await onSubmit({ title: title.trim(), body: body.trim(), category, imageUrls: imageUrls.length > 0 ? imageUrls : undefined });
      }
      if (!initialTitle) {
        setTitle('');
        setBody('');
        setCategory('rule-change');
        setImageUrls([]);
        setWsType('feature');
        setWsPage('');
        setWsProblem('');
        setWsDesired('');
        setExpanded(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTitleFocus = () => {
    if (!expanded) setExpanded(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="sb-composer" onKeyDown={handleKeyDown}>
      <input
        className="sb-composer__title"
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onFocus={handleTitleFocus}
        placeholder="What's your idea?"
        maxLength={200}
        disabled={isSubmitting}
        aria-label="Idea title"
      />

      {expanded && (
        <>
          {/* Category picker */}
          <div className="sb-composer__categories" role="radiogroup" aria-label="Idea category">
            {CATEGORY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                className={`sb-category-pill${category === opt.value ? ' sb-category-pill--active' : ''}`}
                onClick={() => setCategory(opt.value)}
                role="radio"
                aria-checked={category === opt.value}
                disabled={isSubmitting}
              >
                <svg className="sb-category-pill__icon" aria-hidden="true"><use href={`/assets/icons/sprite.svg#${opt.spriteId}`} /></svg>
                {opt.label}
              </button>
            ))}
          </div>

          {isWebsite ? (
            /* ── Structured Website Suggestion Form ── */
            <div className="sb-ws-form">
              {/* Bug / Feature toggle */}
              <div className="sb-ws-form__row">
                <label className="sb-ws-form__label">Type</label>
                <div className="sb-ws-form__toggle">
                  <button
                    type="button"
                    className={`sb-ws-toggle${wsType === 'bug' ? ' sb-ws-toggle--active sb-ws-toggle--bug' : ''}`}
                    onClick={() => setWsType('bug')}
                    disabled={isSubmitting}
                  >
                    🐛 Bug
                  </button>
                  <button
                    type="button"
                    className={`sb-ws-toggle${wsType === 'feature' ? ' sb-ws-toggle--active sb-ws-toggle--feature' : ''}`}
                    onClick={() => setWsType('feature')}
                    disabled={isSubmitting}
                  >
                    ✨ Feature
                  </button>
                </div>
              </div>

              {/* Page / Feature */}
              <div className="sb-ws-form__row">
                <label className="sb-ws-form__label" htmlFor="ws-page">Page / Feature</label>
                <input
                  id="ws-page"
                  className="sb-ws-form__input"
                  type="text"
                  value={wsPage}
                  onChange={e => setWsPage(e.target.value)}
                  placeholder="e.g., Roster page, Trade Builder, Navigation"
                  maxLength={200}
                  disabled={isSubmitting}
                />
              </div>

              {/* The Problem */}
              <div className="sb-ws-form__row">
                <label className="sb-ws-form__label" htmlFor="ws-problem">
                  {wsType === 'bug' ? 'What\'s Happening' : 'The Problem'}
                </label>
                <textarea
                  id="ws-problem"
                  className="sb-ws-form__textarea"
                  value={wsProblem}
                  onChange={e => setWsProblem(e.target.value)}
                  placeholder={wsType === 'bug'
                    ? 'Describe what\'s broken or not working correctly...'
                    : 'What\'s missing, annoying, or could be better?'}
                  maxLength={3000}
                  rows={3}
                  disabled={isSubmitting}
                />
              </div>

              {/* Desired Behavior */}
              <div className="sb-ws-form__row">
                <label className="sb-ws-form__label" htmlFor="ws-desired">
                  {wsType === 'bug' ? 'What Should Happen' : 'Desired Behavior'}
                </label>
                <textarea
                  id="ws-desired"
                  className="sb-ws-form__textarea"
                  value={wsDesired}
                  onChange={e => setWsDesired(e.target.value)}
                  placeholder={wsType === 'bug'
                    ? 'Describe what should happen instead...'
                    : 'Describe what the feature should do...'}
                  maxLength={3000}
                  rows={3}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          ) : (
            /* ── Free-form body for rule-change and general ── */
            <div className="sb-composer__body-wrap">
              <textarea
                ref={bodyRef}
                className="sb-composer__body"
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={category === 'rule-change'
                  ? 'Describe the rule change you\'d like to propose...'
                  : 'Share your thoughts...'}
                maxLength={5000}
                rows={3}
                disabled={isSubmitting}
                aria-label="Idea description"
              />
              {body.length > 0 && (
                <span className="sb-composer__count">{body.length}/5000</span>
              )}
            </div>
          )}

          {/* Attached images preview */}
          {imageUrls.length > 0 && (
            <ImageGallery
              images={imageUrls.map(url => ({ url }))}
              onRemove={i => setImageUrls(prev => prev.filter((_, idx) => idx !== i))}
            />
          )}

          <div className="sb-composer__actions">
            <ImageUploader
              onUpload={url => setImageUrls(prev => [...prev, url])}
              disabled={isSubmitting}
            />
            {onCancel && (
              <button
                className="sb-composer__cancel"
                onClick={onCancel}
                type="button"
                disabled={isSubmitting}
              >
                Cancel
              </button>
            )}
            <button
              className="sb-composer__submit"
              onClick={handleSubmit}
              disabled={!canSubmit}
              type="button"
            >
              {isSubmitting ? (
                <>
                  <span className="sb-spinner" aria-hidden="true" />
                  Posting...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                  </svg>
                  {submitLabel ?? 'Post Idea'}
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
