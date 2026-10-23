import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { ME, type InboxItem, balanceOf, groupExpenses, inbox, inboxHref, inr, netAll, newMarks } from '../src/data/model';
import { useMyName, useStore } from '../src/data/StoreProvider';
import { useTheme } from '../src/theme/ThemeProvider';
import { Avatar, BigAmount, Button, Card, Divider, Dot, Label, Note, Screen, T, styles, useWide } from '../src/ui/kit';
import { Logo } from '../src/ui/Logo';
import { ThemePicker } from '../src/ui/ThemePicker';

const KIND_ICON = { trip: 'airplane', home: 'home-outline', food: 'silverware-fork-knife' } as const;

export default function Home() {
  const { theme } = useTheme();
  const { state, sync } = useStore();
  const myName = useMyName();
  const wide = useWide();
  const [picker, setPicker] = useState(false);
  const receipt = theme.family === 'receipt';
  const { net, get, pay } = netAll(state);
  const items = inbox(state);
  const marks = newMarks(state);

  const openItem = (i: InboxItem) => router.push(inboxHref(i) as never);

  const netBlock = (
    <View style={{ gap: 4 }}>
      <Label>{receipt ? 'Your net · all groups' : net >= 0n ? 'Overall, you get back' : 'Overall, you owe'}</Label>
      <BigAmount size={wide ? 56 : 46} color={net >= 0n ? theme.c.get : theme.c.owe}>
        {receipt ? inr(net, { sign: true }) : inr(net < 0n ? -net : net)}
      </BigAmount>
      {receipt ? (
        <View style={{ gap: 4, marginTop: 6 }}>
          <Divider />
          <View style={styles.between}>
            <T mono>TO GET</T>
            <T mono>{inr(get, { symbol: false })}</T>
          </View>
          <View style={styles.between}>
            <T mono>TO PAY</T>
            <T mono>{inr(pay, { symbol: false })}</T>
          </View>
        </View>
      ) : (
        <T size={14} color={theme.c.muted}>
          {inr(get)} to get · {inr(pay)} to pay
        </T>
      )}
    </View>
  );

  return (
    <Screen maxWidth={wide ? 1100 : 560} footer={wide ? undefined : <Button title="New group" icon="plus" onPress={() => router.push('/new')} />}>
      {!wide ? (
        <View style={styles.between}>
          <Logo />
          <Pressable accessibilityRole="button" accessibilityLabel="Change theme" onPress={() => setPicker(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MaterialCommunityIcons name="palette-outline" size={22} color={theme.c.text} />
            <Avatar name={myName} size={36} />
          </Pressable>
        </View>
      ) : null}

      <View style={wide ? { flexDirection: 'row', gap: 28, alignItems: 'flex-start' } : { gap: 16 }}>
        <View style={{ flex: wide ? 1 : undefined, gap: 16 }}>
          {receipt ? <Card tear>{netBlock}</Card> : <View style={{ paddingVertical: 6 }}>{netBlock}</View>}

          {items.length > 0 ? (
            receipt ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {items.slice(0, 4).map((i, n) => (
                  <Pressable key={i.key} onPress={() => openItem(i)} style={{ flexBasis: wide ? '31%' : '47%' }}>
                    <Note tilt={n % 2 ? 1.2 : -1.5}>
                      <Label color={theme.c.attnText}>Needs you</Label>
                      <T size={15} weight="bold" color={theme.c.attnText}>
                        {state.members[i.who]?.name} {i.text}
                      </T>
                      <T size={13} weight="bold" color={theme.c.attnText} style={{ textDecorationLine: 'underline' }}>
                        {i.kind === 'payment' ? 'Got it?' : i.kind === 'message' ? 'Reply' : 'Review'}
                      </T>
                    </Note>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Note>
                <Label color={theme.c.attnText}>{`${items.length} thing${items.length > 1 ? 's' : ''} need you`}</Label>
                {items.map((i) => (
                  <Pressable key={i.key} accessibilityRole="button" onPress={() => openItem(i)} style={[styles.between, { paddingVertical: 4 }]}>
                    <T size={15} style={{ flex: 1 }}>
                      <T size={15} weight="bold">
                        {state.members[i.who]?.name}
                      </T>{' '}
                      {i.text}
                    </T>
                    <T size={14} weight="bold" color={theme.c.attnText}>
                      {i.kind === 'payment' ? 'Check' : i.kind === 'message' ? 'Reply' : 'Review'}
                    </T>
                  </Pressable>
                ))}
              </Note>
            )
          ) : null}
        </View>

        <View style={{ flex: wide ? 1 : undefined, gap: 12 }}>
          <View style={styles.between}>
            <Label>Your groups</Label>
            {wide ? <Button title="New group" icon="plus" size="sm" onPress={() => router.push('/new')} /> : null}
          </View>
          {state.groups.length === 0 ? (
            sync !== 'ready' ? (
              <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40 }}>
                <ActivityIndicator color={theme.c.primary} />
                <T size={14} color={theme.c.muted}>
                  {sync === 'offline' ? 'Can’t reach Splitify right now. Trying again…' : 'Loading your groups…'}
                </T>
              </View>
            ) : (
              <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 10 }}>
                <MaterialCommunityIcons name="account-group-outline" size={40} color={theme.c.muted} />
                <T size={18} weight="heavy" style={{ textAlign: 'center' }}>
                  No groups yet
                </T>
                <T size={14} color={theme.c.muted} style={{ textAlign: 'center', maxWidth: 340 }}>
                  Make one for a trip, your flat or a dinner. Add friends by name now; they join later with your invite link.
                </T>
                <View style={{ marginTop: 6 }}>
                  <Button title="Make your first group" icon="plus" size="md" onPress={() => router.push('/new')} />
                </View>
              </Card>
            )
          ) : receipt ? (
            state.groups.map((g) => <Ticket key={g.id} groupId={g.id} />)
          ) : (
            <Card padded={false} style={{ gap: 0 }}>
              {state.groups.map((g, i) => {
                const b = balanceOf(state, g.id, ME);
                const count = groupExpenses(state, g.id).length;
                return (
                  <Pressable
                    key={g.id}
                    accessibilityRole="link"
                    onPress={() => router.push(`/group/${g.id}`)}
                    style={[styles.row, { padding: 16, borderTopWidth: i ? 1 : 0, borderColor: theme.c.border }]}
                  >
                    <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: theme.c.chip, alignItems: 'center', justifyContent: 'center' }}>
                      <MaterialCommunityIcons name={KIND_ICON[g.kind]} size={24} color={theme.dark ? theme.c.muted : theme.c.text} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={[styles.row, { gap: 8 }]}>
                        <T size={16} weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>
                          {g.name}
                        </T>
                        {marks.groups.has(g.id) ? <Dot /> : null}
                      </View>
                      <T size={13} color={theme.c.muted}>
                        {g.members.length} people · {count} expense{count === 1 ? '' : 's'}
                      </T>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <T size={12} color={theme.c.muted}>
                        {b > 0n ? 'you get' : b < 0n ? 'you owe' : ''}
                      </T>
                      <T size={16} weight="bold" color={b > 0n ? theme.c.get : b < 0n ? theme.c.owe : theme.c.muted}>
                        {b === 0n ? 'settled' : inr(b < 0n ? -b : b)}
                      </T>
                    </View>
                  </Pressable>
                );
              })}
            </Card>
          )}
        </View>
      </View>
      <ThemePicker open={picker} onClose={() => setPicker(false)} />
    </Screen>
  );
}

