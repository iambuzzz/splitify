import {
  type Posting,
  type SplitInput,
  breakdownExpense,
  computeBalances,
  computeShares,
  settlementPostings,
  simplifyDebts,
} from '@app/ledger';
import { formatAmount } from '@app/money';

/**
 * The app's state. In demo mode the reducer below changes it locally (money maths uses the real
 * ledger engine; permissions are simplified). Signed in, it is built from the API (remote.ts),
 * and the API decides every change.
 */

/** "Me" in every group: the signed-in user's member id is mapped to this id in the state. */
export const ME = 'me';

export interface Member {
  id: string;
  name: string;
}

export type ExpenseIcon = 'hotel' | 'food' | 'taxi' | 'home' | 'wifi' | 'cart' | 'other';

export type SplitSpec =
  | { method: 'equal'; members: string[] }
  /** Nights stayed or shares, per member; 0 = not included. */
  | { method: 'shares'; shares: Record<string, number> };

export interface Version {
  n: number;
  total: bigint;
  split: SplitSpec;
  by: string;
}

export interface Suggestion {
  id: string;
  by: string;
  total: bigint;
  split: SplitSpec;
  reason: string;
  baseVersion: number;
  status: 'open' | 'accepted' | 'declined' | 'outdated';
}

/** A message in an expense thread (visible to the people in that expense) or a pair thread. */
export interface ThreadMessage {
  id: string;
  by: string;
  kind: 'text' | 'question';
  text: string;
  /** ISO time. */
  at: string;
  /** Questions only. */
  resolved: boolean;
}

export interface PairMessage extends ThreadMessage {
  groupId: string;
  /** The two members, in a fixed order. */
  pair: [string, string];
}

export type Role = 'owner' | 'admin' | 'member';

export interface MemberInfo {
  id: string;
  role: Role;
  /** Signed up (false: a name a friend added, waiting to be claimed from an invite). */
  joined: boolean;
  active: boolean;
}

/** "Seen" on money items: an expense version, a payment, or a pair thread (id = the other member). */
export interface SeenMark {
  groupId: string;
  by: string;
  type: 'expense' | 'settlement' | 'pair';
  id: string;
  version?: number;
  at: string;
}

export interface Expense {
  id: string;
  groupId: string;
  title: string;
  icon: ExpenseIcon;
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  payer: string;
  versions: Version[];
  deleted: boolean;
  disputes: { by: string; reason: string }[];
  messages: ThreadMessage[];
  /** Can I read and write its thread (am I in this expense)? */
  canChat: boolean;
  suggestions: Suggestion[];
}

export interface Payment {
  id: string;
  groupId: string;
  from: string;
  to: string;
  amount: bigint;
  via: 'upi' | 'cash';
  status: 'awaiting' | 'confirmed' | 'declined';
}

export interface Group {
  id: string;
  name: string;
  kind: 'trip' | 'home' | 'food';
  members: string[];
}

export interface State {
  members: Record<string, Member>;
  groups: Group[];
  /** groupId → everyone who is or was in the group, with their role. */
  roster: Record<string, MemberInfo[]>;
  expenses: Expense[];
  payments: Payment[];
  pairMessages: PairMessage[];
  seen: SeenMark[];
  nextId: number;
}

// ---------- money helpers ----------

/** "₹3,900" or "₹1,636.36"; paise shown only when non-zero. */
export function inr(minor: bigint, opts: { sign?: boolean; symbol?: boolean } = {}): string {
  const negative = minor < 0n;
  const [whole = '0', fraction = '00'] = formatAmount(negative ? -minor : minor, 'INR').split('.');
  const grouped = BigInt(whole).toLocaleString('en-IN');
  const sign = negative ? '−' : opts.sign && minor > 0n ? '+' : '';
  return `${sign}${opts.symbol === false ? '' : '₹'}${grouped}${fraction === '00' ? '' : `.${fraction}`}`;
}

export const abs = (v: bigint) => (v < 0n ? -v : v);

export function toSplitInput(spec: SplitSpec): SplitInput {
  if (spec.method === 'equal') return { method: 'equal', members: spec.members };
  return {
    method: 'shares',
    shares: Object.entries(spec.shares)
      .filter(([, n]) => n > 0)
      .map(([memberId, n]) => ({ memberId, shares: String(n) })),
  };
}

