import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ME,
  type Expense,
  balanceOf,
  current,
  groupExpenses,
  inbox,
  inboxHref,
  inr,
  myEffect,
  myTransfers,
  newMarks,
  transfersOf,
  whyTrace,
} from '../../../src/data/model';
import { useStore } from '../../../src/data/StoreProvider';
import { ExpenseDetail } from '../../../src/screens/ExpenseDetail';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { useInvite } from '../../../src/ui/useInvite';
import { Header } from '../../../src/ui/Header';
import { Missing } from '../../../src/ui/Missing';
import { PeopleStrip } from '../../../src/ui/PeopleStrip';
import { BigAmount, Button, Card, CategoryIcon, Divider, Dot, IconButton, Label, Note, Screen, T, isHovered, styles, useWide } from '../../../src/ui/kit';

const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export default function GroupScreen() {
  const { id, e: wanted } = useLocalSearchParams<{ id: string; e?: string }>();
  const { theme } = useTheme();
  const { state } = useStore();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const group = state.groups.find((g) => g.id === id);
  const { invite, notice, setNotice, sheet } = useInvite(group);
  const expenses = group ? groupExpenses(state, group.id) : [];
  const firstNeedy = expenses.find((e) => e.payer === ME && e.suggestions.some((s) => s.status === 'open')) ?? expenses[0];
  const [selected, setSelected] = useState<string | undefined>(wanted ?? firstNeedy?.id);
  const [why, setWhy] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  // Laptop deep links (/group/x?e=id) pick the expense shown in the side panel.
  useEffect(() => {
    if (wanted) setSelected(wanted);
  }, [wanted]);
  if (!group) return <Missing />;

  const receipt = theme.family === 'receipt';
  const name = (m: string) => (m === ME ? 'You' : state.members[m]?.name ?? m);
  const mine = balanceOf(state, group.id);
  // Who pays me / whom I pay, from the suggested payments (not raw balances, which include debts between others).
  const mineT = myTransfers(state, group.id);
  const owedLine = mineT.length
    ? `${mine > 0n ? 'From' : 'To'} ${mineT.map((t) => `${name(t.to === ME ? t.from : t.to)} ${inr(t.amount)}`).join(' · ')}`
    : '';
  const anyoneOwes = transfersOf(state, group.id).length > 0;
  // A balance can outlive the expenses (e.g. a deleted bill after confirmed payments), so it still shows.
  const showBalance = expenses.length > 0 || mine !== 0n;
  const deleted = state.expenses.filter((e) => e.groupId === group.id && e.deleted);
  const needs = inbox(state).filter((i) => i.groupId === group.id);
  const marks = newMarks(state);
  const settleNew = marks.settle.has(group.id);
  const open = (e: Expense) => (wide ? setSelected(e.id) : router.push(`/group/${group.id}/expense/${e.id}`));


  const balanceBlock = (
    <View style={{ gap: 12 }}>
      <View>
        <Label>{mine > 0n ? 'You get back' : mine < 0n ? 'You owe' : 'All settled'}</Label>
        {mine !== 0n ? (
          <BigAmount size={wide ? 44 : 38} color={mine > 0n ? theme.c.get : theme.c.owe}>
            {receipt ? inr(mine, { sign: true }) : inr(mine < 0n ? -mine : mine)}
          </BigAmount>
        ) : null}
        {owedLine ? (
          <T size={14} color={theme.c.muted} mono={receipt}>
            {owedLine}
          </T>
        ) : null}
      </View>
      <View style={[styles.row, { gap: 10 }]}>
        {anyoneOwes ? (
          <View style={{ flex: 1 }}>
            <Button title="Settle up" size="md" onPress={() => router.push(`/group/${group.id}/settle`)} />
            {settleNew ? <Dot size={14} style={{ position: 'absolute', top: -6, right: -6, borderWidth: 3, borderColor: theme.c.surface }} /> : null}
          </View>
        ) : null}
        <Button title={why ? 'Hide' : anyoneOwes ? 'Why?' : 'How it adds up'} size="md" variant="secondary" flex={anyoneOwes ? undefined : 1} onPress={() => setWhy(!why)} />
      </View>
      {why ? (
        <View style={{ gap: 6 }}>
          {whyTrace(state, group.id).map((r, i) => (
            <View key={i} style={styles.between}>
              <T size={14} mono={receipt}>
                {r.label}
              </T>
              <T size={14} mono={receipt} weight="bold" color={r.amount > 0n ? theme.c.get : theme.c.owe}>
                {inr(r.amount, { sign: true })}
              </T>
            </View>
          ))}
          <Divider />
          <View style={styles.between}>
            <T size={14} weight="bold">
              Total
            </T>
            <T size={14} weight="bold">
              {inr(mine, { sign: true })}
            </T>
          </View>
        </View>
      ) : null}
    </View>
  );

  const needsBlock = needs.length ? (
    <Note>
      {needs.map((n) => (
        <Pressable
          key={n.key}
          accessibilityRole="button"
          onPress={() => (n.expenseId ? open(expenses.find((e) => e.id === n.expenseId)!) : router.push(inboxHref(n) as never))}
          style={styles.between}
        >
          <T size={14} color={theme.c.attnText} style={{ flex: 1 }}>
            <T size={14} weight="bold" color={theme.c.attnText}>
              {name(n.who)}
            </T>{' '}
            {n.text}
          </T>
          <T size={14} weight="bold" color={theme.c.attnText}>
            {n.kind === 'payment' ? 'Check' : n.kind === 'message' ? 'Reply' : 'Review'}
          </T>
        </Pressable>
      ))}
    </Note>
  ) : null;

  const empty = (
    <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 10 }} tear>
      <CategoryIcon icon="other" size={56} />
      <T size={18} weight="heavy" style={{ textAlign: 'center' }}>
        {receipt ? 'Blank bill. Add the first one.' : 'No expenses yet'}
      </T>
      <T size={14} color={theme.c.muted} style={{ textAlign: 'center', maxWidth: 320 }}>
        Add what you paid, or invite friends so they can add theirs. Balances show up here.
      </T>
      <Button title="Invite friends" icon="user-plus" size="md" variant="secondary" onPress={invite} />
    </Card>
  );

  const list = expenses.length === 0 ? empty : receipt ? (
    <Card tear>
      <T size={12} mono color={theme.c.muted} style={{ textAlign: 'center', letterSpacing: 2 }}>
        {group.members.map((m) => state.members[m]?.name.toUpperCase()).join(' ')}
      </T>
      <Divider />
      {expenses.map((e) => {
        const v = current(e);
        const eff = myEffect(e);
        const flagged = e.suggestions.some((s) => s.status === 'open') || e.messages.some((q) => q.kind === 'question' && !q.resolved);
        return (
          <Pressable
            key={e.id}
            accessibilityRole="button"
            onPress={() => open(e)}
            style={(st) => ({ backgroundColor: flagged || (selected === e.id && wide) || isHovered(st) ? theme.c.tint : 'transparent', marginHorizontal: -8, paddingHorizontal: 8, paddingVertical: 6 })}
          >
            <View style={styles.between}>
              <View style={[styles.row, { flex: 1, gap: 6 }]}>
                <T mono weight="bold" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
                  {e.title.toUpperCase()}
                  {v.split.method === 'shares' ? ' · BY NIGHTS' : ''}
                </T>
                {marks.expenses.has(e.id) ? <Dot /> : null}
              </View>
              <T mono weight="bold" size={14}>
                {inr(v.total, { symbol: false })}
              </T>
            </View>
            <View style={styles.between}>
              <T mono size={12} color={theme.c.muted}>
                {`${fmtDay(e.date).toUpperCase()} · ${name(e.payer).toUpperCase()} PAID${flagged ? ' · ✎ NOTE' : ''}`}
              </T>
              <T mono size={12} color={eff > 0n ? theme.c.get : eff < 0n ? theme.c.owe : theme.c.muted}>
                {eff === 0n ? 'NOT IN' : `YOU ${inr(eff, { sign: true, symbol: false })}`}
              </T>
            </View>
          </Pressable>
        );
      })}
      <Divider />
      <View style={styles.between}>
        <T mono size={13} color={theme.c.muted}>
          TOTAL SPENT
        </T>
        <T mono size={13} color={theme.c.muted}>
          {inr(expenses.reduce((a, e) => a + current(e).total, 0n), { symbol: false })}
        </T>
      </View>
      {balanceBlock}
    </Card>
  ) : (
    <View style={{ gap: 10 }}>
      {Object.entries(
        expenses.reduce<Record<string, Expense[]>>((acc, e) => {
          (acc[e.date] ??= []).push(e);
          return acc;
        }, {}),
      ).map(([day, rows]) => (
        <View key={day} style={{ gap: 8 }}>
          <Label>{fmtDay(day)}</Label>
          <Card padded={false} style={{ gap: 0 }}>
            {rows.map((e, i) => {
              const v = current(e);
              const eff = myEffect(e);
              const sug = e.suggestions.filter((s) => s.status === 'open').length;
              const q = e.messages.filter((x) => x.kind === 'question' && !x.resolved).length;
              return (
                <Pressable
                  key={e.id}
                  accessibilityRole="button"
                  onPress={() => open(e)}
                  style={(st) => [
                    styles.row,
                    { padding: 14, borderTopWidth: i ? 1 : 0, borderColor: theme.c.border, backgroundColor: (wide && selected === e.id) || isHovered(st) ? theme.c.tint : 'transparent' },
                  ]}
                >
                  <CategoryIcon icon={e.icon} size={42} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={[styles.row, { gap: 6 }]}>
                      <T size={15} weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {e.title}
                      </T>
                      {marks.expenses.has(e.id) ? <Dot /> : null}
                    </View>
                    <T size={13} color={theme.c.muted}>
                      {name(e.payer)} paid {inr(v.total)}
                      {v.split.method === 'shares' ? ' · by nights' : ''}
                    </T>
                    {sug || q ? (
                      <View style={[styles.row, { gap: 6, marginTop: 4 }]}>
                        {sug ? <Pill text={`${sug} suggestion`} /> : null}
                        {q ? <Pill text={`${q} question`} /> : null}
                      </View>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <T size={12} color={theme.c.muted}>
                      {eff > 0n ? 'you lent' : eff < 0n ? 'you owe' : 'not in it'}
                    </T>
                    {eff !== 0n ? (
                      <T size={15} weight="bold" color={eff > 0n ? theme.c.get : theme.c.owe}>
                        {inr(eff < 0n ? -eff : eff)}
                      </T>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </Card>
        </View>
      ))}
    </View>
  );

  // Deleted expenses stay restorable by their owner, so they are listed (collapsed) under the rest.
  const deletedBlock = deleted.length ? (
    <View style={{ gap: 6 }}>
      <Pressable accessibilityRole="button" onPress={() => setShowDeleted(!showDeleted)}>
        <T size={14} weight="bold" color={theme.c.muted}>
          {showDeleted ? 'Hide deleted' : `Deleted (${deleted.length})`}
        </T>
      </Pressable>
      {showDeleted
        ? deleted.map((e) => (
            <Pressable key={e.id} accessibilityRole="button" onPress={() => open(e)} style={[styles.between, { paddingVertical: 6 }]}>
              <T size={14} color={theme.c.muted} mono={receipt} style={{ textDecorationLine: 'line-through', flex: 1 }}>
                {e.title}
              </T>
              <T size={14} color={theme.c.muted} mono={receipt}>
                {inr(current(e).total)}
              </T>
            </Pressable>
          ))
        : null}
    </View>
  ) : null;

  const header = (
    <View style={{ gap: 6 }}>
      <Header
        title={receipt ? undefined : group.name}
        right={
          <View style={{ flexDirection: 'row' }}>
            <IconButton icon="users" label="Members" onPress={() => router.push(`/group/${group.id}/members`)} />
            <IconButton icon="user-plus" label="Invite friends" onPress={invite} />
          </View>
        }
      />
      {notice ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${notice} Tap to hide.`} onPress={() => setNotice(null)}>
          <T size={13} weight="semibold" color={theme.c.muted} style={{ textAlign: 'center' }}>
            {notice}
          </T>
        </Pressable>
      ) : null}
    </View>
  );
  const footer = (
    <View style={[styles.row, { gap: 10 }]}>
      {receipt && anyoneOwes ? (
        <View style={{ flex: 1 }}>
          <Button title="Settle" variant="secondary" onPress={() => router.push(`/group/${group.id}/settle`)} />
          {settleNew ? <Dot size={14} style={{ position: 'absolute', top: -6, right: -6, borderWidth: 3, borderColor: theme.c.bg }} /> : null}
        </View>
      ) : null}
      <Button title={receipt ? '+ Add a bill' : 'Add expense'} icon={receipt ? undefined : 'plus'} flex={2} onPress={() => router.push(`/group/${group.id}/add`)} />
    </View>
  );

  if (wide) {
    // Includes a just-deleted expense so its Restore button stays reachable.
    const sel = state.expenses.find((e) => e.id === selected && e.groupId === group.id);
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.c.bg }}>
        <ScrollView style={{ flex: 1.3 }} contentContainerStyle={{ padding: 32, gap: 18, maxWidth: 760 }}>
          <View style={styles.between}>
            <T size={receipt ? 40 : 30} weight="heavy" style={{ letterSpacing: receipt ? -1.5 : -0.5 }}>
              {group.name}
            </T>
            <View style={[styles.row, { gap: 10 }]}>
              <Button title="Invite" size="md" variant="secondary" icon="user-plus" onPress={invite} />
              <Button title={receipt ? '+ Add a bill' : 'Add expense'} size="md" icon={receipt ? undefined : 'plus'} onPress={() => router.push(`/group/${group.id}/add`)} />
            </View>
          </View>
          {receipt || !showBalance ? null : <Card>{balanceBlock}</Card>}
          {receipt && expenses.length === 0 && showBalance ? <Card>{balanceBlock}</Card> : null}
          {needsBlock}
          {list}
          {deletedBlock}
          {sheet}
        </ScrollView>
        <ScrollView
          style={{ flex: 1, borderLeftWidth: receipt ? 2 : 1, borderStyle: receipt ? 'dashed' : 'solid', borderColor: theme.c.border, backgroundColor: receipt ? theme.c.bg : theme.c.surface }}
          contentContainerStyle={{ padding: 28, paddingTop: 32 + insets.top }}
        >
          {sel ? (
            <ExpenseDetail key={sel.id} expense={sel} />
          ) : (
            <T color={theme.c.muted}>{expenses.length ? 'Select an expense to see its detail.' : 'Details of each expense show up here.'}</T>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <Screen maxWidth={640} footer={footer}>
      {header}
      {receipt ? (
        <T size={30} weight="heavy" style={{ letterSpacing: -1, marginTop: -6 }}>
          {group.name}
        </T>
      ) : showBalance ? (
        <Card>{balanceBlock}</Card>
      ) : null}
      {receipt && expenses.length === 0 && showBalance ? <Card>{balanceBlock}</Card> : null}
      <PeopleStrip groupId={group.id} />
      {needsBlock}
      {list}
      {deletedBlock}
      {sheet}
    </Screen>
  );
}

function Pill({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ backgroundColor: theme.c.attnBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, borderWidth: theme.dark ? 1 : 0, borderColor: theme.c.attnBorder }}>
      <T size={12} weight="semibold" color={theme.c.attnText}>
        {text}
      </T>
    </View>
  );
}
