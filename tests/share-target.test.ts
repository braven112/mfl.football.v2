/**
 * Guard: the Web Share Target that files an OS share into the tip form.
 *
 * Registering in the phone's share sheet is install-only — a website cannot
 * appear there at all. The risk is not the registration, it is what arrives:
 * whatever the source app put on the clipboard, in three fields whose
 * conventions no two apps agree on. Android hands a link over in `text` about
 * as often as in `url`, and plenty of apps repeat the page title verbatim in
 * both `title` and `text`.
 *
 * The result is a PREFILL: /api/schefter/tip needs a topic no share sheet can
 * supply and rate-limits to 3 tips per owner per day, so auto-filing would
 * spend a quota on something never confirmed.
 */

import { describe, it, expect } from 'vitest';
import { composeSharedTip, readSharedPayload } from '../src/utils/share-target';
import { TIP_TEXT_MAX } from '../src/types/schefter-tips';

describe('composeSharedTip', () => {
  it('joins the three fields into one draft', () => {
    expect(
      composeSharedTip({
        title: 'Rookie WR shopped',
        text: 'Hearing the Pigskins are listening on their 1st.',
        url: 'https://example.com/story',
      }),
    ).toBe(
      'Rookie WR shopped\n\nHearing the Pigskins are listening on their 1st.\n\nhttps://example.com/story',
    );
  });

  it('drops a title the text repeats verbatim', () => {
    // The common Android case: share a headline and get it twice.
    expect(composeSharedTip({ title: 'Big trade', text: 'Big trade' })).toBe('Big trade');
  });

  it('treats a case-different repeat as the same sentence', () => {
    expect(composeSharedTip({ title: 'Big Trade', text: 'big trade' })).toBe('Big Trade');
  });

  it('drops a url the text already contains', () => {
    // Android routinely puts the link inside `text` AND in `url`; printing it
    // twice wastes a third of the 500-character budget.
    expect(
      composeSharedTip({
        text: 'Look at this https://example.com/story',
        url: 'https://example.com/story',
      }),
    ).toBe('Look at this https://example.com/story');
  });

  it('ignores empty and whitespace-only fields', () => {
    expect(composeSharedTip({ title: '   ', text: 'Real tip', url: null })).toBe('Real tip');
    expect(composeSharedTip({ title: null, text: undefined, url: '' })).toBe('');
    expect(composeSharedTip({})).toBe('');
  });

  it('truncates rather than rejecting an oversized share', () => {
    // The owner is about to edit this anyway, and an empty box after a share
    // reads as the feature being broken.
    const long = composeSharedTip({ text: 'x'.repeat(TIP_TEXT_MAX + 250) });
    expect(long.length).toBe(TIP_TEXT_MAX);
  });

  it('keeps shared text as text — the caller renders it as a value, never markup', () => {
    // Pinned so a future "render the share as a preview" never reaches for
    // set:html: this string arrives from another app entirely.
    const hostile = '<img src=x onerror=alert(1)>';
    expect(composeSharedTip({ text: hostile })).toBe(hostile);
  });
});

describe('readSharedPayload', () => {
  it('reads the param names the manifests actually register', () => {
    // These three strings are a contract with public/manifest.json and the
    // AFL webmanifest — renaming one here silently breaks every share.
    const params = new URLSearchParams(
      'shared_title=Headline&shared_text=Body&shared_url=https%3A%2F%2Fexample.com',
    );
    expect(readSharedPayload(params)).toEqual({
      title: 'Headline',
      text: 'Body',
      url: 'https://example.com',
    });
  });

  it('returns nulls when nothing was shared', () => {
    expect(readSharedPayload(new URLSearchParams('target=0008'))).toEqual({
      title: null,
      text: null,
      url: null,
    });
  });
});
