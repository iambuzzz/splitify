import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, View } from 'react-native';
import { ME, explainBalance, inr } from '../../../src/data/model';
import { useStore } from '../../../src/data/StoreProvider';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { Header } from '../../../src/ui/Header';
import { Missing } from '../../../src/ui/Missing';
import { Avatar, BigAmount, Card, Divider, Label, Screen, T, isHovered, styles } from '../../../src/ui/kit';

const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/**
 * "Why do I owe this?": my balance built up from every bill and payment, then why the plan has me pay
 * (or get paid by) particular people, who may not be the ones who paid my bills.
 */
export default function Why() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const { state } = useStore();
  const group = state.groups.find((g) => g.id === id);
  if (!group) return <Missing />;

  const receipt = theme.family === 'receipt';
  const name = (m: string) => (m === ME ? 'You' : state.members[m]?.name ?? m);
  const x = explainBalance(state, group.id);
  const color = (v: bigint) => (v > 0n ? theme.c.get : v < 0n ? theme.c.owe : theme.c.muted);
  const headline = x.balance > 0n ? 'You get back' : x.balance < 0n ? 'You owe' : 'You are settled';

  const sum = (label: string, value: bigint, hint?: string) => (
    <View style={styles.between}>
      <View style={{ flex: 1 }}>
        <T size={15} mono={receipt}>
          {label}
        </T>
        {hint ? (
          <T size={12} color={theme.c.muted}>
            {hint}
          </T>
        ) : null}
      </View>
      <T size={15} weight="bold" mono={receipt}>
        {inr(value)}
      </T>
    </View>
  );

  // Who is owed and who owes, with the plan's payments for me.
  const owed = x.balances.filter((b) => b.amount > 0n);
  const owing = x.balances.filter((b) => b.amount < 0n);

  return (
    <Screen maxWidth={640}>
      <Header back={`/group/${group.id}`} title="How it adds up" />

      <View>
        <Label>{`${group.name} · ${headline.toLowerCase()}`}</Label>
        <BigAmount size={38} color={color(x.balance)}>
          {inr(x.balance < 0n ? -x.balance : x.balance)}
        </BigAmount>
      </View>

      <Card>
        {sum('You paid for the group', x.paid, x.paid ? 'Bills you paid, in full' : undefined)}
        {sum('Your share of the bills', x.share, 'Your part of every bill you were in')}
        {x.sent ? sum('Payments you made', x.sent) : null}
        {x.received ? sum('Payments you received', x.received) : null}
        <Divider />
        <View style={styles.between}>
          <T size={15} weight="heavy">
            {headline}
          </T>
          <T size={15} weight="heavy" color={color(x.balance)}>
            {inr(x.balance < 0n ? -x.balance : x.balance)}
          </T>
        </View>
        <T size={12} color={theme.c.muted}>
          {`${inr(x.paid)} paid − ${inr(x.share)} share${x.sent ? ` + ${inr(x.sent)} sent` : ''}${x.received ? ` − ${inr(x.received)} received` : ''}`}
        </T>
      </Card>

      {x.plan.length ? (
        <Card>
          <Label>{x.balance < 0n ? 'Whom you pay, and why them' : 'Who pays you, and why them'}</Label>
          {x.plan.map((t, i) => {
            const other = t.from === ME ? t.to : t.from;
            return (
              <View key={i} style={[styles.row, { gap: 10 }]}>
                <Avatar name={name(other)} size={32} />
                <T size={15} weight="bold" style={{ flex: 1 }}>
                  {t.from === ME ? `You pay ${name(other)}` : `${name(other)} pays you`}
                </T>
                <T size={15} weight="bold" color={t.from === ME ? theme.c.owe : theme.c.get}>
                  {inr(t.amount)}
                </T>
              </View>
            );
          })}
          <T size={14} color={theme.c.muted}>
            Splitify adds up everyone’s balance first, then settles the whole group in the fewest payments. So it doesn’t matter who paid which bill: what matters is who is owed money overall.
            {x.balance < 0n && x.plan.length === 1 && x.plan[0]!.to !== ME
              ? ` ${name(x.plan[0]!.to)} is owed ${inr(x.balances.find((b) => b.memberId === x.plan[0]!.to)?.amount ?? 0n)} in total, so your payment goes to them.`
              : ''}
          </T>
          <Divider />
          <Label>Everyone’s balance</Label>
          {[...owed, ...owing].map((b) => (
            <View key={b.memberId} style={styles.between}>
              <T size={14} mono={receipt}>
                {name(b.memberId)}
              </T>
              <T size={14} weight="semibold" color={color(b.amount)} mono={receipt}>
                {b.amount > 0n ? `gets back ${inr(b.amount)}` : `owes ${inr(-b.amount)}`}
              </T>
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <Label>{`Bills you were in (${x.expenses.length})`}</Label>
        {x.expenses.length === 0 ? (
          <T size={14} color={theme.c.muted}>
            You aren’t in any bill in this group yet.
          </T>
        ) : (
          x.expenses.map((r) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              accessibilityLabel={`${r.title}, open`}
              onPress={() => router.push(`/group/${group.id}/expense/${r.id}`)}
              style={(s) => [styles.between, { paddingVertical: 4, opacity: isHovered(s) ? 0.8 : 1 }]}
            >
              <View style={{ flex: 1 }}>
                <T size={15} weight="semibold" mono={receipt}>
                  {r.title}
                </T>
                <T size={12} color={theme.c.muted}>
                  {`${fmtDay(r.date)} · ${r.paid ? `you paid ${inr(r.paid)} · ` : ''}your share ${inr(r.share)}`}
                </T>
              </View>
              <T size={15} weight="bold" color={color(r.effect)} mono={receipt}>
                {inr(r.effect, { sign: true })}
              </T>
            </Pressable>
          ))
        )}
        {x.payments.length ? (
          <>
            <Divider />
            <Label>Payments</Label>
            {x.payments.map((p) => (
              <View key={p.id} style={styles.between}>
                <T size={14} mono={receipt}>
                  {p.sent ? `You paid ${name(p.other)}` : `${name(p.other)} paid you`}
                </T>
                <T size={14} weight="bold" color={p.sent ? theme.c.get : theme.c.owe} mono={receipt}>
                  {inr(p.sent ? p.amount : -p.amount, { sign: true })}
                </T>
              </View>
            ))}
          </>
        ) : null}
      </Card>
    </Screen>
  );
}
