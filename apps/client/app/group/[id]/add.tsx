import { Feather } from '@expo/vector-icons';
import { parseAmount } from '@app/money';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { ME, type Action, type ExpenseIcon, type SplitSpec, current, inr, memberName, parsePercent, parseShares, percentText, sharesFor, splitWords } from '../../../src/data/model';
import { uuidv7 } from '../../../src/data/ids';
import { useStore } from '../../../src/data/StoreProvider';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { Header } from '../../../src/ui/Header';
import { Missing } from '../../../src/ui/Missing';
import { type PickedReceipt, ReceiptPicker } from '../../../src/ui/Receipts';
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

type Method = SplitSpec['method'];
const METHODS: { m: Method; label: string }[] = [
  { m: 'equal', label: 'Equally' },
  { m: 'shares', label: 'By shares' },
  { m: 'percent', label: 'By %' },
  { m: 'exact', label: 'Manually' },
];

/** ₹ minor units as typed text: 120050n → "1200.50", 90000n → "900". */
const plainRupees = (minor: bigint) => `${minor / 100n}${minor % 100n ? `.${String(minor % 100n).padStart(2, '0')}` : ''}`;
const bpText = (bp: number) => percentText(bp).slice(0, -1);
/** What typed amounts add up to; null if one isn't an amount. */
function rupeesSum(typed: Record<string, string>): bigint | null {
  let sum = 0n;
  for (const t of Object.values(typed)) {
    const clean = t.replace(/[,₹\s]/g, '');
    try {
      if (clean) sum += parseAmount(clean, 'INR');
    } catch {
      return null;
    }
  }
  return sum;
}

/** 100% spread as evenly as basis points allow: 3 people → 33.34, 33.33, 33.33. */
function evenPercents(who: string[]): Record<string, string> {
  const base = Math.floor(10000 / who.length);
  return Object.fromEntries(who.map((m, i) => [m, bpText(base + (i < 10000 - base * who.length ? 1 : 0))]));
}

