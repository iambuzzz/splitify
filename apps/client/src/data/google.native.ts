import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytes } from 'expo-crypto';
import { GoogleOneTapSignIn, isCancelledResponse, isSuccessResponse } from 'react-native-nitro-google-signin';
import { config } from './config';
import { supabase } from './supabase';

/**
 * Google sign-in in the phone apps: Android's own account picker (Credential Manager) gives an ID
 * token for our web client id, which signs in to Supabase (signInWithIdToken), as on the web.
 *
 * Google gets the SHA-256 of a one-time nonce and Supabase the nonce itself, so a token can only be
 * used for this sign-in.
 */
export const GOOGLE_RETURN_PATH = '/auth/google';

export const googleConfigured = () => !!config.googleClientId;

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Shows Google's account picker, then signs in. Closing the picker is not an error. */
export async function startGoogleSignIn(): Promise<void> {
  const nonce = hex(getRandomBytes(32));
  GoogleOneTapSignIn.configure({ webClientId: config.googleClientId!, nonce: await digestStringAsync(CryptoDigestAlgorithm.SHA256, nonce) });
  await GoogleOneTapSignIn.checkPlayServices();
  const res = await GoogleOneTapSignIn.presentExplicitSignIn();
  if (isCancelledResponse(res)) return;
  if (!isSuccessResponse(res) || !res.data.idToken) throw new Error('Google sign-in did not work. Try again, or use your email.');
  const { error } = await supabase!.auth.signInWithIdToken({ provider: 'google', token: res.data.idToken, nonce });
  if (error) throw new Error('Google sign-in did not work. Try again, or use your email.');
}

/** Phones never leave the app for Google, so there is nothing to come back from. */
export const takeGoogleReturn = (): null => null;
