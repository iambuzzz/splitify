import { useState } from 'react';
import { View } from 'react-native';
import { uuidv7 } from '../data/ids';
import { ME, type Payment, answersPayment, inr } from '../data/model';
import { useStore } from '../data/StoreProvider';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Card, Label, T, styles } from './kit';

export type PaymentDraft = { from: string; to: string; amount: bigint; via: 'upi' | 'cash' };

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const how = (via: Payment['via']) => (via === 'upi' ? 'UPI' : 'cash');

/** Asked before a payment is recorded: one tap shouldn't move money between people. */
export function ConfirmPayment({ groupId, draft, name, onDone }: { groupId: string; draft: PaymentDraft; name: (m: string) => string; onDone: () => void }) {
  const { theme } = useTheme();
  const { dispatch } = useStore();
  const received = draft.to === ME;
  return (
    <Card style={{ borderColor: theme.c.primary, borderWidth: 1.5 }}>
      <T size={15} weight="bold">
        {received ? `Did ${name(draft.from)} pay you ${inr(draft.amount)}?` : `You paid ${name(draft.to)} ${inr(draft.amount)} by ${how(draft.via)}?`}
      </T>
      <T size={14} color={theme.c.muted}>
        {received
          ? `It counts straight away and ${name(draft.from)} sees it. If it was a mistake, you can undo it from the payments list.`
          : `${name(draft.to)} is asked to confirm. It counts once they say yes, and you can cancel it until then.`}
      </T>
      <View style={[styles.row, { gap: 10, flexWrap: 'wrap' }]}>
        <Button
          title={received ? `Yes, I got ${inr(draft.amount)}` : 'Yes, I paid'}
          size="md"
          flex={1}
          onPress={() => {
            // Our own id, so an Undo tapped straight away finds the same payment on the server.
            dispatch({ type: 'record_payment', groupId, paymentId: uuidv7(), ...draft });
            onDone();
          }}
        />
        <Button title="Cancel" size="md" variant="secondary" flex={1} onPress={onDone} />
      </View>
    </Card>
  );
}

/**
 * Payments that counted (and ones undone), newest first. Whoever answers for the receiver can undo a
 * counted one; the other person sees it was undone.
 */
export function PaymentList({ title, payments, name, readOnly }: { title: string; payments: Payment[]; name: (m: string) => string; readOnly?: boolean }) {
  const { theme } = useTheme();
  const { state, dispatch } = useStore();
  const [undo, setUndo] = useState<string | null>(null);
  const shown = payments.filter((p) => p.status === 'confirmed' || p.status === 'voided').sort((x, y) => (y.at ?? '').localeCompare(x.at ?? ''));
  if (!shown.length) return null;
  const sentence = (p: Payment) => {
    const to = p.to === ME ? 'you' : name(p.to);
    return `${p.from === ME ? 'You' : name(p.from)} paid ${to} ${inr(p.amount)}`;
  };
  return (
    <Card>
      <Label>{title}</Label>
      {shown.map((p) => {
        const voided = p.status === 'voided';
        const mine = !readOnly && !voided && answersPayment(state, p);
        return (
          <View key={p.id} style={{ gap: 8, paddingVertical: 4 }}>
            <View style={[styles.between, { gap: 10 }]}>
              <View style={{ flex: 1 }}>
                <T size={15} color={voided ? theme.c.muted : theme.c.text} style={voided ? { textDecorationLine: 'line-through' } : undefined}>
                  {sentence(p)}
                </T>
                <T size={13} color={theme.c.muted}>
                  {[how(p.via), p.at ? fmtDay(p.at) : null, voided ? 'undone, doesn’t count' : null].filter(Boolean).join(' · ')}
                </T>
              </View>
              {mine && undo !== p.id ? <Button title="Undo" size="sm" variant="secondary" onPress={() => setUndo(p.id)} /> : null}
            </View>
            {undo === p.id ? (
              <View style={{ gap: 8 }}>
                <T size={14} color={theme.c.muted}>
                  {`Undo this payment? ${name(p.from)} will owe ${p.to === ME ? 'you' : name(p.to)} ${inr(p.amount)} again, and everyone sees it was undone.`}
                </T>
                <View style={[styles.row, { gap: 10 }]}>
                  <Button
                    title="Yes, undo"
                    size="md"
                    variant="danger"
                    flex={1}
                    onPress={() => {
                      dispatch({ type: 'void_payment', id: p.id });
                      setUndo(null);
                    }}
                  />
                  <Button title="Keep it" size="md" variant="secondary" flex={1} onPress={() => setUndo(null)} />
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}
