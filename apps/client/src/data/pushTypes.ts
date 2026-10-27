/** Shared by pushDevice.ts (browsers) and pushDevice.native.ts (the Android app). */
export type Support = 'ok' | 'install-first' | 'unsupported';
export interface Subscription {
  kind: 'web' | 'expo';
  token: string;
  keys?: { p256dh: string; auth: string };
}
