import React from 'react';
import type { DrivingMessage } from '../../types/driving-chat';

interface Props {
  message: DrivingMessage;
  isLatest?: boolean;
}

/** Minimal markdown → React rendering (bold, italic, links, line breaks, emoji-safe) */
function renderContent(text: string): React.ReactNode[] {
  const paragraphs = text.split('\n\n');
  return paragraphs.map((para, i) => {
    const lines = para.split('\n');
    const content = lines.map((line, j) => {
      const isBullet = line.startsWith('- ') || line.startsWith('• ');
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
        if (earliest.index > 0) parts.push(remaining.slice(0, earliest.index));

        if (earliest.type === 'link') {
          parts.push(<a key={key++} href={earliest.match[2]} target="_blank" rel="noopener">{earliest.match[1]}</a>);
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
          {isBullet && <span className="dc-bullet">•</span>}
          {parts}
        </React.Fragment>
      );
    });
    return <p key={i} className="dc-msg__para">{content}</p>;
  });
}

export default function ChatMessage({ message, isLatest }: Props) {
  const isBilly = message.role === 'assistant';

  return (
    <div className={`dc-msg dc-msg--${message.role}${isLatest ? ' dc-msg--latest' : ''}`}>
      {isBilly && (
        <div className="dc-msg__avatar">
          <img src="/assets/driving/billy-avatar.png" alt="Billy" width="36" height="36" />
        </div>
      )}
      <div className="dc-msg__bubble">
        {isBilly && <span className="dc-msg__name">Billy</span>}
        <div className="dc-msg__content">{renderContent(message.content)}</div>
      </div>
    </div>
  );
}
