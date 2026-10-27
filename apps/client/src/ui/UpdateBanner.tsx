import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { T } from './kit';
import { useAppVersion } from './useAppVersion';

const SKIPPED = 'splitify.skippedUpdate';

/**
 * Android only: a newer app is on the website. Tapping downloads it; × hides it until the next one
 * (the Theme panel still offers it). The website updates from the Theme panel, without a banner.
 */
export function UpdateBanner() {
  const { theme } = useTheme();
  const { update } = useAppVersion();
  const [skipped, setSkipped] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    AsyncStorage.getItem(SKIPPED)
      .catch(() => null)
      .then(setSkipped);
  }, []);
  if (Platform.OS !== 'android' || !update || update.kind !== 'download' || skipped === undefined || skipped === update.version) return null;
  const hide = () => {
    setSkipped(update.version);
    AsyncStorage.setItem(SKIPPED, update.version).catch(() => {});
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 16, borderRadius: theme.r.card, backgroundColor: theme.c.text }}>
      <Pressable accessibilityRole="link" accessibilityLabel={`Splitify ${update.version} is out. Download the update`} onPress={update.go} style={{ flex: 1, paddingVertical: 12, gap: 2 }}>
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
