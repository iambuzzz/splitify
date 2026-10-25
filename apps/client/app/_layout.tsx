import {
  BricolageGrotesque_400Regular,
  BricolageGrotesque_500Medium,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import { Fraunces_400Regular, Fraunces_500Medium, Fraunces_600SemiBold, Fraunces_700Bold, Fraunces_800ExtraBold } from '@expo-google-fonts/fraunces';
import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { useLinkingURL } from 'expo-linking';
import { NavigationBar } from 'expo-navigation-bar';
import { type Href, Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { takePendingInvite, takeReturnPath } from '../src/data/invite';
import { inviteInLink } from '../src/data/openedLink';
import { StoreProvider, useStore } from '../src/data/StoreProvider';
import { SignIn } from '../src/screens/SignIn';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { T, useWide } from '../src/ui/kit';
import { Sidebar } from '../src/ui/Sidebar';

// The icon fonts are listed too: an icon draws nothing until its font is on the page.
const FONTS = {
  ...Feather.font,
  ...MaterialCommunityIcons.font,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  BricolageGrotesque_400Regular,
  BricolageGrotesque_500Medium,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
  Fraunces_800ExtraBold,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
};

export default function RootLayout() {
  const [loaded, fontError] = useFonts(FONTS);
  // Safari can leave expo-font's own load promise hanging (it times out after 12 s), which used to
  // keep this screen blank. A moment after expo-font has put the @font-face rules on the page, ask the
  // browser for the faces ourselves (Safari answers this), and never wait more than 1.5 s.
  const [webReady, setWebReady] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const ready = () => setWebReady(true);
    const fallback = setTimeout(ready, 1500);
    const ask = setTimeout(() => {
      Promise.all(Object.keys(FONTS).map((f) => document.fonts.load(`1em "${f}"`))).then(ready, ready);
    }, 30);
    return () => {
      clearTimeout(fallback);
      clearTimeout(ask);
    };
  }, []);
  if (!loaded && !fontError && !webReady) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StoreProvider>
          <Shell />
        </StoreProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

// Phone browsers hide their address bar on scroll, which makes the screen taller than the page's
// 100% height: a strip showed under the app and the pinned button seemed to float. Size the page to
// the visible screen as it changes (dvh), and stop the page itself from being pulled around.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = '@supports (height: 100dvh) { html, body, #root { height: 100dvh; } } html, body { overscroll-behavior: none; }';
  document.head.appendChild(style);
}

/** Phones get a single stack of screens; laptops get a groups sidebar beside it. */
function Shell() {
  const { theme } = useTheme();
  const { account } = useStore();
  const wide = useWide();
  const ready = account?.status === 'ready';
  const opened = useLinkingURL();
  const pathname = usePathname();
  // Browser chrome and anything outside the app take the theme's background, never plain white.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.body.style.backgroundColor = theme.c.bg;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = theme.c.bg;
  }, [theme.c.bg]);
  // Signed in from an invite link: continue to joining that group.
  useEffect(() => {
    if (!ready) return;
    const t = Platform.OS === 'web' ? takePendingInvite() : inviteInLink(opened);
    const back = takeReturnPath();
    if (t && pathname !== '/join') router.replace({ pathname: '/join', params: { t } });
    // Signed in from another deep link (e.g. a settle-up reminder): back to that page.
    else if (back && pathname !== back) router.replace(back as Href);
  }, [ready]);
  if (account && !ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.c.bg }}>
        <SystemBars />
        <SignIn />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.c.bg }}>
      <SystemBars />
      {wide ? <Sidebar /> : null}
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.c.bg }, animation: wide ? 'none' : 'default' }} />
      </View>
      <ErrorBanner />
    </View>
  );
}

/**
 * The phone's own bars wear the theme: light icons on dark themes, dark on light ones. The app draws
 * under both, so the theme's background shows through (app.json turns off Android's light scrim).
 */
function SystemBars() {
  const { theme } = useTheme();
  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <NavigationBar style={theme.dark ? 'dark' : 'light'} />
    </>
  );
}

/** A change the API refused (or a lost connection): said in words, then hidden after a while. */
function ErrorBanner() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { error, clearError, sync } = useStore();
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(clearError, 8000);
    return () => clearTimeout(timer);
  }, [error, clearError]);
  if (!error) {
    if (sync !== 'offline') return null;
    // Lost the connection: say so quietly; the app keeps retrying on its own.
    return (
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 12, alignItems: 'center' }}>
        <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.c.text, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.c.owe }} />
          <T size={13} weight="semibold" color={theme.c.bg}>
            Offline · trying again
          </T>
        </View>
      </View>
    );
  }
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 96 + insets.bottom, alignItems: 'center', paddingHorizontal: 16 }}>
      <Pressable
        accessibilityRole="alert"
        accessibilityLabel={`${error}. Tap to hide.`}
        onPress={clearError}
        style={{ maxWidth: 520, backgroundColor: theme.c.text, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16 }}
      >
        <T size={14} weight="semibold" color={theme.c.bg}>
          {error}
        </T>
      </Pressable>
    </View>
  );
}
