/**
 * `summarizeMflPage` exists because three rounds of production logs on the AFL
 * waiver claim proved only that "a page came back". MFL re-renders its own form
 * when a transaction does not happen, so the response IS the diagnosis — but
 * `body.slice(0, 200)` on an XHTML page is doctype and `<head>`.
 */
import { describe, it, expect } from 'vitest';
import { summarizeMflPage } from '../src/utils/mfl-page-summary';

const PAGE = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">
<html><head>
<title>Fantasy Football: American Football League Add/Drop</title>
<style>.x { color: red }</style>
<script>var leagueId = '19621';</script>
</head>
<body>
  <p>Free agents are locked. Submit a waiver request instead.</p>
  <form action="add_drop" method="post">
    <input type="hidden" name="L" value="19621" />
    <input type="submit" name="SUBMIT" value="Submit Waiver Request" />
    <button name="CANCEL">Never mind</button>
  </form>
</body></html>`;

describe('summarizeMflPage', () => {
  it('names the page MFL decided to show', () => {
    expect(summarizeMflPage(PAGE).title).toBe('Fantasy Football: American Football League Add/Drop');
  });

  it('extracts the SUBMIT controls — the action MFL expects right now', () => {
    // The load-bearing field. During a locked waiver period the button is not
    // the one free agency shows, and that difference is the whole answer.
    expect(summarizeMflPage(PAGE).submits).toEqual(['SUBMIT=Submit Waiver Request', 'CANCEL=Never mind']);
  });

  it('returns visible copy with script, style and head stripped', () => {
    const { text } = summarizeMflPage(PAGE);
    expect(text).toContain('Free agents are locked. Submit a waiver request instead.');
    expect(text, 'script contents are not visible copy').not.toContain('leagueId');
    expect(text).not.toContain('color: red');
    expect(text).not.toContain('<');
  });

  it('truncates the excerpt and survives junk input', () => {
    expect(summarizeMflPage(PAGE, 20).text.length).toBeLessThanOrEqual(20);
    expect(summarizeMflPage('')).toEqual({ title: null, submits: [], text: '' });
    // No throw on a body that is not a page at all.
    expect(summarizeMflPage('<status>OK</status>').submits).toEqual([]);
  });
});
