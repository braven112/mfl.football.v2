/**
 * Push alerts on the phone (package H, app half).
 *
 * The server owns what gets sent and to whom (src/utils/push-sender.ts and
 * push-watch.ts on the site): the phone only asks permission, hands the server
 * its Expo push token, and creates one Android channel per settings group so
 * an owner can mute "League news" in Android settings without losing trade
 * offers. The channel ids are the server's `channelId` values, typed against
 * the wire contract (@mfl/shared-types/mfl-live-app-push).
 *
 * Registration runs on every launch while signed in: the server re-reads the
 * account's leagues then, and it is what keeps the owner's alerts alive.
 * Every step fails quietly — alerts are never worth breaking the app for.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import type {
  MflLiveAppPushChannelId,
  MflLiveAppPushRegisterRequest,
  MflLiveAppPushResponse,
} from '@mfl/shared-types/mfl-live-app-push';
import { apiDelete, apiPost } from '../api';

/** The last Expo token this phone registered, so sign-out can remove it. */
const TOKEN_KEY = 'mfl-push-token';

/** Same names as the groups on the site's notifications page. */
const CHANNELS: Record<MflLiveAppPushChannelId, { name: string; importance: Notifications.AndroidImportance }> = {
  'your-team': { name: 'Your team', importance: Notifications.AndroidImportance.HIGH },
  'league-news': { name: 'League news', importance: Notifications.AndroidImportance.DEFAULT },
  live: { name: 'Game day', importance: Notifications.AndroidImportance.HIGH },
  ops: { name: 'Behind the scenes', importance: Notifications.AndroidImportance.LOW },
};

let configured = false;

/** Show alerts that arrive while the app is open, and create the channels. Safe to call twice. */
export async function configureNotifications(): Promise<void> {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS !== 'android') return;
  // Android 13+ only shows the permission prompt once a channel exists.
  for (const [id, channel] of Object.entries(CHANNELS)) {
    await Notifications.setNotificationChannelAsync(id, channel).catch(() => undefined);
  }
}

export type PushStatus = 'on' | 'denied' | 'unavailable';

/**
 * Ask permission (once — Android remembers a refusal), get this phone's Expo
 * token and register it with the server for the signed-in account.
 */
export async function registerForPush(sessionToken: string): Promise<PushStatus> {
  try {
    await configureNotifications();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return 'denied';

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const body: MflLiveAppPushRegisterRequest = { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' };
    const res = await apiPost<MflLiveAppPushResponse>(sessionToken, '/api/push/expo-register', body);
    if (!res.success) return 'unavailable';
    await SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => undefined);
    return 'on';
  } catch {
    // No Firebase config in this build, no network, or the server said no.
    return 'unavailable';
  }
}

/** Stop alerts to this phone. Called on sign-out, before the session is cleared. */
export async function unregisterForPush(sessionToken: string): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) return;
    await apiDelete<MflLiveAppPushResponse>(sessionToken, '/api/push/expo-register', { token });
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Signing out locally is what matters; the server drops a dead token on its next send.
  }
}

/** Ask the server to send this account a test alert. Resolves to the message to show. */
export async function sendTestAlert(sessionToken: string): Promise<string> {
  const status = await registerForPush(sessionToken);
  if (status === 'denied') return 'Alerts are off for MFL Football. Turn them on in Android settings, then try again.';
  if (status === 'unavailable') return 'This phone could not sign up for alerts just now.';
  try {
    const res = await apiPost<MflLiveAppPushResponse>(sessionToken, '/api/push/expo-test', {});
    return res.success ? 'Sent. It should arrive in a few seconds.' : res.message || 'The test alert did not send.';
  } catch (e) {
    return e instanceof Error ? e.message : 'The test alert did not send.';
  }
}
