/**
 * SocialEmbed — Client-side renderer for Twitter/X and Instagram embeds.
 *
 * Uses the official widget scripts:
 *   - X/Twitter: platform.twitter.com/widgets.js → twttr.widgets.createTweet()
 *   - Instagram: instagram.com/embed.js → instgrm.Embeds.process()
 *
 * Scripts are loaded once per page and shared across all embed instances.
 * Shows a fallback link card until the widget hydrates, so users see *something*
 * even if the widget script fails (common on Twitter post-2023).
 */
import { useEffect, useRef, useState } from 'react';

type EmbedType = 'x' | 'instagram';

interface Props {
  type: EmbedType;
  url: string;
  /** For X: the tweet ID from the URL */
  tweetId?: string;
  /** For X: the username from the URL */
  username?: string;
}

// Shared script loaders — prevent duplicate loads across instances
let twitterScriptPromise: Promise<void> | null = null;
let instagramScriptPromise: Promise<void> | null = null;

type TwttrWidgets = {
  widgets: {
    createTweet(
      id: string,
      el: HTMLElement,
      opts?: Record<string, unknown>,
    ): Promise<HTMLElement | undefined>;
  };
};

type InstagramEmbeds = {
  Embeds: { process(): void };
};

function loadTwitterWidgets(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as unknown as { twttr?: TwttrWidgets }).twttr) return Promise.resolve();
  if (twitterScriptPromise) return twitterScriptPromise;

  twitterScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://platform.twitter.com/widgets.js';
    script.async = true;
    script.charset = 'utf-8';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Twitter widgets.js'));
    document.head.appendChild(script);
  });
  return twitterScriptPromise;
}

function loadInstagramEmbed(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as unknown as { instgrm?: InstagramEmbeds }).instgrm) return Promise.resolve();
  if (instagramScriptPromise) return instagramScriptPromise;

  instagramScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.instagram.com/embed.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Instagram embed.js'));
    document.head.appendChild(script);
  });
  return instagramScriptPromise;
}

/** Remove all child nodes from an element without using innerHTML */
function clearChildren(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export default function SocialEmbed({ type, url, tweetId, username }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');

  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    if (type === 'x' && tweetId) {
      loadTwitterWidgets()
        .then(async () => {
          if (cancelled) return;
          const twttr = (window as unknown as { twttr?: TwttrWidgets }).twttr;
          if (!twttr) {
            setState('failed');
            return;
          }
          // Clear fallback before injecting the widget
          clearChildren(el);
          const result = await twttr.widgets.createTweet(tweetId, el, {
            align: 'left',
            conversation: 'none',
            dnt: true,
            theme: 'light',
          });
          if (!cancelled) {
            setState(result ? 'loaded' : 'failed');
          }
        })
        .catch(() => {
          if (!cancelled) setState('failed');
        });
    } else if (type === 'instagram') {
      loadInstagramEmbed()
        .then(() => {
          if (cancelled) return;
          const instgrm = (window as unknown as { instgrm?: InstagramEmbeds }).instgrm;
          if (!instgrm) {
            setState('failed');
            return;
          }
          instgrm.Embeds.process();
          setState('loaded');
        })
        .catch(() => {
          if (!cancelled) setState('failed');
        });
    }

    return () => { cancelled = true; };
  }, [type, tweetId]);

  // Twitter/X: container is replaced with iframe when widget loads.
  // Fallback link card is shown until then (and stays on failure).
  if (type === 'x') {
    return (
      <div ref={containerRef} className="social-embed social-embed--x" data-state={state}>
        <a href={url} target="_blank" rel="noopener noreferrer" className="social-embed__fallback">
          <div className="social-embed__fallback-icon social-embed__fallback-icon--x">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </div>
          <div className="social-embed__fallback-info">
            <span className="social-embed__fallback-domain">@{username ?? 'X'}</span>
            <span className="social-embed__fallback-cta">
              {state === 'loading' ? 'Loading tweet…' : 'View on X'}
            </span>
          </div>
        </a>
      </div>
    );
  }

  // Instagram: use blockquote markup that their embed.js transforms in-place
  return (
    <div className="social-embed social-embed--instagram" data-state={state}>
      <blockquote
        className="instagram-media"
        data-instgrm-permalink={url}
        data-instgrm-version="14"
        style={{
          background: '#FFF',
          border: 0,
          borderRadius: '0.75rem',
          margin: '0.5rem 0 0',
          maxWidth: '540px',
          padding: 0,
          width: '100%',
        }}
      >
        <a href={url} target="_blank" rel="noopener noreferrer" className="social-embed__fallback">
          <div className="social-embed__fallback-icon social-embed__fallback-icon--instagram">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
            </svg>
          </div>
          <div className="social-embed__fallback-info">
            <span className="social-embed__fallback-domain">Instagram</span>
            <span className="social-embed__fallback-cta">
              {state === 'loading' ? 'Loading post…' : 'View on Instagram'}
            </span>
          </div>
        </a>
      </blockquote>
    </div>
  );
}
