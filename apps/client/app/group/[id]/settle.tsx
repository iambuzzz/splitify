import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { ME, answersPayment, balanceOf, groupPhase, inr, memberName, transfersOf } from '../../../src/data/model';
import { appUrl, useStore } from '../../../src/data/StoreProvider';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { Header } from '../../../src/ui/Header';
import { Missing } from '../../../src/ui/Missing';
import { Avatar, BigAmount, Button, Card, Label, Note, Screen, T, styles } from '../../../src/ui/kit';
import { ConfirmPayment, type PaymentDraft, PaymentList } from '../../../src/ui/Payments';

/** Who pays whom. Payments the payer records wait for the receiver; the app never claims a payment is verified. */
export default function Settle() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const { state, dispatch, account } = useStore();
  const [ask, setAsk] = useState<PaymentDraft | null>(null);
  const group = state.groups.find((g) => g.id === id);
  if (!group) return <Missing />;
  const receipt = theme.family === 'receipt';
  const name = (m: string) => (m === ME ? 'You' : state.members[m]?.name ?? m);
  const mine = balanceOf(state, group.id);
  const transfers = transfersOf(state, group.id);
  // Mine to answer, and (owner or admin) those to someone who hasn't joined yet.
  const waitingForMe = state.payments.filter((p) => p.groupId === group.id && p.status === 'awaiting' && answersPayment(state, p));
  const myPending = state.payments.filter((p) => p.groupId === group.id && p.status === 'awaiting' && p.from === ME);
  const closed = groupPhase(state, group.id) === 'closed';
  // Asking happens right under the payment it's about.
  const asking = (t: { from: string; to: string }) => ask && ask.from === t.from && ask.to === t.to;
  /**
   * WhatsApp message with a link: to this settle page for someone who has signed up (signed out,
   * they sign in first and land back here), or an invite for a name a friend added (join, then pay).
   */
  const remind = async (who: string, amount: bigint) => {
    const joined = state.roster[group.id]?.find((m) => m.id === who)?.joined ?? false;
    // An invite needs a round trip; open the window now so the browser doesn't block it as a popup.
    const tab = Platform.OS === 'web' && !joined ? window.open('', '_blank') : null;
    const link = joined ? `${appUrl()}/group/${group.id}/settle` : account ? await account.inviteLink(group.id).catch(() => null) : null;
    const how = joined ? 'See it and pay here' : 'Join the group on Splitify to see it and pay';
    const text = `Hi ${name(who)}! ${group.name} settle-up on Splitify: you owe me ${inr(amount)}. Thanks!` + (link ? `\n\n${how}:\n${link}` : '');
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    if (tab) tab.location.href = url;
    else Linking.openURL(url).catch(() => {});
  };

  return (
    <Screen maxWidth={640}>
      <Header back={`/group/${group.id}`} title={receipt ? undefined : 'Settle up'} />

      {receipt ? (
        <T size={34} weight="heavy" style={{ letterSpacing: -1, lineHeight: 38 }}>
          {transfers.length === 0 ? 'All settled. Nice.' : `${transfers.length} payment${transfers.length > 1 ? 's' : ''} and you're done.`}
        </T>
      ) : (
        <View>
          <Label>{`${group.name} · ${mine > 0n ? 'you get back' : mine < 0n ? 'you owe' : 'all settled'}`}</Label>
          {mine !== 0n ? (
            <BigAmount size={38} color={mine > 0n ? theme.c.get : theme.c.owe}>
              {inr(mine < 0n ? -mine : mine)}
            </BigAmount>
          ) : null}
        </View>
      )}

      {waitingForMe.map((p) => (
        <Note key={p.id} tilt={1}>
          <View style={styles.row}>
            <Avatar name={memberName(state, p.from)} size={38} />
            <View style={{ flex: 1 }}>
              <T size={16} weight="bold" color={theme.c.attnText}>
                {name(p.from)} says they paid {p.to === ME ? 'you' : name(p.to)} {inr(p.amount)}
              </T>
              <T size={13} color={theme.c.attnText}>
                {p.to === ME
                  ? `via ${p.via === 'upi' ? 'UPI' : 'cash'} · counts only after you confirm`
                  : `via ${p.via === 'upi' ? 'UPI' : 'cash'} · ${name(p.to)} hasn’t joined, so you can confirm for them. Everyone sees you did.`}
              </T>
            </View>
          </View>
          <View style={[styles.row, { gap: 10 }]}>
            <Button title={p.to === ME ? 'Yes, got it' : `Yes, ${name(p.to)} got it`} size="md" flex={1} onPress={() => dispatch({ type: 'confirm_payment', id: p.id })} />
            <Button title="Not yet" size="md" variant="secondary" flex={1} onPress={() => dispatch({ type: 'decline_payment', id: p.id })} />
          </View>
        </Note>
      ))}

      <Card tear>
        {!receipt ? <Label>Suggested payments</Label> : null}
        {transfers.length === 0 ? (
          <T color={theme.c.muted}>Everyone is settled up.</T>
        ) : (
          transfers.map((t, i) => {
            const pending = myPending.find((p) => p.to === t.to && p.from === t.from);
            const claimed = waitingForMe.find((p) => p.from === t.from);
            return (
              <View key={i} style={{ gap: 10, paddingVertical: 6, borderTopWidth: i ? (receipt ? 2 : 1) : 0, borderStyle: receipt ? 'dashed' : 'solid', borderColor: theme.c.border }}>
                <View style={[styles.row, { gap: 8 }]}>
                  <Avatar name={memberName(state, t.from)} size={38} />
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <T mono={receipt} size={15} weight="bold" color={claimed ? theme.c.get : theme.c.text}>
                      {inr(t.amount)}
                      {claimed ? ' sent?' : ''}
                    </T>
                    <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ flex: 1, borderTopWidth: 2, borderStyle: claimed ? 'solid' : 'dashed', borderColor: claimed ? theme.c.get : theme.c.text }} />
                      <Feather name="chevron-right" size={18} color={claimed ? theme.c.get : theme.c.text} style={{ marginLeft: -6 }} />
                    </View>
                  </View>
                  <Avatar name={memberName(state, t.to)} size={38} ring={t.to === ME} />
                </View>
                <T size={14} color={theme.c.muted}>
                  {t.from === ME ? `You pay ${name(t.to)}` : `${name(t.from)} pays ${t.to === ME ? 'you' : name(t.to)}`}
                </T>
                {asking(t) ? (
                  <ConfirmPayment groupId={group.id} draft={ask!} name={(m) => name(m)} onDone={() => setAsk(null)} />
                ) : t.to === ME && !claimed ? (
                  <View style={[styles.row, { gap: 8, flexWrap: 'wrap' }]}>
                    <Button title="Remind on WhatsApp" size="sm" variant="secondary" icon="message-circle" onPress={() => remind(t.from, t.amount)} />
                    <Button
                      title="Mark received"
                      size="sm"
                      variant="secondary"
                      onPress={() => setAsk({ from: t.from, to: ME, amount: t.amount, via: 'cash' })}
                    />
                  </View>
                ) : null}
                {t.from === ME && !asking(t) ? (
                  pending ? (
                    <View style={[styles.between, { gap: 10 }]}>
                      <T size={14} weight="bold" color={theme.c.muted} style={{ flex: 1 }}>
                        Waiting for {name(t.to)} to confirm your {inr(pending.amount)}.
                      </T>
                      <Button title="Cancel" size="sm" variant="secondary" onPress={() => dispatch({ type: 'withdraw_payment', id: pending.id })} />
                    </View>
                  ) : (
                    <View style={[styles.row, { gap: 8, flexWrap: 'wrap' }]}>
                      <Button
                        title="I've paid (UPI)"
                        size="sm"
                        onPress={() => setAsk({ from: ME, to: t.to, amount: t.amount, via: 'upi' })}
                      />
                      <Button
                        title="Paid in cash"
                        size="sm"
                        variant="secondary"
                        onPress={() => setAsk({ from: ME, to: t.to, amount: t.amount, via: 'cash' })}
                      />
                    </View>
                  )
                ) : null}
              </View>
            );
          })
        )}
      </Card>
      <PaymentList title="Payments so far" payments={state.payments.filter((p) => p.groupId === group.id)} name={(m) => (m === ME ? 'You' : name(m))} readOnly={closed} />
      <T size={13} color={theme.c.muted}>
        Payments count once the person who received the money confirms. Paying directly from a UPI app arrives after our UPI device test.
      </T>
    </Screen>
  );
}
