import './polyfills';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { config, remoteEnabled } from './config';

/** Sign-in only: all group data goes through our API, never through Supabase's Data API. */
export const supabase: SupabaseClient | null = remoteEnabled
  ? createClient(config.supabaseUrl!, config.supabaseKey!, {
      auth: {
        // Phones keep the session in AsyncStorage; browsers use their own storage.
        ...(Platform.OS === 'web' ? {} : { storage: AsyncStorage }),
        autoRefreshToken: true,
        persistSession: true,
        // Browsers: the emailed sign-in link comes back with a one-time ?code=, exchanged here.
        // PKCE: the code only works in the browser that asked for it.
        flowType: 'pkce',
        detectSessionInUrl: Platform.OS === 'web',
      },
    })
  : null;

// On phones, refresh the session only while the app is in front.
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (s) => (s === 'active' ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh()));
}