export function sharesFor(total: bigint, spec: SplitSpec, seed: string) {
  try {
    return computeShares(total, toSplitInput(spec), seed);
  } catch {
    return null;
  }
}

export const current = (e: Expense): Version => e.versions[e.versions.length - 1]!;

function expensePostings(e: Expense): Posting[] {
  const v = current(e);
  return breakdownExpense(
    {
      expenseId: e.id,
      kind: 'expense',
      currency: 'INR',
      total: v.total,
      payers: [{ memberId: e.payer, amount: v.total }],
      split: toSplitInput(v.split),
    },
    'INR',
  ).postings;
}

// ---------- selectors ----------

export const groupExpenses = (s: State, groupId: string) =>
  s.expenses.filter((e) => e.groupId === groupId && !e.deleted);

export function groupPostings(s: State, groupId: string): Posting[] {
  const out: Posting[] = [];
  for (const e of groupExpenses(s, groupId)) out.push(...expensePostings(e));
  for (const p of s.payments) {
    if (p.groupId === groupId && p.status === 'confirmed') out.push(...settlementPostings(p.from, p.to, p.amount));
  }
  return out;
}

export const balancesOf = (s: State, groupId: string) => computeBalances(groupPostings(s, groupId));

export function balanceOf(s: State, groupId: string, memberId = ME): bigint {
  return balancesOf(s, groupId).find((b) => b.memberId === memberId)?.amount ?? 0n;
}

export const transfersOf = (s: State, groupId: string) => simplifyDebts(balancesOf(s, groupId));

export const memberName = (s: State, id: string) => s.members[id]?.name ?? id;

/** The suggested payments that involve this member: who pays me, and whom I pay. */
export function myTransfers(s: State, groupId: string, memberId = ME) {
  return transfersOf(s, groupId).filter((t) => t.from === memberId || t.to === memberId);
}

/** What's settled between me and one person in the plan: positive when they pay me, negative when I pay them. */
export function betweenMe(s: State, groupId: string, memberId: string): bigint {
  const t = myTransfers(s, groupId).find((x) => x.from === memberId || x.to === memberId);
  return !t ? 0n : t.from === memberId ? t.amount : -t.amount;
}

export function netAll(s: State) {
  let get = 0n;
  let pay = 0n;
  for (const g of s.groups) {
    const b = balanceOf(s, g.id);
    if (b > 0n) get += b;
    else pay += -b;
  }
  return { net: get - pay, get, pay };
}

/** This member's effect from one expense: + lent, − owes. */
export function myEffect(e: Expense, memberId = ME): bigint {
  return expensePostings(e).find((p) => p.memberId === memberId)?.amount ?? 0n;
}

export function myShare(e: Expense, memberId = ME): bigint {
  const v = current(e);
  return sharesFor(v.total, v.split, e.id)?.find((x) => x.memberId === memberId)?.amount ?? 0n;
}

export interface InboxItem {
  key: string;
  kind: 'suggestion' | 'question' | 'dispute' | 'payment' | 'message';
  groupId: string;
  expenseId?: string;
  paymentId?: string;
  /** Pair thread: the other member. */
  withMember?: string;
  who: string;
  text: string;
}

export function inbox(s: State, me = ME): InboxItem[] {
  const items: InboxItem[] = [];
  for (const e of s.expenses) {
    if (e.deleted || e.payer !== me) continue;
    for (const sg of e.suggestions) {
      if (sg.status === 'open') {
        items.push({ key: sg.id, kind: 'suggestion', groupId: e.groupId, expenseId: e.id, who: sg.by, text: `wants ${e.title} at ${inr(sg.total)}` });
      }
    }
    for (const q of e.messages) {
      if (q.kind === 'question' && !q.resolved && q.by !== me) {
        items.push({ key: q.id, kind: 'question', groupId: e.groupId, expenseId: e.id, who: q.by, text: `asked about ${e.title}` });
      }
    }
    for (const d of e.disputes) {
      items.push({ key: `${e.id}:${d.by}`, kind: 'dispute', groupId: e.groupId, expenseId: e.id, who: d.by, text: `says ${e.title} is wrong` });
    }
  }
  for (const p of s.payments) {
    if (p.status === 'awaiting' && p.to === me) {
      items.push({ key: p.id, kind: 'payment', groupId: p.groupId, paymentId: p.id, who: p.from, text: `says they paid you ${inr(p.amount)}` });
    }
  }
  for (const u of unreadPairs(s, me)) {
    items.push({ key: `pair:${u.groupId}:${u.with}`, kind: 'message', groupId: u.groupId, withMember: u.with, who: u.with, text: `messaged you about settling up` });
  }
  return items;
}

