import React, { useRef, useState, useCallback } from 'react';

interface Props {
  onUpload: (url: string) => void;
  disabled?: boolean;
}

export default function ImageUploader({ onUpload, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);

    try {
      const form = new FormData();
      form.append('file', file);

      const res = await fetch('/api/suggestions/upload', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });

      // Handle non-JSON responses (e.g., Vercel auth redirects, 500 HTML pages)
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        setError(`Upload failed (${res.status})`);
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Upload failed (${res.status})`);
        return;
      }

      onUpload(data.url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Upload failed: ${msg}`);
    } finally {
      setUploading(false);
      // Reset input so same file can be re-selected
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [onUpload]);

  return (
    <div className="sb-uploader">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileChange}
        disabled={disabled || uploading}
        className="sb-uploader__input"
        aria-label="Upload image"
      />
      <button
        type="button"
        className="sb-uploader__btn"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        title="Attach image"
      >
        {uploading ? (
          <span className="sb-spinner" aria-hidden="true" />
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        )}
      </button>
      {error && <span className="sb-uploader__error">{error}</span>}
    </div>
  );
}
