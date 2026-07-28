/**
 * React equivalents of the shared loading primitives, for client-hydrated
 * islands. Emits the SAME class names as `src/styles/loading.css` and the
 * Astro components in this directory, so the one stylesheet applies in every
 * render context (the PlayerCell dual-pattern, extended to React).
 *
 * See docs/claude/loading-standards.md.
 */
import { useEffect, useState } from 'react';
import '../../../styles/loading.css';

export interface ThinkingDotsProps {
  /** Optional italic text shown before the dots. */
  label?: string;
  className?: string;
}

/** Tier 5 thinking dots — mirrors ThinkingDots.astro. */
export function ThinkingDots({ label, className = '' }: ThinkingDotsProps) {
  return (
    <span
      className={['loading-dots', className].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Working'}
    >
      {label && <span className="loading-dots__text">{label}</span>}
      <span className="loading-dots__dots" aria-hidden="true">
        <span className="loading-dots__dot" />
        <span className="loading-dots__dot" />
        <span className="loading-dots__dot" />
      </span>
    </span>
  );
}

export interface BrandedMomentProps {
  /** Headline shown under the pulsing mark. */
  title: string;
  /** Narration lines; multiple lines cycle every `cycleSeconds`. */
  narration: string[];
  /** Seconds between narration lines (default 2.5). */
  cycleSeconds?: number;
  /** Cover the positioned parent with the frosted backdrop. */
  overlay?: boolean;
  className?: string;
}

/**
 * Tier 5 branded "on the wire" moment — mirrors BrandedLoader.astro.
 * Narration cycles via `aria-label` updates on the polite live region (one
 * announcement per line, never per animation frame).
 */
export function BrandedMoment({
  title,
  narration,
  cycleSeconds = 2.5,
  overlay = false,
  className = '',
}: BrandedMomentProps) {
  const lines = narration.length ? narration : ['Hold tight…'];
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    if (lines.length < 2) return;
    const timer = window.setInterval(() => {
      setLineIndex((i) => (i + 1) % lines.length);
    }, Math.round(cycleSeconds * 1000));
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, cycleSeconds]);

  const line = lines[lineIndex % lines.length];

  return (
    <div
      className={['loading-branded', overlay ? 'loading-branded--overlay' : '', className]
        .filter(Boolean)
        .join(' ')}
      role="status"
      aria-live="polite"
      aria-label={`${title}. ${line}`}
    >
      <div className="loading-branded__mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M3 12h4l2-7 4 14 2-7h6"
            stroke="var(--league-accent, #1c497c)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className="loading-branded__title">{title}</p>
      <p className="loading-branded__narration">{line}</p>
    </div>
  );
}
