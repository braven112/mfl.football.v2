# Trade Submission Feature Insights

## Auth Cookie Forwarding Pattern

**Key insight:** `user.id` in the session JWT IS the raw `MFL_USER_ID` cookie value from MFL login. API routes extract it via `getAuthUser(request)` and forward as `Cookie: MFL_USER_ID=${user.id}` to MFL. No separate cookie storage or re-authentication needed.

**Security note:** Do NOT send `user.id` to the client. It's an MFL session credential. The client never needs it — API routes re-authenticate from the httpOnly session cookie independently.

## MFL Trade API Endpoints

| Operation | Endpoint | Key Params |
|-----------|----------|------------|
| Submit proposal | `POST /import?TYPE=tradeProposal` | `OFFEREDTO`, `WILL_GIVE_UP`, `WILL_RECEIVE`, `COMMENTS` |
| Fetch pending | `GET /export?TYPE=pendingTrades` | `FRANCHISE_ID` (optional) |
| Accept/reject/withdraw | `POST /import?TYPE=tradeResponse` | `TRADE_ID`, `RESPONSE` (accept/reject/revoke) |

**MFL quirks:**
- `pendingTrades` returns single object (not array) when only one trade exists — must normalize
- Empty state returns `"pendingTrades": ""` (empty string), not null or empty array
- Asset strings may have trailing commas — strip with `.replace(/,\s*$/, '')`
- `JSON=1` in POST body is harmless noise on import endpoints (only useful for export/GET)
- MFL determines proposing franchise from the auth cookie, not from POST params

## MFL Pending Trade Field Mapping

```
MFL field → App field
t.id / t.trade_id → tradeId
t.franchise → offeredBy (padStart 4 with '0')
t.franchise2 → offeredTo (padStart 4 with '0')
t.franchise1_gave_up → willGiveUp
t.franchise2_gave_up → willReceive
t.timestamp → timestamp (unix)
t.expires → expires (unix)
t.comments → comments
t.by_commish → byCommish (=== '1')
```

## Error Handling Pattern for Trade Cards

Always use `try/catch/finally` (not just `try/finally`) when calling async action handlers in card-level components. The parent component (PendingTradesPanel) throws on failure to propagate errors — the card component must catch and display them locally. Without `catch`, errors are silently swallowed by `finally`.

## API Route Best Practices

- Add `Cache-Control: no-store` to all authenticated mutation/read endpoints
- MFL import endpoints don't benefit from `JSON=1` but it's harmless
- MFL error detection: check both XML (`<error>`) and JSON (`"error"` key) formats
- Delegate authorization to MFL (e.g., who can accept vs revoke) — MFL returns errors for invalid callers

## Trade Builder URL State

The trade builder already serializes state to URL params (`?a=0001&b=0012&ap=16610&bp=0515`). This is reused for login redirect — unauthenticated users clicking "Submit Trade" get redirected to `/theleague/login?returnUrl=...` with full trade state preserved.

## Overlay Click Safety

Gate overlay/backdrop `onClick` handlers on `!isSubmitting` during async operations to prevent accidental dismissal mid-flight. The cancel button already has `disabled={isSubmitting}` but the overlay needs the same protection.

## Cross-Origin Cookie Stripping (Critical Bug Fix — 2026-03-13)

Node.js undici strips Cookie headers on cross-origin 302 redirects. MFL's `api.myfantasyleague.com` redirects to `www49.myfantasyleague.com`, which silently drops the `MFL_USER_ID` cookie. All trade API routes MUST use `mflFetch()` from `src/utils/mfl-fetch.ts` instead of raw `fetch()` to preserve authentication across redirects.

## Franchise Validation in TradeConfirmationModal

The confirmation modal now validates that the authenticated user's franchise is part of the trade before allowing submission. Shows a "Proposing as [Team Name]" indicator and blocks submission with "Not Your Trade" if the user isn't a participant. The error message is placed in the footer (not the body) so it remains visible near the disabled button on mobile viewports.

## Draft Handlers: Presence-Check Was Silently Swallowing Failures (2026-07-06)

The draft handlers in `TradeBuilder.tsx` (`handleSaveDraft`/`handleDeleteDraft`/`handleRenameDraft`) followed the shape `const json = await res.json(); if (json.drafts) setDrafts(json.drafts);` inside a `try { ... } catch { /* silent */ }`. On any non-OK response from `/api/trades/drafts` (503 `Storage not configured` when Redis is unconfigured, 500 `Write failed`) the body has no `drafts` field, so the guard just no-ops and the UI never changes. Combined with the silent catch, a failed Save Draft looked identical to a success — users clicked repeatedly thinking the app was broken (hit in practice when a stale `.env.local` pointed KV at a dead host).

**Lesson:** `if (json.successField)` is not error handling — it silently drops the failure path. Branch explicitly on `res.ok && json.success`, and surface `json.error` (the drafts API already returns `{ success: false, error }`). For save, `TradeBuilder` shows a transient inline `.trade-builder__draft-error` banner plus `Saving…`/`Saved ✓` button states; for delete/rename, the handlers now `throw new Error(json.error)` so `PendingTradesPanel` catches and renders `.ptp-draft-error` in the Drafts section — the same parent-throws/child-catches contract already used for the accept/reject/revoke actions above. Error styling reuses the `.ptc-error`/`.tcm-error` token set (`--color-error`, `--color-error-light`, `--color-error-border`).

**Keep it non-blocking:** drafts are a convenience. Errors auto-clear (2s for `Saved ✓`, 6s for the error banner) and never disable the builder or block trade submission.
