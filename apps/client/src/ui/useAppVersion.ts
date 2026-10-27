import { AppState, Linking, Platform } from 'react-native';
import { useSyncExternalStore } from 'react';
import app from '../../app.json';
import { fetchLatestApk, updateFor } from '../data/appUpdate';
import { deviceName, fetchWebVersion, webUpdateFor } from '../data/appVersion';

/** Which file this Android build is (eas.json: website-64bit / website-32bit). */
export const APK_BITS = process.env.EXPO_PUBLIC_APK_BITS === '32' ? '32' : '64';
/** Set by deploy/deploy.sh for each website build; missing on local runs. */
const WEB_BUILD = process.env.EXPO_PUBLIC_WEB_BUILD;

export interface AppVersion {
  version: string;
  /** "Android app", "iPhone app", "Windows browser"… */
  where: string;
  /** A newer version, and how to get it: a download on Android, a reload on the website. */
  update: { version: string; mb?: number; kind: 'download' | 'reload'; go: () => void } | null;
}

function where(): string {
  if (Platform.OS === 'android') return APK_BITS === '32' ? 'Android app (32-bit)' : 'Android app';
  if (Platform.OS !== 'web') return `${Platform.OS} app`;
  const installed = (navigator as { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  return `${deviceName(navigator.userAgent, navigator.maxTouchPoints)} ${installed ? 'app' : 'browser'}`;
}

// From app.json itself: on the website, Constants.expoConfig reports the package's version (1.0.0), not the app's.
let snapshot: AppVersion = { version: app.expo.version, where: '', update: null };
const listeners = new Set<() => void>();
let lastCheck = 0;

async function check() {
  // Opening the app and switching back to it both ask; once a minute is plenty.
  if (Date.now() - lastCheck < 60_000) return;
  lastCheck = Date.now();
  let update: AppVersion['update'] = null;
  if (Platform.OS === 'android' && snapshot.version) {
    const u = updateFor(await fetchLatestApk(), snapshot.version, APK_BITS);
    if (u) update = { version: u.version, mb: u.mb, kind: 'download', go: () => Linking.openURL(u.url).catch(() => {}) };
  } else if (Platform.OS === 'web') {
    // Scripts have content-hashed names and the page itself is never cached, so a reload is the update.
    const u = webUpdateFor(await fetchWebVersion(), WEB_BUILD);
    if (u) update = { version: u.version, kind: 'reload', go: () => window.location.reload() };
  }
  if (update?.version !== snapshot.update?.version || update?.kind !== snapshot.update?.kind) {
    snapshot = { ...snapshot, update };
    listeners.forEach((l) => l());
  }
}

let stop: (() => void) | null = null;
function start() {
  snapshot = { ...snapshot, where: where() };
  check();
  const every = setInterval(check, 30 * 60_000);
  if (Platform.OS === 'web') {
    const onShow = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(every);
      document.removeEventListener('visibilitychange', onShow);
    };
  }
  const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
  return () => {
    clearInterval(every);
    sub.remove();
  };
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!stop) stop = start();
  return () => {
    listeners.delete(l);
    if (!listeners.size && stop) {
      stop();
      stop = null;
    }
  };
}

/** The running version and any update, shared by every screen that shows them (one check for all). */
export function useAppVersion(): AppVersion {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
