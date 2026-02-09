# MFL Auction API Documentation

This document details the specific API endpoints and response structures required for the **Live Auction Tracker** feature.

## 1. Auction Results Endpoint

**URL:** `https://api.myfantasyleague.com/2025/export?TYPE=auctionResults&L=13522&JSON=1`

### Description
Returns both **completed** auction results and **active** auctions currently in progress. This is the primary data source for the live tracker.

### Response Structure

```json
{
  "version": "1.0",
  "auctionResults": {
    "auctionUnit": {
      "unit": "LEAGUE",
      "auction": [
        {
          "player": "15240",           // Player ID
          "franchise": "0001",         // High bidder / Winner
          "winningBid": "1500000",     // Current bid amount
          "timeStarted": "1710000000", // Timestamp
          "lastBidTime": "1710003600", // Timestamp of last bid
          "timeToLive": "43200",       // Seconds remaining (ACTIVE auctions only)
          "status": "active"           // (Hypothetical field, MFL often implies this via timeToLive)
        },
        {
          "player": "14835",
          "franchise": "0002",
          "winningBid": "425000",
          "timeStarted": "1709900000",
          "lastBidTime": "1709950000",
          // Missing timeToLive implies completed auction
        }
      ]
    }
  }
}
```

### Key Fields Analysis

| Field | Type | Description |
|-------|------|-------------|
| `player` | string | MFL Player ID. Join with `players.json` for name/pos. |
| `franchise` | string | Franchise ID of high bidder. |
| `winningBid` | string | Current high bid amount. |
| `timeToLive` | string | **Critical for Live Tracking.** If present, auction is active. Value is seconds remaining. If missing/null, auction is closed. |
| `lastBidTime` | string | Timestamp of the most recent bid. Used to detect new activity. |

## 2. Derived States

Based on the API response, we derive the following states for our UI:

### A. Active Auction
*   **Condition:** `timeToLive` is present and `> 0`.
*   **UI Display:** Show in "On The Block" section.
*   **Highlight:** "Current High Bidder" vs "You have been outbid".

### B. Recently Completed
*   **Condition:** `timeToLive` is missing, and `lastBidTime` is within the last 24 hours (or current session window).
*   **UI Display:** Show in "Recent Activity" log.
*   **Action:** Verify if this matches a `targetPlayer` from our budget planner.

### C. Historical/Closed
*   **Condition:** `timeToLive` is missing, `lastBidTime` is old.
*   **UI Display:** Show in "Transaction History" or ignore.

## 3. Polling Strategy

*   **Frequency:** Every 15-60 seconds.
*   **Optimization:** Use `JSON=1` for lighter payload.
*   **Authentication:** `auctionResults` is typically a public endpoint, but we may need `APIKEY` or cookies if the league is private. Since we use `fetch-mfl-feeds.mjs` successfully, we likely have read access.

## 4. Mock Data for Development

See `data/theleague/mocks/auction-response.json` for a simulated response containing:
1.  One active auction (bidding war in progress).
2.  One recently completed auction (just sold).
3.  Several historical auctions.
