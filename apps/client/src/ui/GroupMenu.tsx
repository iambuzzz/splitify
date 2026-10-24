import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';
import { csvFileName, groupCsv } from '../data/csv';
import { type Group, groupPhase, isAdmin } from '../data/model';
import { groupSummaryText } from '../data/share';
import { appUrl, useStore } from '../data/StoreProvider';
import { useTheme } from '../theme/ThemeProvider';
import { saveTextFile } from './files';
import { T, isHovered, useSheetBottom, useWide } from './kit';
import { ShareSheet } from './ShareSheet';

type Icon = ComponentProps<typeof Feather>['name'];

/** The group's "more" menu: share the settle-up plan, spreadsheet, Splitwise import, members; for admins also settings and finishing. */
export function useGroupMenu(group: Group | undefined) {
  const { theme } = useTheme();
  const { state } = useStore();
  const wide = useWide();
  const bottom = useSheetBottom(28);
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!group) return { openMenu: () => {}, menu: null, notice, setNotice };

  const close = () => setOpen(false);
  const phase = groupPhase(state, group.id);
  const admin = isAdmin(state, group.id);
  const items: { icon: Icon; title: string; hint: string; onPress: () => void; hidden?: boolean }[] = [
    {
      icon: 'send',
      title: 'Share the settle-up plan',
      hint: 'On WhatsApp: who pays whom, with a link back here',
      onPress: () => {
        close();
        setSharing(true);
      },
    },
    {
      icon: 'download',
      title: 'Download as spreadsheet',
      hint: 'CSV for Excel or Google Sheets: every expense and payment',
      onPress: () => {
        close();
        saveTextFile(csvFileName(group.name), groupCsv(state, group.id))
          .then(() => setNotice(Platform.OS === 'web' ? 'Spreadsheet downloaded.' : null))
          .catch(() => setNotice('Could not save the spreadsheet. Try again.'));
      },
    },
    {
      icon: 'upload',
      title: 'Import from Splitwise',
      hint: 'Bring a group’s expenses over from a Splitwise export',
      hidden: Platform.OS !== 'web' || phase !== 'open',
      onPress: () => {
        close();
        router.push(`/group/${group.id}/import`);
      },
    },
    {
      icon: 'users',
      title: 'Members',
      hint: 'Add people, roles, leave the group',
      onPress: () => {
        close();
        router.push(`/group/${group.id}/members`);
      },
    },
    {
      icon: 'settings',
      title: 'Group settings',
      hint: 'Name, invite links',
      hidden: !admin,
      onPress: () => {
        close();
        router.push(`/group/${group.id}/settings`);
      },
    },
    {
      icon: phase === 'open' ? 'flag' : 'rotate-ccw',
      title: phase === 'open' ? 'Finish group' : 'Reopen group',
      hint: phase === 'open' ? 'Trip over? Stop new expenses and settle up' : 'Allow new and changed expenses again',
      hidden: !admin,
      onPress: () => {
        close();
        router.push(`/group/${group.id}/finish`);
      },
    },
  ];

  const menu = (
    <>
      <Modal transparent visible={open} animationType="fade" onRequestClose={close}>
        <Pressable accessibilityLabel="Close menu" onPress={close} style={{ flex: 1, backgroundColor: theme.c.overlay, justifyContent: wide ? 'center' : 'flex-end', alignItems: 'center', padding: wide ? 24 : 0 }}>
          <Pressable
            onPress={() => {}}
            style={{ width: '100%', maxWidth: wide ? 420 : 520, backgroundColor: theme.c.surface, borderRadius: wide ? 24 : 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingVertical: 12, paddingBottom: wide ? 12 : bottom }}
          >
            <T size={13} weight="bold" color={theme.c.muted} style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
              {group.name.toUpperCase()}
            </T>
            {items
              .filter((i) => !i.hidden)
              .map((i) => (
                <Pressable
                  key={i.title}
                  accessibilityRole="button"
                  accessibilityLabel={i.title}
                  onPress={i.onPress}
                  style={(st) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: isHovered(st) || st.pressed ? theme.c.tint : 'transparent' })}
                >
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: theme.c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name={i.icon} size={18} color={theme.c.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <T size={15} weight="bold">
                      {i.title}
                    </T>
                    <T size={13} color={theme.c.muted}>
                      {i.hint}
                    </T>
                  </View>
                </Pressable>
              ))}
          </Pressable>
        </Pressable>
      </Modal>
      <ShareSheet
        open={sharing}
        title="Share the settle-up plan"
        buildText={(amounts) => groupSummaryText(state, group.id, `${appUrl()}/group/${group.id}/settle`, amounts)}
        onClose={() => setSharing(false)}
      />
    </>
  );
  return { openMenu: () => setOpen(true), menu, notice, setNotice };
}
