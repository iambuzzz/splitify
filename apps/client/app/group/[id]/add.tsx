import { Feather } from '@expo/vector-icons';
import { parseAmount } from '@app/money';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { ME, type ExpenseIcon, type SplitSpec, current, inr, memberName, sharesFor } from '../../../src/data/model';
import { uuidv7 } from '../../../src/data/ids';
import { useStore } from '../../../src/data/StoreProvider';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { Header } from '../../../src/ui/Header';
import { Missing } from '../../../src/ui/Missing';
import { Avatar, Button, Card, Chip, Divider, Field, Label, Screen, T, fitSize, noOutline, styles, useWide } from '../../../src/ui/kit';

function guessIcon(title: string): ExpenseIcon {
  const t = title.toLowerCase();
  if (/hotel|stay|room|airbnb|hostel/.test(t)) return 'hotel';
  if (/dinner|lunch|breakfast|food|cafe|pizza|swiggy|zomato|drinks|chai|tea|coffee|snack|maggi|biryani/.test(t)) return 'food';
  if (/taxi|cab|uber|ola|auto|fuel|petrol|train|bus|flight/.test(t)) return 'taxi';
  if (/rent|maid|electric/.test(t)) return 'home';
  if (/wi-?fi|internet|broadband/.test(t)) return 'wifi';
  if (/grocer|blinkit|zepto|bigbasket|market/.test(t)) return 'cart';
  return 'other';
}

/** Add, edit (owner) or suggest a change (others) to an expense. */
/** The form starts from the group's members, so it waits until the group (and the expense) are loaded. */
export default function AddExpense() {
  const { id, eid } = useLocalSearchParams<{ id: string; eid?: string }>();
  const { state } = useStore();
  const group = state.groups.find((g) => g.id === id);
  if (!group) return <Missing />;
  if (eid && !state.expenses.some((e) => e.id === eid)) return <Missing what="expense" back={`/group/${group.id}`} />;
  return <ExpenseForm key={`${id}|${eid ?? ''}`} />;
}