/** "Why do I owe this?": each expense and confirmed payment's effect on one member. */
export function whyTrace(s: State, groupId: string, memberId = ME) {
  const rows: { label: string; amount: bigint; expenseId?: string }[] = [];
  for (const e of groupExpenses(s, groupId)) {
    const a = myEffect(e, memberId);
    if (a !== 0n) rows.push({ label: e.title, amount: a, expenseId: e.id });
  }
  for (const p of s.payments) {
    if (p.groupId !== groupId || p.status !== 'confirmed') continue;
    const a = settlementPostings(p.from, p.to, p.amount).find((x) => x.memberId === memberId)?.amount;
    if (a) rows.push({ label: `Payment ${s.members[p.from]?.name} → ${s.members[p.to]?.name}`, amount: a });
  }
  return rows;
}

/** Where an inbox item opens. */
export const inboxHref = (i: InboxItem) =>
  i.withMember ? `/group/${i.groupId}/with/${i.withMember}` : i.expenseId ? `/group/${i.groupId}/expense/${i.expenseId}` : `/group/${i.groupId}/settle`;

// ---------- conversation helpers ----------

export const pairKey = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

export function pairThread(s: State, groupId: string, other: string, me = ME): PairMessage[] {
  const [a, b] = pairKey(me, other);
  return s.pairMessages.filter((m) => m.groupId === groupId && m.pair[0] === a && m.pair[1] === b);
}

export const seenMark = (s: State, groupId: string, by: string, type: SeenMark['type'], id: string) =>
  s.seen.find((x) => x.groupId === groupId && x.by === by && x.type === type && x.id === id);

/** Pair threads where the other person wrote after I last looked. */
export function unreadPairs(s: State, me = ME): { groupId: string; with: string }[] {
  const latest = new Map<string, PairMessage>();
  for (const m of s.pairMessages) {
    if (m.by === me) continue;
    const k = `${m.groupId}|${m.by}`;
    if (!latest.has(k) || latest.get(k)!.at < m.at) latest.set(k, m);
  }
  const out: { groupId: string; with: string }[] = [];
  for (const m of latest.values()) {
    const mine = pairThread(s, m.groupId, m.by, me).filter((x) => x.by === me).at(-1);
    const seen = seenMark(s, m.groupId, me, 'pair', m.by);
    if ((!seen || seen.at < m.at) && (!mine || mine.at < m.at)) out.push({ groupId: m.groupId, with: m.by });
  }
  return out;
}

/** Expense threads where someone else wrote after I last looked (and after my own last message). */
export function unreadThreads(s: State, me = ME): Expense[] {
  return s.expenses.filter((e) => {
    if (!e.canChat || e.deleted) return false;
    const last = e.messages.filter((m) => m.by !== me).at(-1);
    if (!last) return false;
    const mine = e.messages.filter((m) => m.by === me).at(-1);
    const seen = seenMark(s, e.groupId, me, 'expense', e.id);
    return (!seen || seen.at < last.at) && (!mine || mine.at < last.at);
  });
}

/**
 * Where something new, or waiting for me, came from: the group, the expense and the person it came
 * through, so each place shows a dot. Settle: a payment there waits for my confirmation.
 */
export function newMarks(s: State, me = ME) {
  const groups = new Set<string>();
  const expenses = new Set<string>();
  const people = new Set<string>(); // `${groupId}|${memberId}`
  const settle = new Set<string>();
  for (const i of inbox(s, me)) {
    groups.add(i.groupId);
    if (i.expenseId) expenses.add(i.expenseId);
    if (i.withMember) people.add(`${i.groupId}|${i.withMember}`);
    if (i.kind === 'payment') {
      settle.add(i.groupId);
      people.add(`${i.groupId}|${i.who}`);
    }
  }
  for (const e of unreadThreads(s, me)) {
    groups.add(e.groupId);
    expenses.add(e.id);
  }
  return { groups, expenses, people, settle };
}

export const roleOf = (s: State, groupId: string, memberId = ME): Role => s.roster[groupId]?.find((m) => m.id === memberId)?.role ?? 'member';
export const isAdmin = (s: State, groupId: string) => roleOf(s, groupId) !== 'member';

// ---------- actions ----------

