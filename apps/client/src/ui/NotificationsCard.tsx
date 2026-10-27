import { Feather } from '@expo/vector-icons';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Card, T } from './kit';
import { askLater, turnOn, useNotifications } from './useNotifications';

/**
 * The home screen's one-time ask, shown once someone has a group (so the reason is real), never as
 * a browser pop-up on first visit. "Not now" hides it for two weeks; the Notifications screen in
 * the Theme panel is always there.
 */
export function NotificationsCard() {
  const { theme } = useTheme();
  const n = useNotifications();
  if (n.status !== 'off' || n.askAfter > Date.now() || (n.support !== 'ok' && n.support !== 'install-first')) return null;
  const iphone = n.support === 'install-first';
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="bell" size={20} color={theme.c.text} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <T size={16} weight="bold">
            {iphone ? 'Get notifications on your iPhone' : 'Know when someone needs you'}
          </T>
          <T size={14} color={theme.c.muted}>
            {iphone
              ? 'Add Splitify to your Home Screen first: tap Share, then Add to Home Screen. Open it from there and turn notifications on.'
              : 'When a friend says they paid you, suggests a change or asks about a bill. Names only, never amounts.'}
          </T>
        </View>
      </View>
      {n.error ? (
        <T size={13} weight="semibold" color={theme.c.owe}>
          {n.error}
        </T>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {iphone ? null : <Button title={n.busy ? 'Turning on…' : 'Turn on'} icon="bell" size="md" grow disabled={n.busy} onPress={turnOn} />}
        <Button title={iphone ? 'Got it' : 'Not now'} size="md" variant="secondary" grow onPress={askLater} />
      </View>
    </Card>
  );
}