function ExpenseForm() {
  const { id, eid, mode: modeParam } = useLocalSearchParams<{ id: string; eid?: string; mode?: string }>();
  const { theme } = useTheme();
  const { state, dispatch, run, refresh, features, addReceipt } = useStore();
  const wide = useWide();
  const group = state.groups.find((g) => g.id === id);
  const existing = eid ? state.expenses.find((e) => e.id === eid) : undefined;
  const mode: 'add' | 'edit' | 'suggest' = existing ? (modeParam === 'suggest' ? 'suggest' : 'edit') : 'add';
  const v = existing ? current(existing) : undefined;
  const members = group?.members ?? [];
  const receipt = theme.family === 'receipt';
  const old = v?.split;

  const [amount, setAmount] = useState(v ? plainRupees(v.total) : '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [payer, setPayer] = useState(existing?.payer ?? ME);
  const [method, setMethod] = useState<Method>(old?.method ?? 'equal');
  // Each way of splitting keeps its own inputs, so switching back and forth doesn't lose what was typed.
  const [included, setIncluded] = useState<string[]>(
    !old ? members : old.method === 'equal' ? old.members : members.filter((m) => (sharesFor(v!.total, old, existing!.id) ?? []).some((x) => x.memberId === m && x.amount > 0n)),
  );
  const [shares, setShares] = useState<Record<string, number>>(old?.method === 'shares' ? old.shares : {});
  const [percents, setPercents] = useState<Record<string, string>>(
    old?.method === 'percent' ? Object.fromEntries(Object.entries(old.basisPoints).filter(([, n]) => n > 0).map(([m, n]) => [m, bpText(n)])) : {},
  );
  const [amounts, setAmounts] = useState<Record<string, string>>(
    old?.method === 'exact' ? Object.fromEntries(Object.entries(old.amounts).filter(([, a]) => a > 0n).map(([m, a]) => [m, plainRupees(a)])) : {},
  );
  const [reason, setReason] = useState('');
  const [photos, setPhotos] = useState<PickedReceipt[]>([]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!group) return null;
  const name = (m: string) => (m === ME ? 'You' : state.members[m]?.name ?? m);

  let total: bigint | null = null;
  let amountError = '';
  try {
    total = amount.trim() ? parseAmount(amount.replace(/[,₹\s]/g, ''), 'INR') : null;
  } catch {
    amountError = 'Enter an amount like 1200 or 1200.50';
  }

  // The split as the API will get it, plus what's still off when it doesn't add up yet.
  let spec: SplitSpec | null = null;
  let splitHint = '';
  if (method === 'equal') {
    spec = { method: 'equal', members: included };
    if (!included.length) splitHint = 'Pick at least one person.';
  } else if (method === 'shares') {
    spec = { method: 'shares', shares: Object.fromEntries(members.map((m) => [m, shares[m] ?? 0])) };
    if (!members.some((m) => (shares[m] ?? 0) > 0)) splitHint = 'Give at least one person a share.';
  } else if (method === 'percent') {
    const bp = members.map((m) => [m, parsePercent(percents[m] ?? '')] as const);
    const sum = bp.reduce((a, [, n]) => a + (n ?? 0), 0);
    if (bp.some(([, n]) => n === null)) splitHint = 'Type percentages like 25 or 12.5.';
    else if (sum !== 10000) splitHint = sum < 10000 ? `${percentText(10000 - sum)} left to give` : `${percentText(sum - 10000)} too much`;
    else spec = { method: 'percent', basisPoints: Object.fromEntries(bp.map(([m, n]) => [m, n!])) };
  } else {
    const parsed = members.map((m) => {
      const t = (amounts[m] ?? '').replace(/[,₹\s]/g, '');
      try {
        return [m, t ? parseAmount(t, 'INR') : 0n] as const;
      } catch {
        return [m, null] as const;
      }
    });
    const sum = parsed.reduce((a, [, n]) => a + (n ?? 0n), 0n);
    if (parsed.some(([, n]) => n === null)) splitHint = 'Type amounts like 300 or 250.50.';
    else if (!total) splitHint = '';
    else if (sum !== total) splitHint = sum < total ? `${inr(total - sum)} left to give` : `${inr(sum - total)} more than the total`;
    else spec = { method: 'exact', amounts: Object.fromEntries(parsed.map(([m, n]) => [m, n!])) };
  }
  const preview = total && total > 0n && spec ? sharesFor(total, spec, existing?.id ?? 'new') : null;
  const shareOf = (m: string) => preview?.find((s) => s.memberId === m)?.amount ?? 0n;
  const valid =
    !saving && total !== null && total > 0n && preview !== null && (mode !== 'add' || title.trim() !== '') && (mode !== 'suggest' || reason.trim() !== '');

  /** Who is in the split right now, to start another way of splitting from. */
  const inNow = () => {
    const from = preview?.filter((x) => x.amount > 0n).map((x) => x.memberId);
    return from?.length ? members.filter((m) => from.includes(m)) : included.length ? included : members;
  };
  const pick = (m: Method) => {
    if (m === method) return;
    const who = inNow();
    // A way of splitting that hasn't been filled in yet starts from the same people, equally.
    if (m === 'equal' && !included.length) setIncluded(who);
    if (m === 'shares' && !Object.values(shares).some((n) => n > 0)) setShares(Object.fromEntries(who.map((x) => [x, 1])));
    if (m === 'percent' && !Object.values(percents).some((t) => parsePercent(t))) setPercents(evenPercents(who));
    // Amounts typed earlier stay if they still add up; otherwise they start from the split as it
    // stands (₹500 / ₹300 / ₹200 from 50 / 30 / 20%), ready to adjust.
    if (m === 'exact' && rupeesSum(amounts) !== total) {
      const now = preview ?? (total && total > 0n ? sharesFor(total, { method: 'equal', members: who }, 'new') : null);
      setAmounts(now ? Object.fromEntries(now.filter((x) => x.amount > 0n).map((x) => [x.memberId, plainRupees(x.amount)])) : {});
    }
    setMethod(m);
  };
  const resetEqual = () => {
    const who = inNow();
    if (method === 'shares') setShares(Object.fromEntries(who.map((x) => [x, 1])));
    if (method === 'percent') setPercents(evenPercents(who));
    if (method === 'exact' && total && total > 0n) {
      const eq = sharesFor(total, { method: 'equal', members: who }, 'new');
      if (eq) setAmounts(Object.fromEntries(eq.map((x) => [x.memberId, plainRupees(x.amount)])));
    }
  };

  const save = async () => {
    if (!valid || total === null || !spec) return;
    const expenseId = existing?.id ?? uuidv7();
    let action: Action;
    if (mode === 'add') action = { type: 'add_expense', id: expenseId, groupId: group.id, title: title.trim(), icon: guessIcon(title), total, payer, split: spec };
    else if (mode === 'edit') action = { type: 'edit_expense', id: expenseId, title: title.trim() || existing!.title, total, payer, split: spec };
    else action = { type: 'suggest', id: expenseId, total, split: spec, reason: reason.trim() };
    if (!photos.length) {
      dispatch(action);
      router.canGoBack() ? router.back() : router.replace(`/group/${group.id}`);
      return;
    }
    // With photos the expense has to exist on the server first, so this waits instead of showing it at once.
    setSaving(true);
    setProblem(null);
    try {
      await run(action);
      await refresh([group.id]);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not save. Try again.');
      setSaving(false);
      return;
    }
    let failed = 0;
    let dup = '';
    for (const p of photos) {
      try {
        const res = await addReceipt(expenseId, p.file);
        if (res.duplicateOf && !res.duplicateOf.sameExpense) dup = res.duplicateOf.expenseId;
      } catch {
        failed++;
      }
    }
    // Lands on the expense, so the attached bill (or what went wrong with it) is right there.
    const q = [failed ? `upload=${failed}` : '', dup ? `dup=${dup}` : ''].filter(Boolean).join('&');
    router.replace(`/group/${group.id}/expense/${expenseId}${q ? `?${q}` : ''}`);
  };

  const useKeypad = receipt && !wide;
  const press = (k: string) => {
    if (k === 'del') return setAmount(amount.slice(0, -1));
    if (k === '.' && amount.includes('.')) return;
    if (k === '.' && amount === '') return setAmount('0.');
    if (amount.includes('.') && amount.split('.')[1]!.length >= 2) return;
    setAmount(amount + k);
  };

  return (
    <Screen maxWidth={560} footer={<Button title={saving ? (photos.length ? 'Saving and adding the bill…' : 'Saving…') : mode === 'suggest' ? 'Send suggestion' : receipt ? 'Save bill' : 'Save'} disabled={!valid} onPress={save} />}>
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
            {`Now ${inr(v.total)} · split ${splitWords(v.split)}`}
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
          {METHODS.map(({ m, label }) => (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityLabel={m === 'percent' ? 'By percentage' : m === 'exact' ? 'Manually, in amounts' : label}
              aria-checked={method === m}
              onPress={() => pick(m)}
              style={{ flex: 1, height: 40, paddingHorizontal: 2, borderRadius: receipt ? 999 : 11, alignItems: 'center', justifyContent: 'center', backgroundColor: method === m ? theme.c.surface : 'transparent' }}
            >
              <T size={wide ? 14 : 13} weight={method === m ? 'bold' : 'semibold'} color={method === m ? theme.c.text : theme.c.muted} numberOfLines={1}>
                {label}
              </T>
            </Pressable>
          ))}
        </View>

        {method === 'equal' ? (
          <>
            <View style={[styles.row, { flexWrap: 'wrap', gap: 14, justifyContent: 'space-around' }]}>
              {members.map((m) => {
                const on = included.includes(m);
                return (
                  <Pressable
                    key={m}
                    accessibilityRole="checkbox"
                    aria-checked={on}
                    accessibilityLabel={name(m)}
                    onPress={() => setIncluded(on ? included.filter((x) => x !== m) : [...included, m])}
                    style={{ alignItems: 'center', gap: 4, opacity: on ? 1 : 0.4 }}
                  >
                    <Avatar name={memberName(state, m)} size={50} ring={on} />
                    <T size={13} weight="bold">
                      {name(m)}
                    </T>
                    <T size={12} color={theme.c.muted} mono={receipt}>
                      {on ? inr(shareOf(m)) : 'out'}
                    </T>
                  </Pressable>
                );
              })}
            </View>
            <T size={13} color={theme.c.muted} style={{ textAlign: 'center' }}>
              Tap a face to leave someone out.
            </T>
          </>
        ) : (
          <>
            <Card style={{ gap: 0 }} padded={false}>
              {members.map((m, i) => {
                const n = shares[m] ?? 0;
                const out = method === 'shares' ? n === 0 : method === 'percent' ? !parsePercent(percents[m] ?? '') : !(amounts[m] ?? '').trim() || /^0*(\.0*)?$/.test((amounts[m] ?? '').trim());
                return (
                  <View key={m} style={[styles.row, { padding: 12, gap: 10, borderTopWidth: i ? 1 : 0, borderColor: theme.c.border }]}>
                    <View style={{ opacity: out ? 0.45 : 1 }}>
                      <Avatar name={memberName(state, m)} size={36} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <T size={15} weight="bold" mono={receipt} numberOfLines={1}>
                        {name(m)}
                      </T>
                      {method !== 'exact' ? (
                        <T size={13} color={theme.c.muted} mono={receipt}>
                          {out ? 'out' : inr(shareOf(m))}
                        </T>
                      ) : null}
                    </View>
                    {method === 'shares' ? (
                      <Stepper value={n} onMinus={() => setShares({ ...shares, [m]: Math.max(0, Math.ceil(n) - 1) })} onPlus={() => setShares({ ...shares, [m]: Math.floor(n) + 1 })} label={name(m)} />
                    ) : (
                      <NumberBox
                        label={`${m === ME ? 'Your' : `${name(m)}'s`} ${method === 'percent' ? 'percentage' : 'amount in rupees'}`}
                        value={(method === 'percent' ? percents : amounts)[m] ?? ''}
                        onChange={(t) => (method === 'percent' ? setPercents({ ...percents, [m]: t }) : setAmounts({ ...amounts, [m]: t }))}
                        prefix={method === 'exact' ? '₹' : undefined}
                        suffix={method === 'percent' ? '%' : undefined}
                      />
                    )}
                  </View>
                );
              })}
            </Card>
            <View style={[styles.row, { justifyContent: 'center', gap: 14, flexWrap: 'wrap' }]}>
              <T size={13} color={theme.c.muted} style={{ textAlign: 'center' }}>
                {method === 'shares' ? 'Someone with 2 shares pays double. 0 leaves them out.' : 'Leave it empty to leave someone out.'}
              </T>
              <Pressable accessibilityRole="button" onPress={resetEqual} hitSlop={8}>
                <T size={13} weight="bold" color={theme.c.get}>
                  Reset to equal
                </T>
              </Pressable>
            </View>
          </>
        )}

        {total && preview ? (
          <View style={[styles.row, { gap: 6, justifyContent: 'center' }]}>
            <Feather name="check" size={14} color={theme.c.get} />
            <T size={13} weight="semibold" color={theme.c.get} mono={receipt}>
              {method === 'shares' ? `${Object.values(shares).reduce((a, b) => a + b, 0)} shares · ` : method === 'percent' ? '100% · ' : ''}adds up to {inr(total)}
            </T>
          </View>
        ) : total && splitHint ? (
          <T size={13} weight="semibold" color={theme.c.owe} style={{ textAlign: 'center' }} mono={receipt}>
            {splitHint}
          </T>
        ) : null}
      </View>

      {mode !== 'suggest' && features.receipts && Platform.OS === 'web' ? <ReceiptPicker files={photos} onChange={setPhotos} max={20 - (existing?.receipts.length ?? 0)} /> : null}

      {problem ? (
        <T size={13} weight="semibold" color={theme.c.owe} style={{ textAlign: 'center' }}>
          {problem}
        </T>
      ) : null}

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
      <Pressable accessibilityRole="button" accessibilityLabel={`One share less for ${label}`} onPress={onMinus} style={btn}>
        <Feather name="minus" size={18} color={theme.c.text} />
      </Pressable>
      <T size={18} weight="heavy" style={{ minWidth: 26, textAlign: 'center' }}>
        {String(value)}
      </T>
      <Pressable accessibilityRole="button" accessibilityLabel={`One share more for ${label}`} onPress={onPlus} style={btn}>
        <Feather name="plus" size={18} color={theme.c.text} />
      </Pressable>
    </View>
  );
}

/** A small number field for one person's percentage or amount, with ₹ or % beside it. */
function NumberBox({ value, onChange, label, prefix, suffix }: { value: string; onChange: (t: string) => void; label: string; prefix?: string; suffix?: string }) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.row,
        { width: 118, height: 42, gap: 2, paddingHorizontal: 10, borderRadius: 12, borderWidth: focused ? 2 : 1, borderColor: focused ? theme.c.primary : theme.c.borderStrong, backgroundColor: theme.c.surface },
      ]}
    >
      {prefix ? <T size={15} color={theme.c.muted}>{prefix}</T> : null}
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^\d.,]/g, ''))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="0"
        placeholderTextColor={theme.c.muted}
        keyboardType="decimal-pad"
        selectTextOnFocus
        style={[{ flex: 1, minWidth: 0, fontSize: 16, fontFamily: theme.f.bold, color: theme.c.text, textAlign: 'right', padding: 0 }, noOutline]}
      />
      {suffix ? <T size={15} color={theme.c.muted}>{suffix}</T> : null}
    </View>
  );
}
