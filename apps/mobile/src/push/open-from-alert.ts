/**
 * Tapping an alert opens the screen it is about, in its league: the server
 * names the screen in the notification's `data.screen` (src/utils/push-events.ts
 * on the site), and every such screen takes only `leagueId`.
 */

import { useEffect, useRef } from 'react';
import { createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import type { MflLiveAppPushData, MflLiveAppPushScreen } from '@mfl/shared-types/mfl-live-app-push';
import type { RootStackParamList } from '../navigation/types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const SCREENS: readonly MflLiveAppPushScreen[] = ['Draft', 'Trades', 'Transactions'];

/** The screen and league an alert's data points at, or null for anything else. */
export function alertTarget(data: unknown): { screen: MflLiveAppPushScreen; leagueId: string } | null {
  const d = (data ?? {}) as Partial<MflLiveAppPushData>;
  if (!d.screen || !SCREENS.includes(d.screen)) return null;
  if (typeof d.leagueId !== 'string' || !/^\d+$/.test(d.leagueId)) return null;
  return { screen: d.screen, leagueId: d.leagueId };
}

/** Call once inside the signed-in app; `ready` is the navigator's onReady state. */
export function useOpenFromAlert(ready: boolean): void {
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const target = alertTarget(response.notification.request.content.data);
    if (target && navigationRef.isReady()) navigationRef.navigate(target.screen, { leagueId: target.leagueId });
  }, [ready, response]);
}
