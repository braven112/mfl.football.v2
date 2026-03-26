import React, { useState, useRef, useEffect, useCallback } from 'react';

interface GifResult {
  id: string;
  url: string;
  preview: string;
  alt: string;
}

interface Props {
  onSelect: (url: string) => void;
  disabled?: boolean;
}

export default function GifPicker({ onSelect, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // Focus input when opening
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/suggestions/gif-search?q=${encodeURIComponent(q)}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Search failed');
        return;
      }
      setResults(data.results || []);
    } catch {
      setError('Search failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  }, [search]);

  const handleSelect = useCallback((gif: GifResult) => {
    console.log('[GifPicker] selected:', gif.url);
    onSelect(gif.url);
    setOpen(false);
    setQuery('');
    setResults([]);
  }, [onSelect]);

  return (
    <div className="sb-gif-picker" ref={popoverRef}>
      <button
        type="button"
        className="sb-gif-btn"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        title="Add GIF"
        aria-label="Search for a GIF"
      >
        GIF
      </button>

      {open && (
        <div className="sb-gif-popover">
          <input
            ref={inputRef}
            type="text"
            className="sb-gif-search"
            placeholder="Search GIFs..."
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
          />

          <div className="sb-gif-results">
            {loading && (
              <div className="sb-gif-loading">
                <span className="sb-spinner" aria-hidden="true" />
                Searching...
              </div>
            )}

            {error && <div className="sb-gif-error">{error}</div>}

            {!loading && !error && results.length === 0 && query.trim() && (
              <div className="sb-gif-empty">No GIFs found</div>
            )}

            {!loading && results.length > 0 && (
              <div className="sb-gif-grid">
                {results.map(gif => (
                  <button
                    key={gif.id}
                    type="button"
                    className="sb-gif-thumb"
                    onClick={() => handleSelect(gif)}
                    title={gif.alt || 'Select GIF'}
                  >
                    <img src={gif.preview} alt={gif.alt} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="sb-gif-attribution">
            Powered by <strong>GIPHY</strong>
          </div>
        </div>
      )}
    </div>
  );
}
