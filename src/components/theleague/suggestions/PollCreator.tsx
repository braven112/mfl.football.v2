import React, { useState } from 'react';

interface Props {
  onCreatePoll: (options: string[], anonymous: boolean) => Promise<boolean>;
  onCancel: () => void;
}

export default function PollCreator({ onCreatePoll, onCancel }: Props) {
  const [options, setOptions] = useState(['', '']);
  const [anonymous, setAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = options.filter(o => o.trim().length > 0).length >= 2 && !isSubmitting;

  const handleAddOption = () => {
    if (options.length >= 10) return;
    setOptions([...options, '']);
  };

  const handleRemoveOption = (index: number) => {
    if (options.length <= 2) return;
    setOptions(options.filter((_, i) => i !== index));
  };

  const handleChangeOption = (index: number, value: string) => {
    setOptions(options.map((o, i) => i === index ? value : o));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const validOptions = options.filter(o => o.trim().length > 0).map(o => o.trim());
      await onCreatePoll(validOptions, anonymous);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="sb-poll-creator">
      <div className="sb-poll-creator__label">Create Poll</div>

      <div className="sb-poll-creator__options">
        {options.map((opt, i) => (
          <div key={i} className="sb-poll-creator__option-row">
            <input
              type="text"
              className="sb-poll-creator__input"
              value={opt}
              onChange={e => handleChangeOption(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              maxLength={100}
              disabled={isSubmitting}
            />
            {options.length > 2 && (
              <button
                type="button"
                className="sb-poll-creator__remove"
                onClick={() => handleRemoveOption(i)}
                disabled={isSubmitting}
                title="Remove option"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {options.length < 10 && (
        <button
          type="button"
          className="sb-poll-creator__add"
          onClick={handleAddOption}
          disabled={isSubmitting}
        >
          + Add option
        </button>
      )}

      <label className="sb-poll-creator__anon">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={e => setAnonymous(e.target.checked)}
          disabled={isSubmitting}
        />
        Anonymous voting (hide who voted for what)
      </label>

      <div className="sb-poll-creator__actions">
        <button className="sb-btn sb-btn--ghost" onClick={onCancel} type="button" disabled={isSubmitting}>
          Cancel
        </button>
        <button className="sb-btn sb-btn--primary" onClick={handleSubmit} disabled={!canSubmit} type="button">
          {isSubmitting ? 'Creating...' : 'Create Poll'}
        </button>
      </div>
    </div>
  );
}
