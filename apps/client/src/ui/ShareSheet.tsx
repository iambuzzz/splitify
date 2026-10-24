import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Linking, Modal, Platform, Pressable, Share, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button, T, useWide } from './kit';

type Nav = { share?: (data: { text?: string; title?: string }) => Promise<void>; clipboard?: { writeText(s: string): Promise<void> } };
const nav = () => (globalThis as { navigator?: Nav }).navigator;

/**
 * Share a message to WhatsApp (or copy it, or the system share sheet), with a preview of exactly
 * what goes out. Amounts are off by default; one tap adds them.
 */
export function ShareSheet({ open, title, buildText, onClose }: { open: boolean; title: string; buildText: (amounts: boolean) => string; onClose: () => void }) {
  const { theme } = useTheme();
  const wide = useWide();
  const [amounts, setAmounts] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setCopied(false);
    setProblem(null);
  }, [open, amounts]);
  const text = buildText(amounts);

  const whatsapp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
    else Linking.openURL(url).catch(() => setProblem('WhatsApp did not open. Use Copy instead.'));
  };
  const copy = async () => {
    try {
      await nav()!.clipboard!.writeText(text);
      setCopied(true);
    } catch {
      setProblem('Could not copy. Select the text above and copy it.');
    }
  };
  const more = async () => {
    try {
      if (Platform.OS === 'web') await nav()!.share!({ title, text });
      else await Share.share({ message: text });
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) setProblem('Sharing did not work. Use Copy instead.');
    }
  };

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: theme.c.overlay, justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? 24 : 0 }}>
        <Pressable
          onPress={() => {}}
          style={{ width: '100%', maxWidth: wide ? 460 : 520, backgroundColor: theme.c.surface, borderRadius: wide ? 24 : 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: wide ? 20 : 32, gap: 14 }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T size={20} weight="heavy" numberOfLines={1} style={{ flex: 1 }}>
              {title}
            </T>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="x" size={22} color={theme.c.text} />
            </Pressable>
          </View>

          <View style={{ borderWidth: 1.5, borderColor: theme.c.border, borderRadius: 14, padding: 14, backgroundColor: theme.c.bg, maxHeight: 260 }}>
            <Text selectable style={{ fontFamily: theme.f.regular, fontSize: 14, lineHeight: 20, color: theme.c.text }}>
              {text}
            </Text>
          </View>

          <Pressable
            accessibilityRole="checkbox"
            aria-checked={amounts}
            onPress={() => setAmounts(!amounts)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
          >
            <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: amounts ? theme.c.primary : theme.c.borderStrong, backgroundColor: amounts ? theme.c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {amounts ? <Feather name="check" size={14} color={theme.c.onPrimary} /> : null}
            </View>
            <T size={14}>Include amounts</T>
          </Pressable>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send on WhatsApp"
              onPress={whatsapp}
              style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 999, backgroundColor: '#25D366', opacity: pressed ? 0.85 : 1 })}
            >
              <MaterialCommunityIcons name="whatsapp" size={22} color="#FFFFFF" />
              <T size={15} weight="bold" color="#FFFFFF">
                WhatsApp
              </T>
            </Pressable>
            {Platform.OS === 'web' && nav()?.clipboard ? (
              <Button title={copied ? 'Copied' : 'Copy'} icon={copied ? 'check' : 'copy'} size="md" variant="secondary" flex={1} onPress={copy} />
            ) : null}
          </View>
          {Platform.OS !== 'web' || nav()?.share ? <Button title="More options" icon="share" size="md" variant="secondary" onPress={more} /> : null}
          {problem ? (
            <T size={13} weight="semibold" color={theme.c.owe}>
              {problem}
            </T>
          ) : null}
          <T size={12} color={theme.c.muted}>
            The link opens this page in Splitify. Only people in the group can see it.
          </T>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
