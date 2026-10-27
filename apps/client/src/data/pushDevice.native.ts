/**
 * This device's notifications in the Android app: Expo's push service, with Google's FCM underneath.
 * Same exports as the browser version (pushDevice.ts).
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Subscription, Support } from './pushTypes';

export type { Subscription, Support } from './pushTypes';

// With Splitify open, the screen already shows the change: no banner, only the list.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export function support(): Support {
  return Platform.OS === 'android' ? 'ok' : 'unsupported';
}

export async function permission(): Promise<'granted' | 'denied' | 'default'> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'default' : 'denied';
}

export function label(): string {
  return 'Android app';
}

async function token(): Promise<Subscription> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const t = await Notifications.getExpoPushTokenAsync({ projectId });
  return { kind: 'expo', token: t.data };
}

export async function subscribe(_webPushKey?: () => Promise<string | null>): Promise<Subscription | null> {
  // Android 8+ shows notifications through a channel; this is the one the server sends to.
  await Notifications.setNotificationChannelAsync('default', { name: 'Splitify', importance: Notifications.AndroidImportance.HIGH });
  const asked = await Notifications.requestPermissionsAsync();
  if (!asked.granted) return null;
  return token();
}

export async function current(): Promise<Subscription | null> {
  return (await permission()) === 'granted' ? token() : null;
}

export async function unsubscribe(): Promise<void> {
  // Nothing to undo on the phone: the server forgets the token.
}

export function onOpen(go: (url: string) => void): () => void {
  const open = (r: Notifications.NotificationResponse | null) => {
    const url = r?.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) go(url);
  };
  // Opened from a notification while the app was closed.
  Notifications.getLastNotificationResponseAsync().then(open, () => {});
  const sub = Notifications.addNotificationResponseReceivedListener(open);
  return () => sub.remove();
}
