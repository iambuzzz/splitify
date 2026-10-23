import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { uuidv7 } from '../../../../src/data/ids';
import { ME, groupExpenses, inr, myEffect, pairThread, seenMark, sharesFor, current, transfersOf } from '../../../../src/data/model';
import { useStore } from '../../../../src/data/StoreProvider';
import { useTheme } from '../../../../src/theme/ThemeProvider';
import { Header } from '../../../../src/ui/Header';
import { Missing } from '../../../../src/ui/Missing';
import { Avatar, BigAmount, Button, Card, Label, Note, Screen, T, isHovered, styles } from '../../../../src/ui/kit';
import { Thread } from '../../../../src/ui/Thread';

/** You and one other member: what's between you, payments, and a private thread about settling up. */
export default function WithMember() {
  const { id, mid } = useLocalSearchParams<{ id: string; mid: string }>();
  const { theme } = useTheme();
  const { state, dispatch, markSeen } = useStore();
  const group = state.groups.find((g) => g.id === id);
  const other = mid && mid !== ME ? state.members[mid] : undefined;
  const thread = group && other ? pairThread(state, group.id, other.id) : [];
  const lastTheirs = thread.filter((m) => m.by !== ME).at(-1);
  const awaitingToMe = state.payments.filter((p) => p.groupId === id && p.status === 'awaiting' && p.from === mid && p.to === ME);

  // Opening the page marks their messages, and payments waiting for me, as seen.
  useEffect(() => {
    if (!group || !other) return;
    markSeen(group.id, [
      ...(lastTheirs ? [{ type: 'pair' as const, id: other.id, upTo: lastTheirs.id }] : []),
      ...awaitingToMe.map((p) => ({ type: 'settlement' as const, id: p.id })),
    ]);
  }, [group?.id, other?.id, lastTheirs?.id, awaitingToMe.map((p) => p.id).join(), markSeen]);

  if (!group) return <Missing />;
  if (!other) return <Missing what="person" back={`/group/${group.id}`} />;

  const them = other.name;
  // The suggested payment between the two of us, from the group's simplified plan.
  const plan = transfersOf(state, group.id).find((t) => (t.from === ME && t.to === other.id) || (t.from === other.id && t.to === ME));
  const iPay = plan?.from === ME;
  const myPending = state.payments.filter((p) => p.groupId === group.id && p.status === 'awaiting' && p.from === ME && p.to === other.id);
  const history = state.payments.filter(
    (p) => p.groupId === group.id && p.status === 'confirmed' && ((p.from === ME && p.to === other.id) || (p.from === other.id && p.to === ME)),
  );
  const shared = groupExpenses(state, group.id).filter((e) => {
    const v = current(e);
    const people = new Set([e.payer, ...(sharesFor(v.total, v.split, e.id) ?? []).map((s) => s.memberId)]);
    return people.has(ME) && people.has(other.id);
  });
  const myLast = thread.filter((m) => m.by === ME).at(-1);
  const theirSeen = seenMark(state, group.id, other.id, 'pair', ME);
  const seen = myLast && theirSeen && theirSeen.at >= myLast.at && (!lastTheirs || lastTheirs.at < myLast.at) ? `Seen by ${them}` : null;

  return (
    <Screen maxWidth={620}>
      <Header title={`You & ${them}`} back={`/group/${group.id}`} />
      <View style={[styles.row, { gap: 12 }]}>
        <Avatar name={them} size={48} />
        <View style={{ flex: 1 }}>
          <T size={22} weight="heavy">
            {them}
          </T>
          <T size={13} color={theme.c.muted}>
            in {group.name}
          </T>
        </View>
      </View>

      <Card>
        <Label>Between you two</Label>
        {plan ? (
          <>
            <T size={15} color={theme.c.muted}>
              {iPay ? `You pay ${them}` : `${them} pays you`}
            </T>
            <BigAmount size={34} color={iPay ? theme.c.owe : theme.c.get}>
              {inr(plan.amount)}
            </BigAmount>
            {/* A payment already waiting for confirmation covers this; a second record would count twice. */}
            {(iPay ? myPending : awaitingToMe).length ? (
              <T size={14} color={theme.c.muted}>
                {iPay ? `Waiting for ${them} to confirm your payment.` : `${them} says this is paid. Confirm it below.`}
              </T>
            ) : (
            <View style={[styles.row, { gap: 10, flexWrap: 'wrap' }]}>
              {iPay ? (
                <>
                  <Button title="I've paid (UPI)" size="md" onPress={() => dispatch({ type: 'record_payment', groupId: group.id, from: ME, to: other.id, amount: plan.amount, via: 'upi' })} />
                  <Button title="Paid in cash" size="md" variant="secondary" onPress={() => dispatch({ type: 'record_payment', groupId: group.id, from: ME, to: other.id, amount: plan.amount, via: 'cash' })} />
                </>
              ) : (
                <Button title={`Got it from ${them}`} size="md" variant="secondary" onPress={() => dispatch({ type: 'record_payment', groupId: group.id, from: other.id, to: ME, amount: plan.amount, via: 'cash' })} />
              )}
            </View>
            )}
          </>
        ) : (
          <T size={15} color={theme.c.muted}>
            Nothing to settle between you two right now.
          </T>
        )}
      </Card>

      {awaitingToMe.map((p) => (
        <Note key={p.id}>
          <T size={15} weight="bold" color={theme.c.attnText}>
            {them} says they paid you {inr(p.amount)} by {p.via === 'upi' ? 'UPI' : 'cash'}
          </T>
          <View style={[styles.row, { gap: 10 }]}>
            <Button title="Yes, got it" size="md" flex={1} onPress={() => dispatch({ type: 'confirm_payment', id: p.id })} />
            <Button title="Not yet" size="md" variant="secondary" flex={1} onPress={() => dispatch({ type: 'decline_payment', id: p.id })} />
          </View>
        </Note>
      ))}
      {myPending.map((p) => (
        <T key={p.id} size={14} color={theme.c.muted}>
          You said you paid {inr(p.amount)}. Waiting for {them} to confirm
          {seenMark(state, group.id, other.id, 'settlement', p.id) ? ` · Seen by ${them}` : ''}.
        </T>
      ))}

      <Card>
        <Label>{`Private chat with ${them}`}</Label>
        <Thread
          messages={thread}
          nameOf={(m) => (m === ME ? 'You' : them)}
          seen={seen}
          placeholder={`Message ${them} about settling up…`}
          empty={`Only you and ${them} see this. Use it to sort out payments between you.`}
          onSend={(text) => dispatch({ type: 'pair_message', groupId: group.id, with: other.id, messageId: uuidv7(), text })}
        />
      </Card>

      {shared.length ? (
        <Card>
          <Label>Expenses you share</Label>
          {shared.slice(0, 12).map((e) => {
            const effect = myEffect(e);
            return (
              <Pressable
                key={e.id}
                accessibilityRole="button"
                onPress={() => router.push(`/group/${group.id}/expense/${e.id}`)}
                style={(st) => [styles.between, { paddingVertical: 6, opacity: isHovered(st) ? 0.8 : 1 }]}
              >
                <T size={15} style={{ flex: 1 }} numberOfLines={1}>
                  {e.title}
                </T>
                <T size={14} weight="semibold" color={effect > 0n ? theme.c.get : effect < 0n ? theme.c.owe : theme.c.muted}>
                  {effect === 0n ? 'even' : `${effect > 0n ? 'you lent' : 'you owe'} ${inr(effect < 0n ? -effect : effect)}`}
                </T>
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      {history.length ? (
        <T size={13} color={theme.c.muted}>
          Paid between you: {history.map((p) => `${p.from === ME ? 'you → ' + them : them + ' → you'} ${inr(p.amount)}`).join(' · ')}
        </T>
      ) : null}
    </Screen>
  );
}
