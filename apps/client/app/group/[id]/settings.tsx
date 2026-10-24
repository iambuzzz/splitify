import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { groupPhase, isAdmin } from '../../../src/data/model';
import { useStore } from '../../../src/data/StoreProvider';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { Header } from '../../../src/ui/Header';
import { Missing } from '../../../src/ui/Missing';
import { Button, Card, Field, Label, Screen, T, isHovered, styles } from '../../../src/ui/kit';

/** Owner and admins: the group's name, invite links already sent, members, finishing. */
export default function GroupSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const { state, dispatch, account } = useStore();
  const group = state.groups.find((g) => g.id === id);
  const [name, setName] = useState(group?.name ?? '');
  const [saved, setSaved] = useState(false);
  const [confirmLinks, setConfirmLinks] = useState(false);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  if (!group) return <Missing />;

  const admin = isAdmin(state, group.id);
  const phase = groupPhase(state, group.id);
  const trimmed = name.trim();
  const canSave = admin && trimmed !== '' && trimmed !== group.name && trimmed.length <= 80;
  const save = () => {
    if (!canSave) return;
    dispatch({ type: 'rename_group', groupId: group.id, name: trimmed });
    setSaved(true);
  };
  const revoke = async () => {
    setConfirmLinks(false);
    try {
      const n = account ? await account.revokeInvites(group.id) : 0;
      setLinkNote(n === 0 ? 'No links were on. New links still work as usual.' : `Done: ${n} old link${n === 1 ? '' : 's'} turned off.`);
    } catch (err) {
      setLinkNote(err instanceof Error ? err.message : 'Could not turn the links off. Try again.');
    }
  };

  if (!admin) {
    return (
      <Screen maxWidth={560}>
        <Header back={`/group/${group.id}`} title="Group settings" />
        <Card>
          <T size={15}>Only the group’s owner or an admin can change its settings.</T>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={560}>
      <Header back={`/group/${group.id}`} title="Group settings" />

      <View style={{ gap: 8 }}>
        <Label>Group name</Label>
        <View style={[styles.row, { gap: 8 }]}>
          <Field
            accessibilityLabel="Group name"
            value={name}
            maxLength={80}
            onChangeText={(t) => {
              setName(t);
              setSaved(false);
            }}
            onSubmitEditing={save}
            returnKeyType="done"
            style={{ flex: 1, minWidth: 0 }}
          />
          <Button title="Save" size="md" disabled={!canSave} onPress={save} />
        </View>
        {saved ? (
          <T size={13} weight="semibold" color={theme.c.get}>
            Saved. Everyone sees the new name.
          </T>
        ) : null}
      </View>

      <Card>
        <Label>Invite links</Label>
        <T size={14} color={theme.c.muted}>
          Every “Invite” makes a new link that works for 14 days. Shared one with the wrong people? Turn off all the links sent so far. Nobody already in the group is affected.
        </T>
        {confirmLinks ? (
          <View style={[styles.row, { gap: 10 }]}>
            <Button title="Turn them off" size="md" variant="danger" flex={1} onPress={revoke} />
            <Button title="Cancel" size="md" variant="secondary" flex={1} onPress={() => setConfirmLinks(false)} />
          </View>
        ) : (
          <View style={{ alignSelf: 'flex-start' }}>
            <Button title="Turn off old invite links" icon="link-2" size="md" variant="secondary" onPress={() => setConfirmLinks(true)} />
          </View>
        )}
        {linkNote ? (
          <T size={13} weight="semibold" color={theme.c.muted}>
            {linkNote}
          </T>
        ) : null}
      </Card>

      <Card padded={false} style={{ gap: 0 }}>
        <LinkRow icon="users" title="Members and roles" hint="Admins, owner, removing people" onPress={() => router.push(`/group/${group.id}/members`)} />
        <LinkRow
          icon={phase === 'open' ? 'flag' : 'rotate-ccw'}
          title={phase === 'open' ? 'Finish group' : 'Reopen group'}
          hint={phase === 'open' ? 'Stop new expenses and settle up' : 'Allow new and changed expenses again'}
          onPress={() => router.push(`/group/${group.id}/finish`)}
          top
        />
      </Card>
    </Screen>
  );
}

function LinkRow({ icon, title, hint, onPress, top }: { icon: ComponentProps<typeof Feather>['name']; title: string; hint: string; onPress: () => void; top?: boolean }) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={(st) => [styles.row, { gap: 14, padding: 16, borderTopWidth: top ? 1 : 0, borderColor: theme.c.border, backgroundColor: isHovered(st) ? theme.c.tint : 'transparent' }]}
    >
      <Feather name={icon} size={20} color={theme.c.text} />
      <View style={{ flex: 1 }}>
        <T size={15} weight="bold">
          {title}
        </T>
        <T size={13} color={theme.c.muted}>
          {hint}
        </T>
      </View>
      <Feather name="chevron-right" size={18} color={theme.c.muted} />
    </Pressable>
  );
}
