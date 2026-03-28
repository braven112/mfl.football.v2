import React, { useRef, useCallback } from 'react';

interface Props {
  onSubmit: (message: string) => void;
  isLoading: boolean;
  placeholder?: string;
}

export default function ChatInput({ onSubmit, isLoading, placeholder = 'Ask Billy anything about driving...' }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const value = textareaRef.current?.value.trim();
    if (!value || isLoading) return;
    onSubmit(value);
    if (textareaRef.current) {
      textareaRef.current.value = '';
      textareaRef.current.style.height = 'auto';
    }
  }, [onSubmit, isLoading]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  return (
    <div className="dc-input">
      <div className="dc-input__wrapper">
        <textarea
          ref={textareaRef}
          className="dc-input__textarea"
          placeholder={placeholder}
          rows={1}
          maxLength={1000}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          disabled={isLoading}
          aria-label="Type your driving question"
        />
        <button
          className="dc-input__send"
          onClick={handleSubmit}
          disabled={isLoading}
          title="Send message"
          aria-label="Send message"
        >
          {isLoading ? (
            <svg className="dc-input__spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4m0 12v4m-7.07-3.07l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          )}
        </button>
      </div>
      <p className="dc-input__hint">Press Enter to send · Shift+Enter for new line</p>
    </div>
  );
}
