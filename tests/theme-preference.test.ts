/**
 * Theme Preference Utilities Tests
 *
 * Tests:
 *   - isValidThemePreference validates all three valid values and rejects invalid ones
 *   - resolveTheme correctly maps all 6 combinations (3 prefs × 2 system states)
 *   - getClientThemePreference parses document.cookie correctly
 *   - setClientThemePreference writes expected cookie string
 *   - Server-side cookie functions are thin enough to be obviously correct (no unit tests)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isValidThemePreference,
  resolveTheme,
  getClientThemePreference,
  setClientThemePreference,
  THEME_COOKIE_NAME,
  type ThemePreference,
} from '../src/utils/theme-preference';

describe('theme-preference', () => {
  describe('isValidThemePreference', () => {
    it('accepts "light"', () => {
      expect(isValidThemePreference('light')).toBe(true);
    });

    it('accepts "dark"', () => {
      expect(isValidThemePreference('dark')).toBe(true);
    });

    it('accepts "auto"', () => {
      expect(isValidThemePreference('auto')).toBe(true);
    });

    it('rejects invalid strings', () => {
      expect(isValidThemePreference('sepia')).toBe(false);
      expect(isValidThemePreference('LIGHT')).toBe(false);
      expect(isValidThemePreference('light ')).toBe(false);
    });

    it('rejects undefined', () => {
      expect(isValidThemePreference(undefined)).toBe(false);
    });

    it('rejects null', () => {
      expect(isValidThemePreference(null)).toBe(false);
    });

    it('rejects numbers', () => {
      expect(isValidThemePreference(0)).toBe(false);
      expect(isValidThemePreference(1)).toBe(false);
    });

    it('rejects objects and arrays', () => {
      expect(isValidThemePreference({})).toBe(false);
      expect(isValidThemePreference([])).toBe(false);
    });
  });

  describe('resolveTheme', () => {
    it('resolves "light" to "light" regardless of system preference', () => {
      expect(resolveTheme('light', false)).toBe('light');
      expect(resolveTheme('light', true)).toBe('light');
    });

    it('resolves "dark" to "dark" regardless of system preference', () => {
      expect(resolveTheme('dark', false)).toBe('dark');
      expect(resolveTheme('dark', true)).toBe('dark');
    });

    it('resolves "auto" to "light" when system does not prefer dark', () => {
      expect(resolveTheme('auto', false)).toBe('light');
    });

    it('resolves "auto" to "dark" when system prefers dark', () => {
      expect(resolveTheme('auto', true)).toBe('dark');
    });
  });

  describe('getClientThemePreference', () => {
    let originalDocument: any;

    beforeEach(() => {
      // Save original document
      originalDocument = global.document;
    });

    afterEach(() => {
      // Restore original document
      global.document = originalDocument;
    });

    it('returns "auto" when document is undefined', () => {
      // @ts-ignore
      delete global.document;
      expect(getClientThemePreference()).toBe('auto');
    });

    it('returns "auto" when document.cookie is empty', () => {
      (global as any).document = { cookie: '' };
      expect(getClientThemePreference()).toBe('auto');
    });

    it('parses valid "light" value from cookie', () => {
      (global as any).document = { cookie: 'theme_pref=light' };
      expect(getClientThemePreference()).toBe('light');
    });

    it('parses valid "dark" value from cookie', () => {
      (global as any).document = { cookie: 'theme_pref=dark' };
      expect(getClientThemePreference()).toBe('dark');
    });

    it('parses valid "auto" value from cookie', () => {
      (global as any).document = { cookie: 'theme_pref=auto' };
      expect(getClientThemePreference()).toBe('auto');
    });

    it('handles URL-encoded cookie values', () => {
      (global as any).document = { cookie: `theme_pref=${encodeURIComponent('light')}` };
      expect(getClientThemePreference()).toBe('light');
    });

    it('returns "auto" when cookie value is invalid', () => {
      (global as any).document = { cookie: 'theme_pref=invalid' };
      expect(getClientThemePreference()).toBe('auto');
    });

    it('returns "auto" when cookie is absent but other cookies present', () => {
      (global as any).document = { cookie: 'foo=bar; baz=qux' };
      expect(getClientThemePreference()).toBe('auto');
    });

    it('finds theme_pref among multiple cookies', () => {
      (global as any).document = { cookie: 'foo=bar; theme_pref=dark; baz=qux' };
      expect(getClientThemePreference()).toBe('dark');
    });

    it('handles cookies with spaces around semicolons', () => {
      (global as any).document = { cookie: 'foo=bar ; theme_pref=light ; baz=qux' };
      expect(getClientThemePreference()).toBe('light');
    });

    it('returns "auto" on cookie parse errors', () => {
      (global as any).document = {
        get cookie() {
          throw new Error('Cookie access error');
        },
      };
      expect(getClientThemePreference()).toBe('auto');
    });
  });

  describe('setClientThemePreference', () => {
    let originalDocument: any;
    let originalWindow: any;

    beforeEach(() => {
      originalDocument = global.document;
      originalWindow = global.window;
    });

    afterEach(() => {
      global.document = originalDocument;
      global.window = originalWindow;
    });

    it('does nothing when document is undefined', () => {
      // @ts-ignore
      delete global.document;
      expect(() => setClientThemePreference('light')).not.toThrow();
    });

    it('writes cookie string with "light" value', () => {
      let setCookieValue = '';
      (global as any).document = {
        set cookie(value: string) {
          setCookieValue = value;
        },
      };
      (global as any).window = { location: { protocol: 'http:' } };

      setClientThemePreference('light');

      expect(setCookieValue).toContain('theme_pref=light');
    });

    it('writes cookie string with "dark" value', () => {
      let setCookieValue = '';
      (global as any).document = {
        set cookie(value: string) {
          setCookieValue = value;
        },
      };
      (global as any).window = { location: { protocol: 'http:' } };

      setClientThemePreference('dark');

      expect(setCookieValue).toContain('theme_pref=dark');
    });

    it('writes cookie string with "auto" value', () => {
      let setCookieValue = '';
      (global as any).document = {
        set cookie(value: string) {
          setCookieValue = value;
        },
      };
      (global as any).window = { location: { protocol: 'http:' } };

      setClientThemePreference('auto');

      expect(setCookieValue).toContain('theme_pref=auto');
    });

    it('includes max-age in cookie string', () => {
      let setCookieValue = '';
      (global as any).document = {
        set cookie(value: string) {
          setCookieValue = value;
        },
      };
      (global as any).window = { location: { protocol: 'http:' } };

      setClientThemePreference('light');

      expect(setCookieValue).toContain('max-age=');
    });

    it('includes path and SameSite in cookie string', () => {
      let setCookieValue = '';
      (global as any).document = {
        set cookie(value: string) {
          setCookieValue = value;
        },
      };
      (global as any).window = { location: { protocol: 'http:' } };

      setClientThemePreference('light');

      expect(setCookieValue).toContain('path=/');
      expect(setCookieValue).toContain('SameSite=Lax');
    });

    it('adds Secure flag when using HTTPS', () => {
      let setCookieValue = '';
      (global as any).document = {
        set cookie(value: string) {
          setCookieValue = value;
        },
      };
      (global as any).window = { location: { protocol: 'https:' } };

      setClientThemePreference('light');

      expect(setCookieValue).toContain('Secure');
    });

    it('does not add Secure flag when using HTTP', () => {
      let setCookieValue = '';
      (global as any).document = {
        set cookie(value: string) {
          setCookieValue = value;
        },
      };
      (global as any).window = { location: { protocol: 'http:' } };

      setClientThemePreference('light');

      expect(setCookieValue).not.toContain('Secure');
    });
  });
});
