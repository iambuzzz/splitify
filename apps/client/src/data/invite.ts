import { Platform } from 'react-native';

/**
 * An invite link opened before signing in: kept in this browser while the person signs in (the
 * emailed link may open in a new tab), then the app goes back to /join.
 */
const KEY = 'splitify.pendingInvite';

const storage = (): Storage | null => {
  try {
    return Platform.OS === 'web' && typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function rememberInviteFromUrl(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || window.location.pathname !== '/join') return;
  const t = new URLSearchParams(window.location.hash.slice(1)).get('t');
  try {
    if (t) storage()?.setItem(KEY, t);
  } catch {}
}

/**
 * Any other deep link opened before signing in (e.g. a settle page from a WhatsApp reminder): kept
 * the same way, so the app goes back there even when the emailed sign-in link opens on the home page.
 */
const RETURN_KEY = 'splitify.returnTo';
const OWN_PAGE = /^\/[^/\\]/;

export function rememberReturnPath(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const path = window.location.pathname;
  if (!OWN_PAGE.test(path) || path === '/join' || path.startsWith('/auth/')) return;
  try {
    storage()?.setItem(RETURN_KEY, path);
  } catch {}
}

export function takeReturnPath(): string | null {
  try {
    const s = storage();
    const path = s?.getItem(RETURN_KEY) ?? null;
    s?.removeItem(RETURN_KEY);
    return path && OWN_PAGE.test(path) ? path : null;
  } catch {
    return null;
  }
}

export function takePendingInvite(): string | null {
  try {
    const s = storage();
    const t = s?.getItem(KEY) ?? null;
    s?.removeItem(KEY);
    return t;
  } catch {
    return null;
  }
}
