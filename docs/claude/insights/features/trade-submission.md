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
