import React, { useRef, useState, useCallback } from 'react';

interface Props {
  onUpload: (url: string) => void;
  disabled?: boolean;
}

const MAX_DIMENSION = 1600; // Max width or height in pixels
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB after compression
const QUALITY = 0.82; // WebP quality

/**
 * Compress an image client-side using canvas.
 * Resizes to MAX_DIMENSION, converts to WebP, targets under MAX_FILE_SIZE.
 */
async function compressImage(file: File): Promise<{ blob: Blob; name: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Scale down if larger than max dimension
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round(height * (MAX_DIMENSION / width));
          width = MAX_DIMENSION;
        } else {
          width = Math.round(width * (MAX_DIMENSION / height));
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }

      ctx.drawImage(img, 0, 0, width, height);

      // Try WebP first, fall back to JPEG
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('Compression failed')); return; }

          // If still too large, reduce quality further
          if (blob.size > MAX_FILE_SIZE) {
            canvas.toBlob(
              (smallerBlob) => {
                if (!smallerBlob) { reject(new Error('Compression failed')); return; }
                const ext = smallerBlob.type === 'image/webp' ? 'webp' : 'jpg';
                const name = file.name.replace(/\.[^.]+$/, '') + '.' + ext;
                resolve({ blob: smallerBlob, name });
              },
              'image/webp',
              0.6,
            );
          } else {
            const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
            const name = file.name.replace(/\.[^.]+$/, '') + '.' + ext;
            resolve({ blob, name });
          }
        },
        'image/webp',
        QUALITY,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

export default function ImageUploader({ onUpload, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Invalid file type. Use JPEG, PNG, WebP, or GIF.');
      return;
    }

    setError(null);
    setUploading(true);

    try {
      // Auto-compress: resize + convert to WebP
      let uploadBlob: Blob;
      let uploadName: string;

      if (file.type === 'image/gif') {
        // Don't compress GIFs (animated), just enforce size
        if (file.size > MAX_FILE_SIZE) {
          setError('GIF too large. Maximum 2MB for animated images.');
          return;
        }
        uploadBlob = file;
        uploadName = file.name;
      } else {
        const compressed = await compressImage(file);
        uploadBlob = compressed.blob;
        uploadName = compressed.name;
      }

      // Upload via Vercel Blob client SDK (bypasses 4.5MB serverless limit)
      try {
        const { upload } = await import('@vercel/blob/client');
        const blob = await upload(uploadName, uploadBlob, {
          access: 'public',
          handleUploadUrl: '/api/suggestions/upload',
        });
        onUpload(blob.url);
      } catch {
        // Fallback: POST to our API for environments without client upload
        const form = new FormData();
        form.append('file', uploadBlob, uploadName);

        const res = await fetch('/api/suggestions/upload', {
          method: 'POST',
          credentials: 'include',
          body: form,
        });

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
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Upload failed: ${msg}`);
    } finally {
      setUploading(false);
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
