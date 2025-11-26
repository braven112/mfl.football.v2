/**
 * Login Form Component
 * Handles username/password input and submission
 */

import React, { useState } from 'react';

export default function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          username,
          password,
          leagueId: leagueId || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      // Redirect to theleague on success
      window.location.href = '/theleague';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      {error && (
        <div style={styles.errorBox}>
          <p style={styles.errorText}>{error}</p>
        </div>
      )}

      <div style={styles.formGroup}>
        <label htmlFor="username" style={styles.label}>
          Username
        </label>
        <input
          id="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter your MFL username"
          required
          disabled={isLoading}
          style={styles.input}
        />
      </div>

      <div style={styles.formGroup}>
        <label htmlFor="password" style={styles.label}>
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your MFL password"
          required
          disabled={isLoading}
          style={styles.input}
        />
      </div>

      <div style={styles.formGroup}>
        <label htmlFor="leagueId" style={styles.label}>
          League ID (optional)
        </label>
        <input
          id="leagueId"
          type="text"
          value={leagueId}
          onChange={(e) => setLeagueId(e.target.value)}
          placeholder="Leave blank to use default league"
          disabled={isLoading}
          style={styles.input}
        />
        <p style={styles.helperText}>
          Your league ID (e.g., 13522 from the league URL)
        </p>
      </div>

      <button
        type="submit"
        disabled={isLoading || !username || !password}
        style={{
          ...styles.button,
          opacity: isLoading || !username || !password ? 0.6 : 1,
          cursor: isLoading || !username || !password ? 'not-allowed' : 'pointer',
        }}
      >
        {isLoading ? 'Signing in...' : 'Sign In'}
      </button>

      <p style={styles.disclaimer}>
        Your credentials are securely transmitted and validated only with MyFantasyLeague.com. We never store your password.
      </p>
    </form>
  );
}

const styles = {
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1.5rem',
  },
  errorBox: {
    padding: '1rem',
    backgroundColor: '#fee',
    border: '1px solid #fcc',
    borderRadius: '4px',
    color: '#c33',
  },
  errorText: {
    margin: 0,
    fontSize: '0.95rem',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.5rem',
  },
  label: {
    fontSize: '0.95rem',
    fontWeight: 500 as const,
    color: '#333',
  },
  input: {
    padding: '0.75rem',
    fontSize: '1rem',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  },
  helperText: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#666',
  },
  button: {
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    fontWeight: 600 as const,
    backgroundColor: '#0066cc',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    marginTop: '0.5rem',
  },
  disclaimer: {
    margin: 0,
    fontSize: '0.8rem',
    color: '#999',
    textAlign: 'center' as const,
  },
};