function ExpenseForm() {
  const { id, eid, mode: modeParam } = useLocalSearchParams<{ id: string; eid?: string; mode?: string }>();
  const { theme } = useTheme();
  const { state, dispatch } = useStore();
  const wide = useWide();
  const group = state.groups.find((g) => g.id === id);
  const existing = eid ? state.expenses.find((e) => e.id === eid) : undefined;
  const mode: 'add' | 'edit' | 'suggest' = existing ? (modeParam === 'suggest' ? 'suggest' : 'edit') : 'add';
  const v = existing ? current(existing) : undefined;
  const members = group?.members ?? [];
  const receipt = theme.family === 'receipt';

  const [amount, setAmount] = useState(v ? String(Number(v.total) / 100) : '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [payer, setPayer] = useState(existing?.payer ?? ME);
  const [method, setMethod] = useState<'equal' | 'shares'>(v?.split.method ?? 'equal');
  const [included, setIncluded] = useState<string[]>(v?.split.method === 'equal' ? v.split.members : members);
  const [reason, setReason] = useState('');
  // Nights are a grid (member × night) so "who stayed which night" can be ticked directly.
  const [grid, setGrid] = useState<Record<string, boolean[]>>(() => {
    const counts = v?.split.method === 'shares' ? v.split.shares : Object.fromEntries(members.map((m) => [m, 1]));
    const n = Math.max(1, ...Object.values(counts));
    return Object.fromEntries(members.map((m) => {
      const c = counts[m] ?? 0;
      return [m, Array.from({ length: n }, (_, i) => i >= n - c)];
    }));
  });
  const nights = Math.max(1, ...Object.values(grid).map((r) => r.length));
  const counts = Object.fromEntries(members.map((m) => [m, (grid[m] ?? []).filter(Boolean).length]));

  if (!group) return null;
  const name = (m: string) => (m === ME ? 'You' : state.members[m]?.name ?? m);

  let total: bigint | null = null;
  let amountError = '';
  try {
    total = amount.trim() ? parseAmount(amount.replace(/[,₹\s]/g, ''), 'INR') : null;
  } catch {
    amountError = 'Enter an amount like 1200 or 1200.50';
  }
  const spec: SplitSpec = method === 'equal' ? { method: 'equal', members: included } : { method: 'shares', shares: counts };
  const preview = total && total > 0n ? sharesFor(total, spec, existing?.id ?? 'new') : null;
  const totalNights = Object.values(counts).reduce((a, b) => a + b, 0);
  const valid =
    total !== null && total > 0n && preview !== null && (mode !== 'add' || title.trim() !== '') && (mode !== 'suggest' || reason.trim() !== '');

  const save = () => {
    if (!valid || total === null) return;
    if (mode === 'add') dispatch({ type: 'add_expense', id: uuidv7(), groupId: group.id, title: title.trim(), icon: guessIcon(title), total, payer, split: spec });
    if (mode === 'edit' && existing) dispatch({ type: 'edit_expense', id: existing.id, title: title.trim() || existing.title, total, payer, split: spec });
    if (mode === 'suggest' && existing) dispatch({ type: 'suggest', id: existing.id, total, split: spec, reason: reason.trim() });
    router.canGoBack() ? router.back() : router.replace(`/group/${group.id}`);
  };

  const setCount = (m: string, delta: number) => {
    const row = [...(grid[m] ?? Array(nights).fill(false))];
    if (delta > 0) {
      const i = row.indexOf(false);
      if (i >= 0) row[i] = true;
      else {
        // Everyone else gets an unticked extra night so the grid stays rectangular.
        const next = Object.fromEntries(members.map((x) => [x, [...(grid[x] ?? []), x === m]]));
        setGrid(next);
        return;
      }
    } else {
      const i = row.lastIndexOf(true);
      if (i >= 0) row[i] = false;
    }
    setGrid({ ...grid, [m]: row });
  };
  const toggleCell = (m: string, i: number) => {
    const row = [...(grid[m] ?? [])];
    row[i] = !row[i];
    setGrid({ ...grid, [m]: row });
  };
  const addNight = () => setGrid(Object.fromEntries(members.map((m) => [m, [...(grid[m] ?? []), true]])));

  const useKeypad = receipt && !wide;
  const press = (k: string) => {
    if (k === 'del') return setAmount(amount.slice(0, -1));
    if (k === '.' && amount.includes('.')) return;
    if (k === '.' && amount === '') return setAmount('0.');
    if (amount.includes('.') && amount.split('.')[1]!.length >= 2) return;
    setAmount(amount + k);
  };

  return (
    <Screen maxWidth={560} footer={<Button title={mode === 'suggest' ? 'Send suggestion' : receipt ? 'Save bill' : 'Save'} disabled={!valid} onPress={save} />}>
      <Header
        back={`/group/${group.id}`}
        title={mode === 'add' ? (receipt ? `NEW BILL · ${group.name.toUpperCase()}` : 'Add expense') : mode === 'edit' ? `Edit ${existing?.title}` : `Suggest a change`}
      />

      <View style={{ alignItems: 'center', gap: 6 }}>
        {!receipt ? <Label>How much?</Label> : null}
        {useKeypad ? (
          <T size={fitSize(amount, 60, 7)} weight="heavy" numberOfLines={1} style={{ letterSpacing: -3 }} color={amount ? theme.c.text : theme.c.muted}>
            ₹{amount ? Number(amount.split('.')[0]).toLocaleString('en-IN') + (amount.includes('.') ? `.${amount.split('.')[1]}` : '') : '0'}
          </T>
        ) : (
          <View style={[styles.row, { gap: 4 }]}>
            <T size={34} weight="bold" color={theme.c.muted}>
              ₹
            </T>
            <TextInput
              accessibilityLabel="Amount in rupees"
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={theme.c.muted}
              keyboardType="decimal-pad"
              autoFocus={mode === 'add'}
              onSubmitEditing={save}
              style={[{ width: Math.min(300, Math.max(1, amount.length) * fitSize(amount, 54, 6) * 0.62 + 12), fontSize: fitSize(amount, 54, 6), fontFamily: theme.f.heavy, color: theme.c.text, letterSpacing: -2, padding: 0 }, noOutline]}
            />
          </View>
        )}
        {mode !== 'add' && v ? (
          <T size={13} color={theme.c.muted} mono={receipt}>
            {`Now ${inr(v.total)} · ${v.split.method === 'equal' ? 'split equally' : 'by nights'}`}
          </T>
        ) : null}
        {amountError ? (
          <T size={13} color={theme.c.owe}>
            {amountError}
          </T>
        ) : null}
      </View>

      {mode !== 'suggest' ? (
        <Field
          line={receipt}
          accessibilityLabel="What was it for?"
          placeholder="What was it for? e.g. Dinner"
          value={title}
          onChangeText={setTitle}
          onSubmitEditing={save}
          returnKeyType="done"
          style={{ textAlign: 'center', fontSize: 17, fontFamily: theme.f.semibold }}
        />
      ) : (
        <Field
          line={receipt}
          accessibilityLabel="Why should it change?"
          placeholder="Why? e.g. discount code laga tha"
          value={reason}
          onChangeText={setReason}
          onSubmitEditing={save}
          returnKeyType="send"
          style={{ textAlign: 'center', fontSize: 17, fontFamily: theme.f.semibold }}
        />
      )}

      {/* A suggestion changes the amount or split only; who paid stays with the owner. */}
      {mode !== 'suggest' ? (
        <View style={{ gap: 10 }}>
          <Label>Paid by</Label>
          <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
            {members.map((m) => (
              <Chip key={m} label={name(m)} on={payer === m} onPress={() => setPayer(m)} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <Label>Split</Label>
        <View
          accessibilityRole="radiogroup"
          style={{ flexDirection: 'row', backgroundColor: theme.c.chip, borderRadius: receipt ? 999 : 14, padding: 4, gap: 4 }}
        >
          {(['equal', 'shares'] as const).map((m) => (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityState={{ checked: method === m }}
              onPress={() => setMethod(m)}
              style={{ flex: 1, height: 40, borderRadius: receipt ? 999 : 11, alignItems: 'center', justifyContent: 'center', backgroundColor: method === m ? theme.c.surface : 'transparent' }}
            >
              <T size={14} weight={method === m ? 'bold' : 'semibold'} color={method === m ? theme.c.text : theme.c.muted}>
                {m === 'equal' ? 'Equally' : 'By nights'}
              </T>
            </Pressable>
          ))}
        </View>

        {method === 'equal' ? (
          <>
            <View style={[styles.row, { flexWrap: 'wrap', gap: 14, justifyContent: 'space-around' }]}>
              {members.map((m, i) => {
                const on = included.includes(m);
                return (
                  <Pressable
                    key={m}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={name(m)}
                    onPress={() => setIncluded(on ? included.filter((x) => x !== m) : [...included, m])}
                    style={{ alignItems: 'center', gap: 4, opacity: on ? 1 : 0.4 }}
                  >
                    <Avatar name={memberName(state, m)} size={50} ring={on} />
                    <T size={13} weight="bold">
                      {name(m)}
                    </T>
                    <T size={12} color={theme.c.muted} mono={receipt}>
                      {on ? inr(preview?.find((s) => s.memberId === m)?.amount ?? 0n) : 'out'}
                    </T>
                  </Pressable>
                );
              })}
            </View>
            <T size={13} color={theme.c.muted} style={{ textAlign: 'center' }}>
              Tap a face to leave someone out.
            </T>
          </>
        ) : receipt ? (
          <Card style={{ gap: 8 }}>
            <T size={22} weight="heavy" style={{ letterSpacing: -0.5 }}>
              Who stayed which night?
            </T>
            {members.map((m) => (
              <View key={m} style={[styles.row, { gap: 8 }]}>
                <T size={15} weight="bold" style={{ width: 70 }} numberOfLines={1}>
                  {name(m)}
                </T>
                {Array.from({ length: nights }, (_, i) => {
                  const on = !!grid[m]?.[i];
                  return (
                    <Pressable
                      key={i}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${name(m)}, night ${i + 1}`}
                      onPress={() => toggleCell(m, i)}
                      style={{
                        flex: 1,
                        height: 44,
                        borderRadius: 10,
                        backgroundColor: on ? theme.c.primary : 'transparent',
                        borderWidth: on ? 0 : 2,
                        borderStyle: 'dashed',
                        borderColor: theme.c.border,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {on ? <Feather name="check" size={18} color={theme.c.onPrimary} /> : null}
                    </Pressable>
                  );
                })}
                <T mono size={14} weight="bold" style={{ width: 64, textAlign: 'right' }}>
                  {inr(preview?.find((s) => s.memberId === m)?.amount ?? 0n, { symbol: false })}
                </T>
              </View>
            ))}
            <Pressable accessibilityRole="button" onPress={addNight}>
              <T size={14} weight="bold" color={theme.c.get}>
                + Add a night
              </T>
            </Pressable>
          </Card>
        ) : (
          <Card style={{ gap: 0 }} padded={false}>
            {members.map((m, i) => (
              <View key={m} style={[styles.row, { padding: 12, borderTopWidth: i ? 1 : 0, borderColor: theme.c.border }]}>
                <Avatar name={memberName(state, m)} size={36} />
                <View style={{ flex: 1 }}>
                  <T size={15} weight="bold">
                    {name(m)}
                  </T>
                  <T size={13} color={theme.c.muted}>
                    {inr(preview?.find((s) => s.memberId === m)?.amount ?? 0n)}
                  </T>
                </View>
                <Stepper value={counts[m] ?? 0} onMinus={() => setCount(m, -1)} onPlus={() => setCount(m, 1)} label={name(m)} />
              </View>
            ))}
          </Card>
        )}

        {total && preview ? (
          <View style={[styles.row, { gap: 6, justifyContent: 'center' }]}>
            <Feather name="check" size={14} color={theme.c.get} />
            <T size={13} weight="semibold" color={theme.c.get} mono={receipt}>
              {method === 'shares' && totalNights > 0 ? `${totalNights} nights · ` : ''}adds up to {inr(total)}
            </T>
          </View>
        ) : total && !preview ? (
          <T size={13} color={theme.c.owe} style={{ textAlign: 'center' }}>
            Pick at least one person.
          </T>
        ) : null}
      </View>

      {useKeypad ? (
        <View style={{ gap: 6 }}>
          <Divider />
          {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['.', '0', 'del']].map((row) => (
            <View key={row.join()} style={{ flexDirection: 'row', gap: 6 }}>
              {row.map((k) => (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityLabel={k === 'del' ? 'Delete digit' : k}
                  onPress={() => press(k)}
                  style={({ pressed }) => ({ flex: 1, height: 54, borderRadius: 14, backgroundColor: pressed ? theme.c.border : theme.c.surfaceAlt, alignItems: 'center', justifyContent: 'center' })}
                >
                  {k === 'del' ? <Feather name="delete" size={22} color={theme.c.text} /> : <T mono size={22}>{k}</T>}
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function Stepper({ value, onMinus, onPlus, label }: { value: number; onMinus: () => void; onPlus: () => void; label: string }) {
  const { theme } = useTheme();
  const btn = { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: theme.c.borderStrong, alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <View style={[styles.row, { gap: 6 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`One night less for ${label}`} onPress={onMinus} style={btn}>
        <Feather name="minus" size={18} color={theme.c.text} />
      </Pressable>
      <T size={18} weight="heavy" style={{ width: 26, textAlign: 'center' }}>
        {String(value)}
      </T>
      <Pressable accessibilityRole="button" accessibilityLabel={`One night more for ${label}`} onPress={onPlus} style={btn}>
        <Feather name="plus" size={18} color={theme.c.text} />
      </Pressable>
    </View>
  );
}
