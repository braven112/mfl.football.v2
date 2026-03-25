import React from 'react';
import type { RulesQA } from '../../../types/rules-qa';

interface Props {
  qa: RulesQA;
  isNew?: boolean;
  isAdmin?: boolean;
  teamIcon?: string;
  onDelete?: (id: string) => void;
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
      const isBullet = line.startsWith('- ');
      const cleanLine = isBullet ? line.slice(2) : line;

      const parts: React.ReactNode[] = [];
      let remaining = cleanLine;
      let key = 0;

      while (remaining.length > 0) {
        const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
        const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
        const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);

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

export default function QACard({ qa, isNew, teamIcon, onDelete }: Props) {
  const askerName = qa.askedBy?.teamName ?? 'League Office';
  const isLeagueOffice = !qa.askedBy;

  return (
    <div className={`rqa-card${isNew ? ' rqa-card--new' : ''}`}>
      <div className="rqa-card__header">
        <div className={`rqa-card__avatar${isLeagueOffice ? ' rqa-card__avatar--office' : ''}`}>
          {isLeagueOffice ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          ) : teamIcon ? (
            <img src={teamIcon} alt="" width="32" height="32" className="rqa-card__team-icon" />
          ) : (
            <span>{qa.askedBy!.teamName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="rqa-card__meta">
          <span className="rqa-card__asker">{askerName}</span>
          <span className="rqa-card__time">{timeAgo(qa.createdAt)}</span>
        </div>
        {onDelete && (
          <button
            className="rqa-card__delete"
            onClick={() => onDelete(qa.id)}
            title="Delete this Q&A"
            aria-label="Delete this Q&A"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        )}
      </div>
      <div className="rqa-card__question">{qa.question}</div>
      <div className="rqa-card__answer">{renderAnswer(qa.answer)}</div>
    </div>
  );
}
