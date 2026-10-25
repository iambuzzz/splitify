import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { fetchLatestApk, updateFor } from '../data/appUpdate';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './kit';

const SKIPPED = 'splitify.skippedUpdate';
/** Which file this build is (eas.json: website-64bit / website-32bit). */
const BITS = process.env.EXPO_PUBLIC_APK_BITS === '32' ? '32' : '64';

/** Android only: a newer app is on the website. Tapping downloads it; × hides it until the next one. */
export function UpdateBanner() {
  const { theme } = useTheme();
  const [update, setUpdate] = useState<{ version: string; url: string; mb?: number } | null>(null);
  useEffect(() => {
    const current = Constants.expoConfig?.version;
    if (Platform.OS !== 'android' || !current) return;
    let live = true;
    Promise.all([fetchLatestApk(), AsyncStorage.getItem(SKIPPED).catch(() => null)]).then(([latest, skipped]) => {
      const u = updateFor(latest, current, BITS);
      if (live && u && u.version !== skipped) setUpdate(u);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!update) return null;
  const hide = () => {
    setUpdate(null);
    AsyncStorage.setItem(SKIPPED, update.version).catch(() => {});
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 16, borderRadius: theme.r.card, backgroundColor: theme.c.text }}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Splitify ${update.version} is out. Download the update`}
        onPress={() => Linking.openURL(update.url).catch(() => {})}
        style={{ flex: 1, paddingVertical: 12, gap: 2 }}
      >
        <T size={15} weight="bold" color={theme.c.bg}>
          {`Splitify ${update.version} is out`}
        </T>
        <T size={13} color={theme.c.bg} style={{ opacity: 0.75 }}>
          {`Tap to download${update.mb ? ` (${update.mb} MB)` : ''}, then open the file to update. Your groups stay as they are.`}
        </T>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Not now" onPress={hide} hitSlop={8} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="x" size={20} color={theme.c.bg} />
      </Pressable>
    </View>
  );
}
