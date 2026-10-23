import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, Share, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button, T, useWide } from './kit';

type Nav = { share?: (data: { text?: string; url?: string; title?: string }) => Promise<void>; clipboard?: { writeText(s: string): Promise<void> } };
const nav = () => (globalThis as { navigator?: Nav }).navigator;

/** A link to this computer only opens here; friends need the app on a public address. */
const isLocal = (link: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/)/.test(link);

/**
 * Bottom sheet (centred dialog on wide screens) with the group's invite link: copy it, send it on
 * WhatsApp (the link is tappable there and opens the join page), or use the system share sheet.
 */
export function InviteSheet({ open, link, groupName, onClose }: { open: boolean; link: string | null; groupName: string; onClose: () => void }) {
  const { theme } = useTheme();
  const wide = useWide();
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setCopied(false);
    setProblem(null);
  }, [link, open]);

  // The link goes on its own line at the end, so chat apps make it tappable.
  const message = link ? `Join "${groupName}" on Splitify, so we keep our shared expenses in one place.\n\n${link}` : '';
  const canCopy = Platform.OS === 'web' && !!nav()?.clipboard;
  const canShare = Platform.OS !== 'web' || !!nav()?.share;

  const copy = async () => {
    if (!link) return;
    try {
      await nav()!.clipboard!.writeText(link);
      setCopied(true);
    } catch {
      setProblem('Could not copy. Select the link above and copy it.');
    }
  };
  const whatsapp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
    else Linking.openURL(url).catch(() => setProblem('WhatsApp did not open. Use Copy or More options.'));
  };
  const share = async () => {
    try {
      if (Platform.OS === 'web') await nav()!.share!({ title: `Join ${groupName} on Splitify`, text: message });
      else await Share.share({ message });
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) setProblem('Sharing did not work. Use Copy instead.');
    }
  };

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close invite" onPress={onClose} style={{ flex: 1, backgroundColor: theme.c.overlay, justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? 24 : 0 }}>
        <Pressable
          onPress={() => {}}
          style={{ width: '100%', maxWidth: wide ? 460 : 520, backgroundColor: theme.c.surface, borderRadius: wide ? 24 : 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: wide ? 20 : 32, gap: 14 }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T size={20} weight="heavy" numberOfLines={1} style={{ flex: 1 }}>
              Invite to {groupName}
            </T>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="x" size={22} color={theme.c.text} />
            </Pressable>
          </View>
          <T size={14} color={theme.c.muted}>
            Friends tap the link, sign in with their email, and join. If you already added them by name, they pick their name.
          </T>

          {/* The link itself, with Copy beside it. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: theme.c.border, borderRadius: 14, paddingLeft: 14, paddingRight: 6, paddingVertical: 6, backgroundColor: theme.c.bg }}>
            {link ? (
              <Text selectable numberOfLines={1} accessibilityLabel="Invite link" style={{ flex: 1, fontFamily: theme.f.regular, fontSize: 14, color: theme.c.text }}>
                {link}
              </Text>
            ) : (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
                <ActivityIndicator size="small" color={theme.c.muted} />
                <T size={14} color={theme.c.muted}>
                  Making a link…
                </T>
              </View>
            )}
            {canCopy ? <Button title={copied ? 'Copied' : 'Copy'} icon={copied ? 'check' : 'copy'} size="sm" variant={copied ? 'secondary' : 'primary'} disabled={!link} onPress={copy} /> : null}
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send on WhatsApp"
              disabled={!link}
              onPress={whatsapp}
              style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 999, backgroundColor: '#25D366', opacity: !link ? 0.5 : pressed ? 0.85 : 1 })}
            >
              <MaterialCommunityIcons name="whatsapp" size={22} color="#FFFFFF" />
              <T size={15} weight="bold" color="#FFFFFF">
                WhatsApp
              </T>
            </Pressable>
            {canShare ? <Button title="More options" icon="share" size="md" variant="secondary" flex={1} disabled={!link} onPress={share} /> : null}
          </View>

          {problem ? (
            <T size={13} weight="semibold" color={theme.c.owe}>
              {problem}
            </T>
          ) : null}
          {link && isLocal(link) ? (
            <View style={{ backgroundColor: theme.c.attnBg, borderColor: theme.c.attnBorder, borderWidth: 1, borderRadius: 12, padding: 12 }}>
              <T size={13} color={theme.c.attnText}>
                This link points to this computer (localhost), so it opens only here. To open it on friends’ phones, the app has to be online at a public address.
              </T>
            </View>
          ) : null}
          <T size={12} color={theme.c.muted}>
            The link works for 14 days. Anyone who has it can join, so share it only with the group.
          </T>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
