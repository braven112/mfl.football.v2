import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { DrivingMessage } from '../../types/driving-chat';
import { DRIVING_TOPICS } from '../../data/driving-topics';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import TopicBrowser from './TopicBrowser';
import QuizMode from './QuizMode';

type Mode = 'chat' | 'quiz';

const WELCOME_MESSAGE: DrivingMessage = {
  id: 'welcome',
  role: 'assistant',
  content: `Hey James! 🐴🦀 I'm **Billy**, your driving coach. I'm here to help you crush that Washington State driver's license test — both the written knowledge test AND the behind-the-wheel drive test.

Here's what I can help with:

- **Ask me anything** about WA driving rules, road signs, right-of-way, speed limits, parking, and more
- **Quiz mode** — test yourself with random questions and I'll explain the answers
- **Browse topics** — pick a topic in the sidebar to focus your studying

The written test has **40 questions** and you need **80% (32 correct)** to pass. Let's make sure you're ready! What would you like to start with?`,
  createdAt: new Date().toISOString(),
};

export default function DrivingCoach() {
  const [mode, setMode] = useState<Mode>('chat');
  const [messages, setMessages] = useState<DrivingMessage[]>([WELCOME_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const generateId = () => 'msg_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  const sendMessage = useCallback(async (text: string) => {
    setIsLoading(true);
    setError(null);

    const userMsg: DrivingMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch('/api/driving-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, mode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        return;
      }

      const billyMsg: DrivingMessage = {
        id: generateId(),
        role: 'assistant',
        content: data.message,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, billyMsg]);
    } catch {
      setError('Failed to reach Billy. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [mode]);

  const handleTopicSelect = useCallback((topicId: string) => {
    setActiveTopic(prev => prev === topicId ? null : topicId);
    const topic = DRIVING_TOPICS.find(t => t.id === topicId);
    if (topic && mode === 'chat') {
      sendMessage(`Tell me the key things I need to know about "${topic.label}" for the WA driver's license test.`);
    }
  }, [mode, sendMessage]);

  const handleQuizAskBilly = useCallback((message: string) => {
    setMode('chat');
    sendMessage(message);
  }, [sendMessage]);

  return (
    <div className="dc">
      {/* Mode switcher */}
      <div className="dc__modes">
        <button
          className={`dc__mode-btn${mode === 'chat' ? ' dc__mode-btn--active' : ''}`}
          onClick={() => setMode('chat')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          Ask Billy
        </button>
        <button
          className={`dc__mode-btn${mode === 'quiz' ? ' dc__mode-btn--active' : ''}`}
          onClick={() => setMode('quiz')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3m.08 4h.01"/>
          </svg>
          Quiz Mode
        </button>
      </div>

      <div className="dc__layout">
        {/* Main content area */}
        <div className="dc__main">
          {mode === 'chat' ? (
            <>
              <div className="dc__chat-body" ref={chatBodyRef}>
                {messages.map((msg, i) => (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    isLatest={i === messages.length - 1 && msg.role === 'assistant'}
                  />
                ))}
                {isLoading && (
                  <div className="dc-msg dc-msg--assistant dc-msg--loading">
                    <div className="dc-msg__avatar">
                      <img src="/assets/driving/billy-avatar.png" alt="Billy" width="36" height="36" />
                    </div>
                    <div className="dc-msg__bubble">
                      <span className="dc-msg__name">Billy</span>
                      <div className="dc-msg__typing">
                        <span></span><span></span><span></span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {error && (
                <div className="dc__error" role="alert">
                  ⚠️ {error}
                </div>
              )}

              <ChatInput onSubmit={sendMessage} isLoading={isLoading} />
            </>
          ) : (
            <QuizMode
              onAskBilly={handleQuizAskBilly}
              isLoading={isLoading}
              topicFilter={activeTopic}
            />
          )}
        </div>

        {/* Sidebar */}
        <aside className="dc__sidebar">
          <div className="dc__billy-card">
            <img src="/assets/driving/billy-avatar.png" alt="Billy the driving coach" className="dc__billy-img" />
            <h3 className="dc__billy-name">Billy</h3>
            <p className="dc__billy-title">Your Driving Coach</p>
            <p className="dc__billy-desc">
              Part horse, part crab, 100% committed to getting you that Washington State driver's license. 🏎️
            </p>
          </div>

          <TopicBrowser
            topics={DRIVING_TOPICS}
            onSelectTopic={handleTopicSelect}
            activeTopic={activeTopic}
          />

          <div className="dc__test-info">
            <h3 className="dc__info-title">WA Knowledge Test</h3>
            <div className="dc__info-stats">
              <div className="dc__info-stat">
                <span className="dc__info-stat-value">40</span>
                <span className="dc__info-stat-label">Questions</span>
              </div>
              <div className="dc__info-stat">
                <span className="dc__info-stat-value">80%</span>
                <span className="dc__info-stat-label">To Pass</span>
              </div>
              <div className="dc__info-stat">
                <span className="dc__info-stat-value">32</span>
                <span className="dc__info-stat-label">Need Correct</span>
              </div>
            </div>
          </div>

          <div className="dc__resources">
            <h3 className="dc__info-title">Resources</h3>
            <a href="https://dol.wa.gov/driver-licenses-and-permits/driver-training-and-testing/driver-guides/washington-state-driver-guide-text-only" target="_blank" rel="noopener" className="dc__resource-link">
              📖 Official WA Driver Guide
            </a>
            <a href="https://dol.wa.gov/driver-licenses-and-permits/driver-training-and-testing/practice-knowledge-test" target="_blank" rel="noopener" className="dc__resource-link">
              📝 DOL Practice Test
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
