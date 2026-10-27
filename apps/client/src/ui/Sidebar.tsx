import { Feather } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ME, balanceOf, betweenMe, groupPhase, inbox, inr, netAll, newMarks } from '../data/model';
import { useMyName, useStore } from '../data/StoreProvider';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar, BigAmount, Dot, Label, T } from './kit';
import { Logo } from './Logo';
import { ThemePicker } from './ThemePicker';
import { useAppVersion } from './useAppVersion';

/** Laptop-only left column: overall balance, inbox count, groups and the theme switcher. */
export function Sidebar() {
  const { theme } = useTheme();
  const { state } = useStore();
  const myName = useMyName();
  const path = usePathname();
  const [picker, setPicker] = useState(false);
  const { update } = useAppVersion();
  const { net } = netAll(state);
  const needs = inbox(state).length;
  const marks = newMarks(state);
  const receipt = theme.family === 'receipt';

  const item = (active: boolean) => ({
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: receipt ? 0 : 12,
    backgroundColor: active ? (receipt ? theme.c.surface : theme.c.tint) : 'transparent',
  });

  return (
    <View
      style={{
        width: 260,
        paddingHorizontal: 18,
        paddingVertical: 28,
        gap: 6,
        backgroundColor: receipt ? theme.c.bg : theme.c.surface,
        borderRightWidth: receipt ? 2 : 1,
        borderStyle: receipt ? 'dashed' : 'solid',
        borderColor: theme.c.border,
      }}
    >
      <View style={{ paddingHorizontal: 8, paddingBottom: 18 }}>
        <Logo />
      </View>
      <View style={{ paddingHorizontal: 8, paddingBottom: 12, gap: 2 }}>
        <Label>{net >= 0n ? 'Overall, you get back' : 'Overall, you owe'}</Label>
        <BigAmount size={28} color={net >= 0n ? theme.c.get : theme.c.owe}>
          {inr(net < 0n ? -net : net)}
        </BigAmount>
      </View>
      <Pressable accessibilityRole="link" onPress={() => router.navigate('/groups')} style={item(path === '/groups')}>
        <T size={15} weight="bold">
          Home
        </T>
        {needs > 0 ? (
          <View style={{ backgroundColor: theme.c.primary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}>
            <T size={12} weight="bold" color={theme.c.onPrimary}>
              {String(needs)}
            </T>
          </View>
        ) : null}
      </Pressable>
      <View style={{ paddingHorizontal: 12, paddingTop: 16, paddingBottom: 4 }}>
        <Label>Groups</Label>
      </View>
      {/* Closed groups (finished, everyone square) go last. */}
      {[...state.groups].sort((x, y) => Number(groupPhase(state, x.id) === 'closed') - Number(groupPhase(state, y.id) === 'closed')).map((g) => {
        const b = balanceOf(state, g.id, ME);
        const closed = groupPhase(state, g.id) === 'closed';
        const active = path.startsWith(`/group/${g.id}`);
        const people = (state.roster[g.id] ?? []).filter((m) => m.active && m.id !== ME);
        const myRole = (state.roster[g.id] ?? []).find((m) => m.id === ME)?.role;
        return (
          <View key={g.id}>
            <Pressable accessibilityRole="link" onPress={() => router.navigate(`/group/${g.id}`)} style={item(active)}>
              <T size={15} weight={active || marks.groups.has(g.id) ? 'bold' : 'semibold'} mono={receipt} numberOfLines={1} color={closed && !active ? theme.c.muted : theme.c.text} style={{ flex: 1 }}>
                {receipt ? g.name.toUpperCase() : g.name}
              </T>
              {marks.groups.has(g.id) ? <Dot style={{ marginRight: 8 }} /> : null}
              <T size={14} weight="bold" mono={receipt} color={b > 0n ? theme.c.get : b < 0n ? theme.c.owe : theme.c.muted}>
                {closed ? (receipt ? 'PAID' : 'closed') : b === 0n ? (receipt ? 'SETTLED' : 'settled') : inr(b, { sign: true, symbol: !receipt })}
              </T>
            </Pressable>
            {active ? (
              // The open group's people, drawn as branches of the group: tap someone to settle up and
              // chat privately with them.
              <View style={{ paddingTop: 2, paddingBottom: 6 }}>
                <Branch>
                  <View style={[item(false), { paddingVertical: 6, gap: 8 }]}>
                    <Avatar name={myName} size={24} ring />
                    <T size={14} weight="medium" numberOfLines={1} style={{ flex: 1 }}>
                      You
                      {myRole && myRole !== 'member' ? <T size={12} color={theme.c.muted}>{`  ${myRole}`}</T> : null}
                    </T>
                  </View>
                </Branch>
                {people.map((m) => {
                  const here = path === `/group/${g.id}/with/${m.id}`;
                  const isUnread = marks.people.has(`${g.id}|${m.id}`);
                  // What's between us in the settle-up plan: + they pay me, − I pay them.
                  const mb = betweenMe(state, g.id, m.id);
                  const who = state.members[m.id]?.name ?? 'Member';
                  return (
                    <Branch key={m.id}>
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`${who}${mb > 0n ? `, pays you ${inr(mb)}` : mb < 0n ? `, you pay ${inr(-mb)}` : ''}${isUnread ? ', something new' : ''}`}
                      onPress={() => router.navigate(`/group/${g.id}/with/${m.id}`)}
                      style={[item(here), { paddingVertical: 6, gap: 8 }]}
                    >
                      <Avatar name={state.members[m.id]?.name ?? '?'} size={24} />
                      <T size={14} weight={isUnread ? 'bold' : 'medium'} numberOfLines={1} style={{ flex: 1 }}>
                        {state.members[m.id]?.name ?? 'Member'}
                        {m.role !== 'member' ? <T size={12} color={theme.c.muted}>{m.role === 'owner' ? '  owner' : '  admin'}</T> : null}
                        {!m.joined ? <T size={12} color={theme.c.muted}>{'  not joined'}</T> : null}
                      </T>
                      {isUnread ? <Dot /> : null}
                      <T size={12} weight="semibold" color={mb > 0n ? theme.c.get : mb < 0n ? theme.c.owe : theme.c.muted}>
                        {mb === 0n ? '' : inr(mb, { sign: true })}
                      </T>
                    </Pressable>
                    </Branch>
                  );
                })}
                <Branch last>
                  <Pressable accessibilityRole="link" onPress={() => router.navigate(`/group/${g.id}/members`)} style={{ paddingVertical: 7, paddingHorizontal: 12 }}>
                    <T size={13} weight="bold" color={theme.c.get}>
                      Manage members
                    </T>
                  </Pressable>
                </Branch>
              </View>
            ) : null}
          </View>
        );
      })}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.navigate('/new')}
        style={{ marginTop: 10, height: 44, borderRadius: receipt ? 999 : 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.c.borderStrong, alignItems: 'center', justifyContent: 'center' }}
      >
        <T size={14} weight="bold" color={theme.c.muted}>
          + New group
        </T>
      </Pressable>
      <View style={{ flex: 1 }} />
      <Pressable accessibilityRole="button" onPress={() => setPicker(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 }}>
        <Avatar name={myName} size={34} />
        <View style={{ flex: 1 }}>
          <T size={14} weight="bold">
            {myName}
          </T>
          <T size={12} color={update ? theme.c.primary : theme.c.muted} weight={update ? 'bold' : 'regular'}>
            {update ? 'New version ready' : `Theme: ${theme.name}`}
          </T>
        </View>
        {update ? <Dot /> : null}
        <Feather name="sliders" size={18} color={theme.c.muted} />
      </Pressable>
      <ThemePicker open={picker} onClose={() => setPicker(false)} />
    </View>
  );
}

/**
 * One row of the open group's tree: a line runs down from the group with a branch to each person,
 * and the last row turns the corner (├ … └), so it reads as "these people belong to this group".
 */
function Branch({ last = false, children }: { last?: boolean; children: ReactNode }) {
  const { theme } = useTheme();
  const line = { position: 'absolute' as const, left: 18, opacity: 0.6, borderColor: theme.c.muted, borderStyle: theme.family === 'receipt' ? ('dashed' as const) : ('solid' as const) };
  return (
    <View style={{ paddingLeft: 26 }}>
      {last ? (
        <View style={[line, { top: 0, height: '50%', width: 19, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderBottomLeftRadius: 8 }]} />
      ) : (
        <>
          <View style={[line, { top: 0, bottom: 0, borderLeftWidth: 1.5 }]} />
          <View style={[line, { top: '50%', width: 19, borderTopWidth: 1.5 }]} />
        </>
      )}
      {children}
    </View>
  );
}
