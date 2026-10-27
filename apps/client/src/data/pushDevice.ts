/**
 * This device's notifications, in the browser (Web Push through public/sw.js). The Android app has
 * its own version (pushDevice.native.ts) with the same exports.
 */
import { deviceName } from './appVersion';
import type { Subscription, Support } from './pushTypes';

export type { Subscription, Support } from './pushTypes';

const installed = () => (navigator as { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
const apple = () => ['iPhone', 'iPad'].includes(deviceName(navigator.userAgent, navigator.maxTouchPoints));

/** iPhones and iPads get notifications only in the app added to the Home Screen (iOS 16.4 and later). */
export function support(): Support {
  if (typeof window === 'undefined') return 'unsupported';
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (apple() && !installed()) return 'install-first';
  return capable ? 'ok' : 'unsupported';
}

export async function permission(): Promise<'granted' | 'denied' | 'default'> {
  return support() === 'ok' ? Notification.permission : 'default';
}

/** "Mac browser", "iPhone app"… so people can tell their devices apart. */
export function label(): string {
  return `${deviceName(navigator.userAgent, navigator.maxTouchPoints)} ${installed() ? 'app' : 'browser'}`;
}

function key(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Asks for permission and subscribes this browser. Call it straight from the button press: Safari
 * only shows its question while the tap is still being handled, so nothing is awaited before it.
 * Null when the person says no.
 */
export async function subscribe(webPushKey: () => Promise<string | null>): Promise<Subscription | null> {
  const asked = await Notification.requestPermission();
  if (asked !== 'granted') return null;
  const k = await webPushKey();
  if (!k) throw new Error('Notifications aren’t set up on the server yet.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(k) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  return { kind: 'web', token: json.endpoint, keys: json.keys };
}

/** The current subscription, if this browser still has one (it can be dropped by clearing site data). */
export async function current(): Promise<Subscription | null> {
  if (support() !== 'ok' || Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return null;
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  return { kind: 'web', token: json.endpoint, keys: json.keys };
}

export async function unsubscribe(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration('/');
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
}

/** A tapped notification asks the open window to show a screen (public/sw.js posts it). */
export function onOpen(go: (url: string) => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  const listen = (e: MessageEvent) => {
    if (e.data?.type === 'splitify:open' && typeof e.data.url === 'string' && e.data.url.startsWith('/')) go(e.data.url);
  };
  navigator.serviceWorker.addEventListener('message', listen);
  return () => navigator.serviceWorker.removeEventListener('message', listen);
}
