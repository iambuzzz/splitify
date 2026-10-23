/**
 * Set in apps/client/.env.local (Expo inlines EXPO_PUBLIC_* at build time; they are visible to
 * anyone using the app, so only public values go here: never a secret key or a password).
 * Without them the app runs on demo data.
 */
export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  /** The project's publishable key (sb_publishable_…), never the secret key. */
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_KEY,
  /** Where invite links point; defaults to this web app's own address. */
  appUrl: process.env.EXPO_PUBLIC_APP_URL,
  /** Google OAuth client id (public) for "Continue with Google" on the web; without it the button is hidden. */
  googleClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
};

export const remoteEnabled = Boolean(config.apiUrl && config.supabaseUrl && config.supabaseKey);

// A secret key in the app would be readable by anyone who has it; refuse to start with one.
if (config.supabaseKey?.startsWith('sb_secret_') || config.supabaseKey?.includes('service_role')) {
  throw new Error('EXPO_PUBLIC_SUPABASE_KEY must be the publishable key (sb_publishable_…), never the secret key');
}
