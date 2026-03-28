import React from 'react';
import type { DrivingTopic } from '../../types/driving-chat';

interface Props {
  topics: DrivingTopic[];
  onSelectTopic: (topicId: string) => void;
  activeTopic: string | null;
}

export default function TopicBrowser({ topics, onSelectTopic, activeTopic }: Props) {
  return (
    <div className="dc-topics">
      <h2 className="dc-topics__title">Study Topics</h2>
      <div className="dc-topics__grid">
        {topics.map(topic => (
          <button
            key={topic.id}
            className={`dc-topics__card${activeTopic === topic.id ? ' dc-topics__card--active' : ''}`}
            onClick={() => onSelectTopic(topic.id)}
            title={topic.description}
          >
            <span className="dc-topics__icon">{topic.icon}</span>
            <span className="dc-topics__label">{topic.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
