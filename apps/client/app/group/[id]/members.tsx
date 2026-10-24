import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { uuidv7 } from '../../../src/data/ids';
import { ME, type MemberInfo, balanceOf, groupPhase, inr, isAdmin, roleOf } from '../../../src/data/model';
import { useStore } from '../../../src/data/StoreProvider';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { Header } from '../../../src/ui/Header';
import { Missing } from '../../../src/ui/Missing';
import { Avatar, Button, Card, Field, Label, Screen, T, isHovered, styles } from '../../../src/ui/kit';
import { useInvite } from '../../../src/ui/useInvite';

/** Everyone in the group, with roles and balances. Admins remove people; the owner picks admins and can hand the group over. */
export default function Members() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const { state, dispatch } = useStore();
  const group = state.groups.find((g) => g.id === id);
  const { invite, notice, sheet } = useInvite(group);
  const [name, setName] = useState('');
  /** Which confirmation is open: removing someone, handing over to someone, or leaving. */
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'owner'; id: string } | { kind: 'leave' } | null>(null);

  if (!group) return <Missing />;

  const roster = state.roster[group.id] ?? [];
  const current = roster.filter((m) => m.active);
  const former = roster.filter((m) => !m.active);
  const admin = isAdmin(state, group.id);
  const owner = roleOf(state, group.id) === 'owner';
  const editable = groupPhase(state, group.id) === 'open';
  const myBalance = balanceOf(state, group.id, ME);
  // The owner can leave only when nobody else who has joined is still here (hand it over first).
  const ownerStuck = owner && current.some((m) => m.id !== ME && m.joined);
  const nameOf = (m: string) => (m === ME ? 'You' : state.members[m]?.name ?? 'Someone');
  const taken = current.some((m) => state.members[m.id]?.name.toLowerCase() === name.trim().toLowerCase());
  const add = () => {
    if (!name.trim() || taken) return;
    dispatch({ type: 'add_member', groupId: group.id, memberId: uuidv7(), name: name.trim() });
    setName('');
  };

  const row = (m: MemberInfo) => {
    const b = balanceOf(state, group.id, m.id);
    const tags = [m.role === 'owner' ? 'Owner' : m.role === 'admin' ? 'Admin' : null, m.joined ? null : 'Not joined yet', m.active ? null : 'Left'].filter(Boolean);
    const removable = admin && m.active && m.id !== ME && m.role !== 'owner';
    const promotable = owner && m.active && m.joined && m.id !== ME;
    const confirming = confirm && confirm.kind !== 'leave' && confirm.id === m.id ? confirm.kind : null;
    return (
      <View key={m.id} style={{ gap: 10, paddingVertical: 6 }}>
        <Pressable
          accessibilityRole={m.id === ME ? undefined : 'button'}
          accessibilityLabel={m.id === ME ? undefined : `Chat and settle up with ${nameOf(m.id)}`}
          disabled={m.id === ME}
          onPress={() => router.push(`/group/${group.id}/with/${m.id}`)}
          style={(st) => [styles.row, { gap: 12, opacity: isHovered(st) ? 0.85 : 1 }]}
        >
          <Avatar name={state.members[m.id]?.name ?? '?'} size={40} ring={m.id === ME} />
          <View style={{ flex: 1 }}>
            <T size={16} weight="bold">
              {nameOf(m.id)}
            </T>
            {tags.length ? (
              <T size={13} color={theme.c.muted}>
                {tags.join(' · ')}
              </T>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T size={12} color={theme.c.muted}>
              {b > 0n ? 'gets back' : b < 0n ? 'owes' : 'settled'}
            </T>
            {b !== 0n ? (
              <T size={15} weight="bold" color={b > 0n ? theme.c.get : theme.c.owe}>
                {inr(b < 0n ? -b : b)}
              </T>
            ) : null}
          </View>
        </Pressable>
        {confirming === 'remove' ? (
          <Card style={{ borderColor: theme.c.owe, borderWidth: 1.5 }}>
            <T size={15} weight="bold">
              Remove {nameOf(m.id)} from {group.name}?
            </T>
            <T size={14} color={theme.c.muted}>
              {b === 0n
                ? 'Their expenses stay in the history. They can still see their own payments.'
                : `${nameOf(m.id)} still ${b < 0n ? `owes ${inr(-b)}` : `gets back ${inr(b)}`}. That stays in the balances, and they can still settle up with you after leaving.`}
            </T>
            <View style={[styles.row, { gap: 10 }]}>
              <Button
                title="Remove"
                size="md"
                variant="danger"
                flex={1}
                onPress={() => {
                  dispatch({ type: 'remove_member', groupId: group.id, memberId: m.id, acknowledgeBalance: true });
                  setConfirm(null);
                }}
              />
              <Button title="Cancel" size="md" variant="secondary" flex={1} onPress={() => setConfirm(null)} />
            </View>
          </Card>
        ) : confirming === 'owner' ? (
          <Card style={{ borderColor: theme.c.primary, borderWidth: 1.5 }}>
            <T size={15} weight="bold">
              Make {nameOf(m.id)} the owner?
            </T>
            <T size={14} color={theme.c.muted}>
              {nameOf(m.id)} gets full control: settings, admins, finishing the group. You stay on as an admin and can leave if you want. Only the new owner can change this back.
            </T>
            <View style={[styles.row, { gap: 10 }]}>
              <Button
                title="Make owner"
                size="md"
                flex={1}
                onPress={() => {
                  dispatch({ type: 'make_owner', groupId: group.id, memberId: m.id });
                  setConfirm(null);
                }}
              />
              <Button title="Cancel" size="md" variant="secondary" flex={1} onPress={() => setConfirm(null)} />
            </View>
          </Card>
        ) : promotable || removable ? (
          <View style={[styles.row, { gap: 8, marginLeft: 52, flexWrap: 'wrap' }]}>
            {promotable ? (
              <Button
                title={m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                size="sm"
                variant="secondary"
                onPress={() => dispatch({ type: 'set_role', groupId: group.id, memberId: m.id, role: m.role === 'admin' ? 'member' : 'admin' })}
              />
            ) : null}
            {promotable ? <Button title="Make owner" size="sm" variant="secondary" onPress={() => setConfirm({ kind: 'owner', id: m.id })} /> : null}
            {removable ? <Button title="Remove" size="sm" variant="danger-text" onPress={() => setConfirm({ kind: 'remove', id: m.id })} /> : null}
          </View>
        ) : null}
        {owner && m.active && !m.joined ? (
          <T size={12} color={theme.c.muted} style={{ marginLeft: 52 }}>
            Can be made an admin once they join with your invite link.
          </T>
        ) : null}
      </View>
    );
  };

  return (
    <Screen maxWidth={620}>
      <Header title="Members" back={`/group/${group.id}`} />
      <View style={styles.between}>
        <T size={22} weight="heavy" style={{ flex: 1 }} numberOfLines={1}>
          {group.name}
        </T>
        {editable ? <Button title="Invite link" icon="user-plus" size="md" variant="secondary" onPress={invite} /> : null}
      </View>
      {notice ? (
        <T size={13} weight="semibold" color={theme.c.muted}>
          {notice}
        </T>
      ) : null}

      <Card>
        <Label>{`${current.length} ${current.length === 1 ? 'person' : 'people'}`}</Label>
        {current.map(row)}
      </Card>

      {editable ? (
        <View style={{ gap: 8 }}>
          <Label>Add someone by name</Label>
          <View style={[styles.row, { gap: 8 }]}>
            <Field
              accessibilityLabel="Name of the person to add"
              placeholder="e.g. Rahul"
              value={name}
              onChangeText={setName}
              onSubmitEditing={add}
              returnKeyType="done"
              style={{ flex: 1, minWidth: 0 }}
            />
            <Button title="Add" size="md" disabled={!name.trim() || taken} onPress={add} />
          </View>
          <T size={13} color={taken ? theme.c.owe : theme.c.muted}>
            {taken
              ? 'Someone in the group already has this name.'
              : 'You can split expenses with them right away. They take over their name when they open your invite link.'}
          </T>
        </View>
      ) : null}

      {former.length ? (
        <Card>
          <Label>Left the group</Label>
          {former.map(row)}
        </Card>
      ) : null}

      <Card>
        <Label>Leave the group</Label>
        {ownerStuck ? (
          <T size={14} color={theme.c.muted}>
            You’re the owner. To leave, first make someone else the owner (tap “Make owner” next to their name).
          </T>
        ) : confirm?.kind === 'leave' ? (
          <>
            <T size={14} color={theme.c.muted}>
              {myBalance === 0n
                ? `You’ll stop seeing new things in ${group.name}. Your past expenses stay in its history.`
                : `You still ${myBalance < 0n ? `owe ${inr(-myBalance)}` : `get back ${inr(myBalance)}`}. That stays in the balances, and you can still settle up after leaving.`}
            </T>
            <View style={[styles.row, { gap: 10 }]}>
              <Button
                title="Leave"
                size="md"
                variant="danger"
                flex={1}
                onPress={() => {
                  dispatch({ type: 'leave_group', groupId: group.id, acknowledgeBalance: true });
                  setConfirm(null);
                  router.replace('/');
                }}
              />
              <Button title="Cancel" size="md" variant="secondary" flex={1} onPress={() => setConfirm(null)} />
            </View>
          </>
        ) : (
          <View style={{ alignSelf: 'flex-start' }}>
            <Button title="Leave group" icon="log-out" size="md" variant="danger-text" onPress={() => setConfirm({ kind: 'leave' })} />
          </View>
        )}
      </Card>
      {sheet}
    </Screen>
  );
}