export type Action =
  | { type: 'add_group'; id: string; name: string; kind: Group['kind']; memberNames: string[] }
  | { type: 'add_expense'; id: string; groupId: string; title: string; icon: ExpenseIcon; total: bigint; payer: string; split: SplitSpec }
  | { type: 'edit_expense'; id: string; title: string; total: bigint; payer: string; split: SplitSpec }
  | { type: 'suggest'; id: string; total: bigint; split: SplitSpec; reason: string }
  | { type: 'decide'; id: string; suggestionId: string; accept: boolean }
  /** A message in an expense's thread; `question` marks it as needing an answer. */
  | { type: 'post'; id: string; messageId: string; text: string; question: boolean }
  | { type: 'resolve'; id: string; messageId: string }
  | { type: 'pair_message'; groupId: string; with: string; messageId: string; text: string }
  | { type: 'add_member'; groupId: string; memberId: string; name: string }
  | { type: 'remove_member'; groupId: string; memberId: string; acknowledgeBalance: boolean }
  | { type: 'set_role'; groupId: string; memberId: string; role: 'admin' | 'member' }
  | { type: 'dispute'; id: string; reason: string }
  | { type: 'withdraw_dispute'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'restore'; id: string }
  | { type: 'record_payment'; groupId: string; from: string; to: string; amount: bigint; via: 'upi' | 'cash' }
  | { type: 'confirm_payment'; id: string }
  | { type: 'decline_payment'; id: string };

/** The group an action changes (for a new group, its own id). */
export function actionGroup(s: State, a: Action): string | undefined {
  if (a.type === 'add_group') return a.id;
  if ('groupId' in a) return a.groupId;
  return s.expenses.find((e) => e.id === a.id)?.groupId ?? s.payments.find((p) => p.id === a.id)?.groupId;
}

const mapExpense = (s: State, id: string, fn: (e: Expense) => Expense): State => ({
  ...s,
  expenses: s.expenses.map((e) => (e.id === id ? fn(e) : e)),
});

function withVersion(e: Expense, total: bigint, split: SplitSpec, by: string): Expense {
  return {
    ...e,
    versions: [...e.versions, { n: current(e).n + 1, total, split, by }],
    disputes: [],
    suggestions: e.suggestions.map((x) => (x.status === 'open' ? { ...x, status: 'outdated' as const } : x)),
  };
}

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

