import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, View } from 'react-native';
import { useStore } from '../data/StoreProvider';
import { useTheme } from '../theme/ThemeProvider';
import { THEMES, THEME_ORDER } from '../theme/themes';
import { Button, T, useWide } from './kit';

/** Bottom sheet (centred dialog on wide screens) for switching between the four themes, and signing out. */
export function ThemePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme, setTheme } = useTheme();
  const { account } = useStore();
  const wide = useWide();
  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close theme picker" onPress={onClose} style={{ flex: 1, backgroundColor: theme.c.overlay, justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? 24 : 0 }}>
        <Pressable
          onPress={() => {}}
          style={{ width: '100%', maxWidth: wide ? 440 : 520, backgroundColor: theme.c.surface, borderRadius: wide ? 24 : 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: wide ? 20 : 32, gap: 12 }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T size={20} weight="heavy">
              Theme
            </T>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="x" size={22} color={theme.c.text} />
            </Pressable>
          </View>
          {THEME_ORDER.map((id) => {
            const t = THEMES[id];
            const on = theme.id === id;
            return (
              <Pressable
                key={id}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => {
                  setTheme(id);
                  onClose();
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  padding: 14,
                  borderRadius: 16,
                  borderWidth: 2,
                  borderColor: on ? theme.c.primary : theme.c.border,
                }}
              >
                <View style={{ flexDirection: 'row', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: theme.c.border }}>
                  {t.swatch.map((c, i) => (
                    <View key={i} style={{ width: 18, height: 36, backgroundColor: c }} />
                  ))}
                </View>
                <View style={{ flex: 1 }}>
                  <T size={16} weight="bold">
                    {t.name}
                  </T>
                  <T size={13} color={theme.c.muted}>
                    {t.dark ? 'Dark' : 'Light'} · {t.family === 'cards' ? 'Cards layout' : 'Bill layout'}
                  </T>
                </View>
                {on ? <Feather name="check-circle" size={22} color={theme.c.primary} /> : null}
              </Pressable>
            );
          })}
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}
