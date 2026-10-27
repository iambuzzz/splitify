import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { api } from '../data/api';
import { remoteEnabled } from '../data/config';
import { uuidv7 } from '../data/ids';
import * as device from '../data/pushDevice';

/**
 * Notifications on this device: whether they're on, and this device's settings. One shared state
 * for the home screen's card and the Notifications screen. Settings are per device (phone on,
 * laptop off), kept on the server with the device and copied here.
 */

export type Kind = 'needs' | 'payments' | 'direct' | 'bills' | 'chat';
export const KINDS: { kind: Kind; title: string; hint: string; on: boolean }[] = [
  { kind: 'needs', title: 'Things for you to check', hint: 'Suggested changes, questions and disputes on your bills', on: true },
  { kind: 'payments', title: 'Payments', hint: 'Someone says they paid you, or confirms your payment', on: true },
  { kind: 'direct', title: 'Messages to you', hint: 'Settle-up chats', on: true },
  { kind: 'bills', title: 'New and changed bills', hint: 'Bills you’re in, gathered for two minutes', on: true },
  { kind: 'chat', title: 'Chat on bills', hint: 'Every message on a bill you’re in', on: false },
];

export interface Prefs {
  kinds: Partial<Record<Kind, boolean>>;
  muted: string[];
}
export interface NotificationsState {
  support: device.Support;
  status: 'loading' | 'off' | 'on' | 'blocked';
  prefs: Prefs;
  busy: boolean;
  error: string | null;
  /** "Not now" on the home screen card, until this time. */
  askAfter: number;
}

const SAVED = 'splitify.push';
const LATER = 'splitify.pushLater';
const EMPTY: Prefs = { kinds: {}, muted: [] };

let state: NotificationsState = { support: device.support(), status: 'loading', prefs: EMPTY, busy: false, error: null, askAfter: 0 };
let deviceId: string | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<NotificationsState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const save = () => AsyncStorage.setItem(SAVED, JSON.stringify({ id: deviceId, prefs: state.prefs })).catch(() => {});

const register = (sub: device.Subscription) =>
  remoteEnabled
    ? api.send('POST', '/push/devices', { id: deviceId, kind: sub.kind, token: sub.token, keys: sub.keys, label: device.label(), prefs: state.prefs })
    : Promise.resolve();

let starting: Promise<void> | null = null;
const start = () => (starting ??= load());
/** Reads what this device had, and refreshes its subscription with the server (tokens change now and then). */
async function load() {
  const [saved, later] = await Promise.all([
    AsyncStorage.getItem(SAVED).then((s) => (s ? (JSON.parse(s) as { id: string; prefs: Prefs }) : null)).catch(() => null),
    AsyncStorage.getItem(LATER).catch(() => null),
  ]);
  const askAfter = Number(later) || 0;
  if (state.support !== 'ok') return set({ status: 'off', askAfter });
  const perm = await device.permission().catch(() => 'default' as const);
  if (!saved?.id) return set({ status: perm === 'denied' ? 'blocked' : 'off', askAfter });
  deviceId = saved.id;
  const prefs = { ...EMPTY, ...saved.prefs };
  if (perm !== 'granted') {
    // Blocked in the browser or phone settings since: the server stops sending here.
    if (remoteEnabled) api.send('POST', `/push/devices/${deviceId}/delete`).catch(() => {});
    deviceId = null;
    await AsyncStorage.removeItem(SAVED).catch(() => {});
    return set({ status: perm === 'denied' ? 'blocked' : 'off', prefs: EMPTY, askAfter });
  }
  set({ status: 'on', prefs, askAfter });
  const sub = await device.current().catch(() => null);
  if (sub) register(sub).catch(() => {});
}

function subscribe(l: () => void) {
  listeners.add(l);
  start();
  return () => listeners.delete(l);
}

/** Straight from the button press (browsers ask for permission only while the tap is handled). */
export async function turnOn() {
  set({ busy: true, error: null });
  // The demo (no server) shows the screens without subscribing anything.
  if (!remoteEnabled) {
    deviceId = deviceId ?? uuidv7();
    await save();
    return set({ busy: false, status: 'on' });
  }
  try {
    const sub = await device.subscribe(async () => (await api.get('/push/config')).webPushKey as string | null);
    if (!sub) {
      const perm = await device.permission().catch(() => 'default' as const);
      return set({ busy: false, status: perm === 'denied' ? 'blocked' : 'off' });
    }
    deviceId = deviceId ?? uuidv7();
    await register(sub);
    await save();
    set({ busy: false, status: 'on' });
  } catch (err) {
    set({ busy: false, error: err instanceof Error ? err.message : 'Couldn’t turn notifications on. Try again.' });
  }
}

export async function turnOff() {
  set({ busy: true, error: null });
  try {
    if (deviceId && remoteEnabled) await api.send('POST', `/push/devices/${deviceId}/delete`);
    await device.unsubscribe().catch(() => {});
    deviceId = null;
    await AsyncStorage.removeItem(SAVED).catch(() => {});
    set({ busy: false, status: 'off', prefs: EMPTY });
  } catch (err) {
    set({ busy: false, error: err instanceof Error ? err.message : 'Couldn’t turn notifications off. Try again.' });
  }
}

export async function setPrefs(prefs: Prefs) {
  const before = state.prefs;
  set({ prefs, error: null });
  try {
    if (deviceId && remoteEnabled) await api.send('POST', `/push/devices/${deviceId}`, { prefs });
    await save();
  } catch (err) {
    set({ prefs: before, error: err instanceof Error ? err.message : 'Couldn’t save that. Try again.' });
  }
}

export const isOn = (prefs: Prefs, kind: Kind) => prefs.kinds[kind] ?? KINDS.find((k) => k.kind === kind)!.on;

/** "Not now" on the home screen card: ask again in two weeks. */
export function askLater() {
  const after = Date.now() + 14 * 24 * 3600_000;
  AsyncStorage.setItem(LATER, String(after)).catch(() => {});
  set({ askAfter: after });
}

/** Signing out: this device stops getting the person's notifications. */
export async function forgetThisDevice() {
  await start();
  if (!deviceId) return;
  const id = deviceId;
  deviceId = null;
  await AsyncStorage.removeItem(SAVED).catch(() => {});
  set({ status: 'off', prefs: EMPTY });
  if (remoteEnabled) await api.send('POST', `/push/devices/${id}/delete`).catch(() => {});
  await device.unsubscribe().catch(() => {});
}

export function useNotifications(): NotificationsState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