export function reducer(s: State, a: Action, me = ME): State {
  const find = (id: string) => s.expenses.find((e) => e.id === id);
  const uid = (p: string) => `${p}${s.nextId}`;
  const bump = (x: State): State => ({ ...x, nextId: x.nextId + 1 });

  switch (a.type) {
    case 'add_group': {
      // Members start as placeholders (names only); they claim them from an invite link.
      const id = a.id;
      const members = { ...s.members };
      const ids = a.memberNames.map((name, i) => {
        const mid = `${id}m${i}`;
        members[mid] = { id: mid, name };
        return mid;
      });
      const roster = [{ id: me, role: 'owner' as const, joined: true, active: true }, ...ids.map((m) => ({ id: m, role: 'member' as const, joined: false, active: true }))];
      return { ...s, members, groups: [{ id, name: a.name, kind: a.kind, members: [me, ...ids] }, ...s.groups], roster: { ...s.roster, [id]: roster } };
    }
    case 'add_expense': {
      const e: Expense = {
        id: a.id,
        groupId: a.groupId,
        title: a.title,
        icon: a.icon,
        date: today(),
        payer: a.payer,
        versions: [{ n: 1, total: a.total, split: a.split, by: me }],
        deleted: false,
        disputes: [],
        messages: [],
        canChat: true,
        suggestions: [],
      };
      return { ...s, expenses: [e, ...s.expenses] };
    }
    case 'edit_expense': {
      const e = find(a.id);
      if (!e || e.payer !== me) return s;
      return mapExpense(s, a.id, (x) => ({ ...withVersion(x, a.total, a.split, me), title: a.title, payer: a.payer }));
    }
    case 'suggest': {
      const e = find(a.id);
      if (!e || e.payer === me) return s;
      const sg: Suggestion = { id: uid('s'), by: me, total: a.total, split: a.split, reason: a.reason, baseVersion: current(e).n, status: 'open' };
      return bump(mapExpense(s, a.id, (x) => ({ ...x, suggestions: [...x.suggestions, sg] })));
    }
    case 'decide': {
      const e = find(a.id);
      const sg = e?.suggestions.find((x) => x.id === a.suggestionId);
      if (!e || !sg || e.payer !== me || sg.status !== 'open' || sg.baseVersion !== current(e).n) return s;
      if (!a.accept) {
        return mapExpense(s, a.id, (x) => ({
          ...x,
          suggestions: x.suggestions.map((y) => (y.id === sg.id ? { ...y, status: 'declined' as const } : y)),
        }));
      }
      return mapExpense(s, a.id, (x) => {
        const next = withVersion(x, sg.total, sg.split, me);
        return { ...next, suggestions: next.suggestions.map((y) => (y.id === sg.id ? { ...y, status: 'accepted' as const } : y)) };
      });
    }
    case 'post':
      return mapExpense(s, a.id, (x) => ({
        ...x,
        messages: [...x.messages, { id: a.messageId, by: me, kind: a.question ? 'question' : 'text', text: a.text, at: now(), resolved: false }],
      }));
    case 'resolve':
      return mapExpense(s, a.id, (x) => ({ ...x, messages: x.messages.map((m) => (m.id === a.messageId ? { ...m, resolved: true } : m)) }));
    case 'pair_message':
      return {
        ...s,
        pairMessages: [
          ...s.pairMessages,
          { id: a.messageId, groupId: a.groupId, pair: pairKey(me, a.with), by: me, kind: 'text', text: a.text, at: now(), resolved: false },
        ],
      };
    case 'add_member':
      return {
        ...s,
        members: { ...s.members, [a.memberId]: { id: a.memberId, name: a.name } },
        groups: s.groups.map((g) => (g.id === a.groupId ? { ...g, members: [...g.members, a.memberId] } : g)),
        roster: { ...s.roster, [a.groupId]: [...(s.roster[a.groupId] ?? []), { id: a.memberId, role: 'member', joined: false, active: true }] },
      };
    case 'remove_member':
      return {
        ...s,
        groups: s.groups.map((g) => (g.id === a.groupId ? { ...g, members: g.members.filter((m) => m !== a.memberId) } : g)),
        roster: { ...s.roster, [a.groupId]: (s.roster[a.groupId] ?? []).map((m) => (m.id === a.memberId ? { ...m, active: false } : m)) },
      };
    case 'set_role':
      return {
        ...s,
        roster: { ...s.roster, [a.groupId]: (s.roster[a.groupId] ?? []).map((m) => (m.id === a.memberId ? { ...m, role: a.role } : m)) },
      };
    case 'dispute':
      return mapExpense(s, a.id, (x) =>
        x.disputes.some((d) => d.by === me) ? x : { ...x, disputes: [...x.disputes, { by: me, reason: a.reason }] },
      );
    case 'withdraw_dispute':
      return mapExpense(s, a.id, (x) => ({ ...x, disputes: x.disputes.filter((d) => d.by !== me) }));
    case 'delete':
      return mapExpense(s, a.id, (x) => (x.payer === me ? { ...x, deleted: true } : x));
    case 'restore':
      return mapExpense(s, a.id, (x) => (x.payer === me ? { ...x, deleted: false } : x));
    case 'record_payment': {
      if (me !== a.from && me !== a.to) return s;
      // Receiver-recorded payments count immediately; payer-recorded ones wait for the receiver.
      const p: Payment = { id: uid('p'), groupId: a.groupId, from: a.from, to: a.to, amount: a.amount, via: a.via, status: me === a.to ? 'confirmed' : 'awaiting' };
      return bump({ ...s, payments: [...s.payments, p] });
    }
    case 'confirm_payment':
    case 'decline_payment':
      return {
        ...s,
        payments: s.payments.map((p) =>
          p.id === a.id && p.to === me && p.status === 'awaiting'
            ? { ...p, status: a.type === 'confirm_payment' ? ('confirmed' as const) : ('declined' as const) }
            : p,
        ),
      };
  }
}

// ---------- seed ----------

const all4 = [ME, 'bilal', 'chitra', 'dev'];

