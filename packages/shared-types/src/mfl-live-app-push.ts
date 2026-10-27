/**
 * Push notifications in the MFL Football app — the wire contract between
 * `/api/push/expo-register`, `/api/push/expo-test` and `apps/mobile`.
 *
 * The server's own types (src/utils/push-expo.ts) must stay assignable to
 * these; `src/types/mfl-live-app-push-contract.ts` checks that at type-check
 * time. Types only: the app imports this with `import type`.
 */

export type MflLiveAppPushPlatform = 'android' | 'ios';

/**
 * Android notification channel ids — one per settings group on the site's
 * notifications page. The app must create every one of these at start-up.
 */
export type MflLiveAppPushChannelId = 'your-team' | 'league-news' | 'live' | 'ops';

/** POST /api/push/expo-register (and the DELETE body, platform optional). */
export interface MflLiveAppPushRegisterRequest {
  /** From `Notifications.getExpoPushTokenAsync()`, e.g. `ExponentPushToken[…]`. */
  token: string;
  platform: MflLiveAppPushPlatform;
}

export interface MflLiveAppPushResponse {
  success: boolean;
  /** Human-readable reason when `success` is false. */
  message?: string;
  /**
   * Register only. False when the signed-in league has no alert senders yet
   * (a league this site does not run), so the app can say so instead of
   * leaving the owner waiting for alerts that will not come.
   */
  delivering?: boolean;
}

/** The `data` object on every notification the server sends the app. */
export interface MflLiveAppPushData {
  /** Notification category id (the site's settings registry). */
  category: string;
  /** MFL league id the alert is about. */
  leagueId: string;
  /** Site-relative path the alert links to on the website. */
  url?: string;
  /** Alerts with the same tag replace each other. */
  tag?: string;
}