/** Receipt themes show each group as a ticket stub with notches and a dashed tear line. */
function Ticket({ groupId }: { groupId: string }) {
  const { theme } = useTheme();
  const { state } = useStore();
  const g = state.groups.find((x) => x.id === groupId)!;
  const b = balanceOf(state, g.id, ME);
  const count = groupExpenses(state, g.id).length;
  const isNew = newMarks(state).groups.has(g.id);
  const notch = { position: 'absolute' as const, top: '50%' as const, marginTop: -9, width: 18, height: 18, borderRadius: 9, backgroundColor: theme.c.bg };
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(`/group/${g.id}`)} style={{ flexDirection: 'row', backgroundColor: theme.c.surface, minHeight: 74 }}>
      <View style={{ flex: 1, padding: 16, gap: 2 }}>
        <View style={[styles.row, { gap: 8 }]}>
          <T size={19} weight="heavy" numberOfLines={1} color={b === 0n && !isNew ? theme.c.muted : theme.c.text} style={{ flexShrink: 1 }}>
            {g.name}
          </T>
          {isNew ? <Dot /> : null}
        </View>
        <T size={12} mono color={theme.c.muted}>
          {`${g.members.length} PPL · ${count} BILL${count === 1 ? '' : 'S'}`}
        </T>
      </View>
      <View style={{ width: 112, borderLeftWidth: 2, borderStyle: 'dashed', borderColor: theme.c.border, alignItems: 'center', justifyContent: 'center' }}>
        {b === 0n ? (
          <View style={{ borderWidth: 2, borderColor: theme.c.get, paddingHorizontal: 8, paddingVertical: 2, transform: [{ rotate: '-8deg' }] }}>
            <T size={14} mono weight="bold" color={theme.c.get} style={{ letterSpacing: 2 }}>
              PAID
            </T>
          </View>
        ) : (
          <>
            <T size={11} mono color={theme.c.muted}>
              {b > 0n ? 'YOU GET' : 'YOU PAY'}
            </T>
            <T size={18} mono weight="bold" color={b > 0n ? theme.c.get : theme.c.owe}>
              {inr(b < 0n ? -b : b, { symbol: false })}
            </T>
          </>
        )}
      </View>
      <View style={[notch, { left: -9 }]} />
      <View style={[notch, { right: -9 }]} />
    </Pressable>
  );
}
