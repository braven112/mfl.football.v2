import React, { useState, useCallback } from 'react';
import type { QuizQuestion, QuizState } from '../../types/driving-chat';

interface Props {
  onAskBilly: (message: string) => void;
  isLoading: boolean;
  topicFilter: string | null;
}

export default function QuizMode({ onAskBilly, isLoading, topicFilter }: Props) {
  const [quiz, setQuiz] = useState<QuizState>({
    currentQuestion: null,
    selectedAnswer: null,
    isRevealed: false,
    score: { correct: 0, total: 0 },
    topicFilter: null,
  });
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);

  const fetchQuestion = useCallback(async () => {
    setLoadingQuiz(true);
    setQuizError(null);
    try {
      const res = await fetch('/api/driving-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestQuiz: true, topic: topicFilter, mode: 'quiz' }),
      });
      const data = await res.json();
      if (data.quiz) {
        setQuiz(prev => ({
          ...prev,
          currentQuestion: data.quiz,
          selectedAnswer: null,
          isRevealed: false,
        }));
      }
    } catch {
      setQuizError('Couldn\'t load a question. Check your connection and try again.');
    } finally {
      setLoadingQuiz(false);
    }
  }, [topicFilter]);

  const handleAnswer = useCallback((index: number) => {
    if (quiz.isRevealed || !quiz.currentQuestion) return;
    const isCorrect = index === quiz.currentQuestion.correctIndex;
    setQuiz(prev => ({
      ...prev,
      selectedAnswer: index,
      isRevealed: true,
      score: {
        correct: prev.score.correct + (isCorrect ? 1 : 0),
        total: prev.score.total + 1,
      },
    }));
  }, [quiz.isRevealed, quiz.currentQuestion]);

  const handleAskBilly = useCallback(() => {
    if (!quiz.currentQuestion) return;
    const q = quiz.currentQuestion;
    const selected = quiz.selectedAnswer !== null ? q.options[quiz.selectedAnswer] : 'none';
    const correct = q.options[q.correctIndex];
    onAskBilly(
      `I just answered a quiz question: "${q.question}" — I picked "${selected}" but the correct answer is "${correct}". Can you explain this in more detail and help me remember it?`
    );
  }, [quiz.currentQuestion, quiz.selectedAnswer, onAskBilly]);

  const q = quiz.currentQuestion;

  return (
    <div className="dc-quiz">
      <div className="dc-quiz__header">
        <div className="dc-quiz__score">
          <span className="dc-quiz__score-label">Score</span>
          <span className="dc-quiz__score-value">
            {quiz.score.total > 0 ? (
              <>
                {quiz.score.correct}/{quiz.score.total}
                <span className="dc-quiz__score-pct">
                  {' '}({Math.round((quiz.score.correct / quiz.score.total) * 100)}%)
                </span>
              </>
            ) : '—'}
          </span>
          {quiz.score.total > 0 && (
            <span className="dc-quiz__score-note">
              Need 80% to pass the real test
            </span>
          )}
        </div>
        <button
          className="dc-quiz__new-btn"
          onClick={fetchQuestion}
          disabled={loadingQuiz}
        >
          {loadingQuiz ? 'Loading...' : q ? (quiz.isRevealed ? 'Next Question →' : 'Skip →') : '🎯 Start Quiz'}
        </button>
      </div>

      {quizError && (
        <div className="dc-quiz__error" role="alert">⚠️ {quizError}</div>
      )}

      {q ? (
        <div className="dc-quiz__question-card">
          <div className="dc-quiz__topic-badge">{q.source}</div>
          <p className="dc-quiz__question-text">{q.question}</p>
          <div className="dc-quiz__options" role="group" aria-label="Answer options">
            {q.options.map((opt, i) => {
              let className = 'dc-quiz__option';
              let ariaLabel = opt;
              if (quiz.isRevealed) {
                if (i === q.correctIndex) {
                  className += ' dc-quiz__option--correct';
                  ariaLabel = `${opt} — Correct answer`;
                } else if (i === quiz.selectedAnswer) {
                  className += ' dc-quiz__option--wrong';
                  ariaLabel = `${opt} — Your answer, incorrect`;
                } else {
                  className += ' dc-quiz__option--dimmed';
                }
              }

              return (
                <button
                  key={i}
                  className={className}
                  onClick={() => handleAnswer(i)}
                  disabled={quiz.isRevealed}
                  aria-label={ariaLabel}
                >
                  <span className="dc-quiz__option-letter">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="dc-quiz__option-text">{opt}</span>
                </button>
              );
            })}
          </div>

          {quiz.isRevealed && (
            <div
              className={`dc-quiz__result${quiz.selectedAnswer === q.correctIndex ? ' dc-quiz__result--correct' : ' dc-quiz__result--wrong'}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <p className="dc-quiz__result-icon">
                {quiz.selectedAnswer === q.correctIndex ? '🎯 Nailed it!' : '💡 Not quite — here\'s why:'}
              </p>
              <p className="dc-quiz__explanation">{q.explanation}</p>
              <div className="dc-quiz__actions">
                <button className="dc-quiz__ask-btn" onClick={handleAskBilly} disabled={isLoading}>
                  🐴 Ask Billy to explain more
                </button>
                <button className="dc-quiz__next-btn" onClick={fetchQuestion} disabled={loadingQuiz}>
                  Next Question →
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="dc-quiz__empty">
          <p>Ready to test your knowledge? Hit <strong>Start Quiz</strong> and let's see what you know! 🚗</p>
          <p>You need <strong>80% (32/40)</strong> to pass the real WA knowledge test.</p>
        </div>
      )}
    </div>
  );
}
