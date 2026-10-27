import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Modal, Pressable, View } from 'react-native';
import { useStore } from '../data/StoreProvider';
import { useTheme } from '../theme/ThemeProvider';
import { THEMES, THEME_ORDER } from '../theme/themes';
import { Button, T, useSheetBottom, useWide } from './kit';
import { useAppVersion } from './useAppVersion';
import { useNotifications } from './useNotifications';

/** Bottom sheet (centred dialog on wide screens) for switching themes, signing out, and the app's version (with Update when there's a newer one). */
export function ThemePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, setTheme } = useTheme();
  const { account } = useStore();
  const app = useAppVersion();
  const notes = useNotifications();
  const wide = useWide();
  const bottom = useSheetBottom(32);
  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close theme picker" onPress={onClose} style={{ flex: 1, backgroundColor: theme.c.overlay, justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? 24 : 0 }}>
        <Pressable
          onPress={() => {}}
          style={{ width: '100%', maxWidth: wide ? 440 : 520, backgroundColor: theme.c.surface, borderRadius: wide ? 24 : 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: wide ? 20 : bottom, gap: 12 }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T size={20} weight="heavy">
              Theme
            </T>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="x" size={22} color={theme.c.text} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {THEME_ORDER.map((id) => {
              const t = THEMES[id];
              const on = theme.id === id;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityLabel={`${t.name}, ${t.dark ? 'dark' : 'light'}, ${t.family === 'cards' ? 'cards layout' : 'bill layout'}`}
                  aria-checked={on}
                  onPress={() => {
                    setTheme(id);
                    onClose();
                  }}
                  style={{ flexBasis: '47%', flexGrow: 1, gap: 8, padding: 12, borderRadius: 16, borderWidth: 2, borderColor: on ? theme.c.primary : theme.c.border }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: theme.c.border }}>
                      {t.swatch.map((c, i) => (
                        <View key={i} style={{ width: 16, height: 28, backgroundColor: c }} />
                      ))}
                    </View>
                    {on ? <Feather name="check-circle" size={20} color={theme.c.primary} /> : null}
                  </View>
                  <View>
                    <T size={15} weight="bold" numberOfLines={1}>
                      {t.name}
                    </T>
                    <T size={12} color={theme.c.muted} numberOfLines={1}>
                      {t.dark ? 'Dark' : 'Light'} · {t.family === 'cards' ? 'Cards' : 'Bill'}
                    </T>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Notifications, ${notes.status === 'on' ? 'on' : 'off'} on this device`}
            onPress={() => {
              onClose();
              router.push('/notifications');
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.c.border, marginTop: 4 }}
          >
            <Feather name={notes.status === 'on' ? 'bell' : 'bell-off'} size={18} color={theme.c.text} />
            <T size={15} weight="bold" style={{ flex: 1 }}>
              Notifications
            </T>
            <T size={13} color={notes.status === 'on' ? theme.c.get : theme.c.muted} weight="semibold">
              {notes.status === 'on' ? 'On' : 'Off'}
            </T>
            <Feather name="chevron-right" size={18} color={theme.c.muted} />
          </Pressable>
          {account?.email ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }}>
              <T size={13} color={theme.c.muted} style={{ flex: 1 }} numberOfLines={1}>
                Signed in as {account.email}
              </T>
              <Button
                title="Sign out"
                size="sm"
                variant="secondary"
                onPress={() => {
                  onClose();
                  account.signOut();
                }}
              />
            </View>
          ) : null}
          {app.version ? (
            <View
              style={[
                { flexDirection: 'row', alignItems: 'center', gap: 12 },
                // A newer version stands out; otherwise the version sits quietly under a line.
                app.update ? { borderRadius: 14, padding: 12, backgroundColor: theme.c.attnBg } : { borderTopWidth: 1, borderTopColor: theme.c.border, paddingTop: 12 },
              ]}
            >
              <View style={{ flex: 1, gap: 1 }}>
                <T size={13} weight={app.update ? 'bold' : 'regular'} color={app.update ? theme.c.attnText : theme.c.muted}>
                  {app.update
                    ? app.update.kind === 'download'
                      ? `Splitify ${app.update.version} is out${app.update.mb ? ` · ${app.update.mb} MB` : ''}`
                      : 'A new version of Splitify is ready'
                    : `Splitify ${app.version}${app.where ? ` · ${app.where}` : ''}`}
                </T>
                <T size={12} color={app.update ? theme.c.attnText : theme.c.muted} style={{ opacity: app.update ? 0.85 : 1 }}>
                  {app.update
                    ? app.update.kind === 'download'
                      ? `You have ${app.version}. Download, then open the file. Your groups stay as they are.`
                      : `You have ${app.version}. Updating takes a second; your groups stay as they are.`
                    : 'Up to date'}
                </T>
              </View>
              {app.update ? <Button title="Update" icon={app.update.kind === 'download' ? 'download' : 'refresh-cw'} size="sm" onPress={app.update.go} /> : null}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
