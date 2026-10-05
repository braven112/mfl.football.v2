/**
 * SaveIndicator — displays the save status of custom rankings.
 */

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

interface SaveIndicatorProps {
  status: SaveStatus;
  lastSaved?: string;
}

export default function SaveIndicator({ status, lastSaved }: SaveIndicatorProps) {
  let label: string;
  let className = 'cr-save';

  switch (status) {
    case 'saved':
      label = lastSaved ? `Saved ${formatTime(lastSaved)}` : 'All changes saved';
      className += ' cr-save--saved';
      break;
    case 'saving':
      label = 'Saving...';
      className += ' cr-save--saving';
      break;
    case 'unsaved':
      label = 'Unsaved changes';
      className += ' cr-save--unsaved';
      break;
    case 'error':
      label = 'Save failed';
      className += ' cr-save--error';
      break;
  }

  return <span className={className}>{label}</span>;
}

function formatTime(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;

    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}
