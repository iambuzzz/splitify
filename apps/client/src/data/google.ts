import { Platform } from 'react-native';
import { config } from './config';

/**
 * Google sign-in on the web, without Supabase's redirect: Google sends the browser straight back to
 * our own /auth/google (so its screen names our site, not the Supabase project), with an ID token
 * after `#`. The app then signs in to Supabase with that token (signInWithIdToken).
 *
 * Google gets the SHA-256 of a one-time nonce and Supabase the nonce itself, so a token can only be
 * used by the tab that asked for it; `state` ties the answer to this tab as well.
 */
const KEY = 'splitify.googleSignIn';
export const GOOGLE_RETURN_PATH = '/auth/google';

export const googleConfigured = () => Platform.OS === 'web' && !!config.googleClientId;

const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Leaves the page for Google's account picker. */
export async function startGoogleSignIn(): Promise<void> {
  const nonce = randomHex(32);
  const state = randomHex(16);
  sessionStorage.setItem(KEY, JSON.stringify({ nonce, state }));
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.googleClientId!,
    redirect_uri: window.location.origin + GOOGLE_RETURN_PATH,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce: await sha256Hex(nonce),
    state,
    prompt: 'select_account',
  }).toString();
  window.location.assign(url.toString());
}

export type GoogleReturn = { idToken: string; nonce: string } | { error: 'cancelled' | 'failed' };

/** Back from Google: the token (once; then cleared from the address bar), or why there is none. */
export function takeGoogleReturn(): GoogleReturn | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || window.location.pathname !== GOOGLE_RETURN_PATH) return null;
  const p = new URLSearchParams(window.location.hash.slice(1));
  window.history.replaceState(null, '', '/');
  let saved: { nonce?: string; state?: string } = {};
  try {
    saved = JSON.parse(sessionStorage.getItem(KEY) ?? '{}');
    sessionStorage.removeItem(KEY);
  } catch {}
  if (p.get('error')) return { error: p.get('error') === 'access_denied' ? 'cancelled' : 'failed' };
  const idToken = p.get('id_token');
  if (!idToken || !saved.nonce || !saved.state || p.get('state') !== saved.state) return { error: 'failed' };
  return { idToken, nonce: saved.nonce };
}
