import React from 'react';
import type { RulesQA } from '../../../types/rules-qa';

interface Props {
  qa: RulesQA;
  isNew?: boolean;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Minimal markdown → React rendering (bold, italic, links, line breaks) */
function renderAnswer(text: string): React.ReactNode[] {
  const paragraphs = text.split('\n\n');
  return paragraphs.map((para, i) => {
    const lines = para.split('\n');
    const content = lines.map((line, j) => {
      // Strip list marker if present
      const isBullet = line.startsWith('- ');
      const cleanLine = isBullet ? line.slice(2) : line;

      const parts: React.ReactNode[] = [];
      let remaining = cleanLine;
      let key = 0;

      while (remaining.length > 0) {
        // Match [text](url) links, **bold**, or *italic*
        const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
        const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
        const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);

        // Find the earliest match
        const candidates = [
          linkMatch && { type: 'link' as const, match: linkMatch, index: linkMatch.index! },
          boldMatch && { type: 'bold' as const, match: boldMatch, index: boldMatch.index! },
          italicMatch && { type: 'italic' as const, match: italicMatch, index: italicMatch.index! },
        ].filter(Boolean) as { type: 'link' | 'bold' | 'italic'; match: RegExpMatchArray; index: number }[];

        if (candidates.length === 0) {
          parts.push(remaining);
          break;
        }

        const earliest = candidates.sort((a, b) => a.index - b.index)[0];

        if (earliest.index > 0) {
          parts.push(remaining.slice(0, earliest.index));
        }

        if (earliest.type === 'link') {
          parts.push(<a key={key++} href={earliest.match[2]}>{earliest.match[1]}</a>);
        } else if (earliest.type === 'bold') {
          parts.push(<strong key={key++}>{earliest.match[1]}</strong>);
        } else {
          parts.push(<em key={key++}>{earliest.match[1]}</em>);
        }
        remaining = remaining.slice(earliest.index + earliest.match[0].length);
      }

      return (
        <React.Fragment key={j}>
          {j > 0 && <br />}
          {isBullet && '• '}
          {parts}
        </React.Fragment>
      );
    });
    return <p key={i} className="rqa-card__para">{content}</p>;
  });
}

export default function QACard({ qa, isNew }: Props) {
  const askerName = qa.askedBy?.teamName ?? 'League Office';
  const askerInitials = qa.askedBy
    ? qa.askedBy.teamName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : 'LO';
  const isLeagueOffice = !qa.askedBy;

  return (
    <div className={`rqa-card${isNew ? ' rqa-card--new' : ''}`}>
      <div className="rqa-card__header">
        <div className={`rqa-card__avatar${isLeagueOffice ? ' rqa-card__avatar--office' : ''}`}>
          {isLeagueOffice ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          ) : (
            <span>{askerInitials}</span>
          )}
        </div>
        <div className="rqa-card__meta">
          <span className="rqa-card__asker">{askerName}</span>
          <span className="rqa-card__time">{timeAgo(qa.createdAt)}</span>
        </div>
      </div>
      <div className="rqa-card__question">{qa.question}</div>
      <div className="rqa-card__answer">{renderAnswer(qa.answer)}</div>
    </div>
  );
}
