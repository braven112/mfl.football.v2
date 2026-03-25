import React, { useState, useRef } from 'react';

interface Props {
  onSubmit: (question: string) => void;
  isLoading: boolean;
  hasCloseMatch: boolean;
  searchText: string;
  onSearchChange: (text: string) => void;
}

export default function AskInput({ onSubmit, isLoading, hasCloseMatch, searchText, onSearchChange }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSubmit = searchText.trim().length >= 10 && !hasCloseMatch && !isLoading;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(searchText.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="rqa-input">
      <div className="rqa-input__field-wrap">
        <textarea
          ref={inputRef}
          className="rqa-input__field"
          value={searchText}
          onChange={e => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search rules or ask a question..."
          maxLength={500}
          rows={1}
          disabled={isLoading}
          aria-label="Search rules or ask a question"
        />
        {searchText.length > 0 && (
          <span className="rqa-input__count">{searchText.length}/500</span>
        )}
      </div>
      {searchText.trim().length >= 10 && !hasCloseMatch && (
        <button
          className="rqa-input__submit"
          onClick={handleSubmit}
          disabled={!canSubmit}
          type="button"
        >
          {isLoading ? (
            <>
              <span className="rqa-input__spinner" aria-hidden="true" />
              Consulting the rulebook...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
              </svg>
              Ask Roger
            </>
          )}
        </button>
      )}
      {hasCloseMatch && searchText.trim().length >= 10 && (
        <p className="rqa-input__hint">
          Looks like this has been asked before — check the answer below.
        </p>
      )}
    </div>
  );
}