export function seed(): State {
  const nights: SplitSpec = { method: 'shares', shares: { [ME]: 3, bilal: 3, chitra: 2, dev: 3 } };
  const blank = { deleted: false, disputes: [], messages: [], canChat: true, suggestions: [] };
  return {
    nextId: 100,
    members: Object.fromEntries(
      [
        [ME, 'Asha'],
        ['bilal', 'Bilal'],
        ['chitra', 'Chitra'],
        ['dev', 'Dev'],
        ['rohan', 'Rohan'],
        ['meera', 'Meera'],
        ['kabir', 'Kabir'],
        ['isha', 'Isha'],
        ['tara', 'Tara'],
        ['neel', 'Neel'],
      ].map(([id, name]) => [id, { id: id!, name: name! }]),
    ),
    roster: {
      goa: all4.map((id) => ({ id, role: id === ME ? ('owner' as const) : ('member' as const), joined: true, active: true })),
      flat: [ME, 'rohan', 'meera'].map((id) => ({ id, role: id === 'rohan' ? ('owner' as const) : ('member' as const), joined: true, active: true })),
      lunch: [ME, 'kabir', 'isha', 'tara', 'neel', 'meera'].map((id) => ({ id, role: id === ME ? ('owner' as const) : ('member' as const), joined: id !== 'neel', active: true })),
    },
    pairMessages: [
      { id: 'pm1', groupId: 'goa', pair: pairKey(ME, 'bilal'), by: 'bilal', kind: 'text', text: 'UPI kar diya ₹300, check kar lena', at: '2026-10-22T10:00:00.000Z', resolved: false },
    ],
    seen: [{ groupId: 'goa', by: 'bilal', type: 'expense', id: 'e1', version: 1, at: '2026-10-22T09:00:00.000Z' }],
    groups: [
      { id: 'goa', name: 'Goa Trip', kind: 'trip', members: all4 },
      { id: 'flat', name: 'Flat 302', kind: 'home', members: [ME, 'rohan', 'meera'] },
      { id: 'lunch', name: 'Office lunch', kind: 'food', members: [ME, 'kabir', 'isha', 'tara', 'neel', 'meera'] },
    ],
    expenses: [
      { ...blank, id: 'e3', groupId: 'goa', title: 'Taxi', icon: 'taxi', date: '2026-10-22', payer: 'dev', versions: [{ n: 1, total: 90000n, split: { method: 'equal', members: [ME, 'bilal', 'dev'] }, by: 'dev' }] },
      { ...blank, id: 'e2', groupId: 'goa', title: 'Dinner at Thalassa', icon: 'food', date: '2026-10-21', payer: 'bilal', versions: [{ n: 1, total: 240000n, split: { method: 'equal', members: all4 }, by: 'bilal' }] },
      {
        ...blank,
        id: 'e1',
        groupId: 'goa',
        title: 'Hotel',
        icon: 'hotel',
        date: '2026-10-21',
        payer: ME,
        versions: [{ n: 1, total: 660000n, split: nights, by: ME }],
        messages: [{ id: 'q1', by: 'bilal', kind: 'question', text: 'Breakfast included tha?', at: '2026-10-22T09:30:00.000Z', resolved: false }],
        suggestions: [{ id: 's1', by: 'dev', total: 600000n, split: nights, reason: 'Discount code laga tha, final bill ₹6,000 aaya.', baseVersion: 1, status: 'open' }],
      },
      { ...blank, id: 'f2', groupId: 'flat', title: 'Wi-Fi bill', icon: 'wifi', date: '2026-10-21', payer: 'rohan', versions: [{ n: 1, total: 120000n, split: { method: 'equal', members: [ME, 'rohan', 'meera'] }, by: 'rohan' }] },
      { ...blank, id: 'f1', groupId: 'flat', title: 'Groceries', icon: 'cart', date: '2026-10-18', payer: 'meera', versions: [{ n: 1, total: 135000n, split: { method: 'equal', members: [ME, 'rohan', 'meera'] }, by: 'meera' }] },
      { ...blank, id: 'l1', groupId: 'lunch', title: 'Team lunch', icon: 'food', date: '2026-10-10', payer: ME, versions: [{ n: 1, total: 300000n, split: { method: 'equal', members: [ME, 'kabir', 'isha', 'tara', 'neel', 'meera'] }, by: ME }] },
    ],
    payments: [
      { id: 'p1', groupId: 'goa', from: 'bilal', to: ME, amount: 30000n, via: 'upi', status: 'awaiting' },
      ...['kabir', 'isha', 'tara', 'neel', 'meera'].map((m, i) => ({ id: `lp${i}`, groupId: 'lunch', from: m, to: ME, amount: 50000n, via: 'upi' as const, status: 'confirmed' as const })),
    ],
  };
}
