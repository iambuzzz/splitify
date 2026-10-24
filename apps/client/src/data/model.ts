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
  /** Shares per member (1, 2, 1.5…); 0 = not included. */
  | { method: 'shares'; shares: Record<string, number> }
  /** Percent per member in basis points (2500 = 25%), summing to 10,000; 0 = not included. */
  | { method: 'percent'; basisPoints: Record<string, number> }
  /** Exact amounts per member, summing to the total (imports, and splits made elsewhere). */
  | { method: 'exact'; amounts: Record<string, bigint> };

const METHOD_WORDS: Record<SplitSpec['method'], string> = { equal: 'equally', shares: 'by shares', percent: 'by percentage', exact: 'by exact amounts' };
/** How a split method reads in a sentence: "split equally", "split by shares", "split by percentage", "split by exact amounts". */
export const methodWords = (m: SplitSpec['method']) => METHOD_WORDS[m];
export const splitWords = (spec: SplitSpec) => methodWords(spec.method);

/** Basis points as a percentage: 2500 → "25%", 3333 → "33.33%". */
export const percentText = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

/** A typed percentage ("25", "33.33", "12.5%") in basis points; null if it isn't one. Blank is 0. */
export function parsePercent(text: string): number | null {
  const t = text.replace(/[%\s]/g, '');
  if (t === '') return 0;
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(t);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp <= 10000 ? bp : null;
}

/** A typed number of shares ("1", "2", "1.5"); null if it isn't one. Blank is 0. */
export function parseShares(text: string): number | null {
  const t = text.trim();
  if (t === '') return 0;
  return /^\d{1,6}(\.\d{1,2})?$/.test(t) ? Number(t) : null;
}

export interface Version {
  n: number;
  total: bigint;
  split: SplitSpec;
  by: string;
  /** Name and payer as of this version, and when it was made (ISO). Missing in some demo data. */
  title?: string;
  payer?: string;
  at?: string;
}

/** One difference between two versions of an expense, in words the history can show. */
export type Change =
  | { kind: 'amount'; from: bigint; to: bigint }
  | { kind: 'title'; from: string; to: string }
  | { kind: 'payer'; from: string; to: string }
  | { kind: 'method'; from: SplitSpec['method']; to: SplitSpec['method'] }
  | { kind: 'share'; member: string; from: bigint; to: bigint }
  | { kind: 'added'; member: string; to: bigint }
  | { kind: 'removed'; member: string; from: bigint };

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

/** A photo or PDF of the bill, attached to an expense. */
export interface Receipt {
  id: string;
  by: string;
  contentType: string;
  size: number;
  /** ISO time. */
  at: string;
  /** Demo mode only: the file, kept in this browser. */
  localUrl?: string;
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
  receipts: Receipt[];
  /** Who may edit it: whoever added it and whoever paid. */
  owners: string[];
  /** Deleted: by whom (the owner, or an admin). */
  deletedBy?: string;
}

export interface Payment {
  id: string;
  groupId: string;
  from: string;
  to: string;
  amount: bigint;
  via: 'upi' | 'cash';
  /** `voided`: confirmed, then undone by the receiver (a mistake); it no longer counts. */
  status: 'awaiting' | 'confirmed' | 'declined' | 'voided';
  /** Who recorded it (the payer or the receiver). */
  by?: string;
  /** When it was recorded (ISO). */
  at?: string;
}

export interface Group {
  id: string;
  name: string;
  members: string[];
  /** When an owner or admin finished it (ISO); see groupPhase. */
  finishedAt?: string;
  /** When the last payment made everyone square, as the server saw it (ISO). */
  closedAt?: string;
}

/**
 * open: anything goes. finishing: finished, so no new or changed expenses, but payments go on.
 * closed: finished and nobody owes anything, nothing waits for a confirmation: read-only.
 */
export type GroupPhase = 'open' | 'finishing' | 'closed';

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
  if (spec.method === 'exact') return { method: 'exact', amounts: Object.entries(spec.amounts).filter(([, v]) => v > 0n).map(([memberId, amount]) => ({ memberId, amount })) };
  if (spec.method === 'percent') return { method: 'percent', basisPoints: Object.entries(spec.basisPoints).filter(([, n]) => n > 0).map(([memberId, basisPoints]) => ({ memberId, basisPoints })) };
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

/** What changed from one version to the next: amount, name, payer, how it's split, and each person's share. */
export function versionChanges(prev: Version, next: Version, seed: string): Change[] {
  const out: Change[] = [];
  if (prev.total !== next.total) out.push({ kind: 'amount', from: prev.total, to: next.total });
  if (prev.title !== undefined && next.title !== undefined && prev.title !== next.title) out.push({ kind: 'title', from: prev.title, to: next.title });
  if (prev.payer !== undefined && next.payer !== undefined && prev.payer !== next.payer) out.push({ kind: 'payer', from: prev.payer, to: next.payer });
  if (prev.split.method !== next.split.method) out.push({ kind: 'method', from: prev.split.method, to: next.split.method });
  const before = new Map((sharesFor(prev.total, prev.split, seed) ?? []).map((x) => [x.memberId, x.amount]));
  const after = new Map((sharesFor(next.total, next.split, seed) ?? []).map((x) => [x.memberId, x.amount]));
  for (const [member, to] of after) {
    const from = before.get(member);
    if (from === undefined || from === 0n) {
      if (to !== 0n) out.push({ kind: 'added', member, to });
    } else if (to === 0n) out.push({ kind: 'removed', member, from });
    else if (from !== to) out.push({ kind: 'share', member, from, to });
  }
  for (const [member, from] of before) if (!after.has(member) && from !== 0n) out.push({ kind: 'removed', member, from });
  return out;
}

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
    if (e.deleted || !e.owners.includes(me)) continue;
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
    if (p.status === 'awaiting' && answersPayment(s, p, me)) {
      const to = p.to === me ? 'you' : (s.members[p.to]?.name ?? 'someone');
      items.push({ key: p.id, kind: 'payment', groupId: p.groupId, paymentId: p.id, who: p.from, text: `says they paid ${to} ${inr(p.amount)}` });
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

/**
 * The full "how it adds up" for one member: what they paid, their share of each expense, payments sent
 * and received, everyone's balance, and the payments that settle it (which may be to someone they
 * never shared a bill with: balances are pooled, then settled in the fewest payments).
 */
export function explainBalance(s: State, groupId: string, memberId = ME) {
  const expenses: { id: string; title: string; date: string; paid: bigint; share: bigint; effect: bigint }[] = [];
  let paid = 0n;
  let share = 0n;
  for (const e of groupExpenses(s, groupId)) {
    const v = current(e);
    const p = e.payer === memberId ? v.total : 0n;
    const sh = sharesFor(v.total, v.split, e.id)?.find((x) => x.memberId === memberId)?.amount ?? 0n;
    if (p === 0n && sh === 0n) continue;
    paid += p;
    share += sh;
    expenses.push({ id: e.id, title: e.title, date: e.date, paid: p, share: sh, effect: p - sh });
  }
  const payments: { id: string; other: string; sent: boolean; amount: bigint }[] = [];
  let sent = 0n;
  let received = 0n;
  for (const p of s.payments) {
    if (p.groupId !== groupId || p.status !== 'confirmed' || (p.from !== memberId && p.to !== memberId)) continue;
    const isSent = p.from === memberId;
    if (isSent) sent += p.amount;
    else received += p.amount;
    payments.push({ id: p.id, other: isSent ? p.to : p.from, sent: isSent, amount: p.amount });
  }
  const balances = balancesOf(s, groupId)
    .filter((b) => b.amount !== 0n)
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  return {
    paid,
    share,
    sent,
    received,
    /** paid − share + sent − received: positive = gets money back. */
    balance: balanceOf(s, groupId, memberId),
    expenses,
    payments,
    balances,
    plan: myTransfers(s, groupId, memberId),
  };
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

/** Worked out from the balances, as the server does, so a confirmed last payment closes the group at once. */
export function groupPhase(s: State, groupId: string): GroupPhase {
  const g = s.groups.find((x) => x.id === groupId);
  if (!g?.finishedAt) return 'open';
  const busy = balancesOf(s, groupId).some((b) => b.amount !== 0n) || s.payments.some((p) => p.groupId === groupId && p.status === 'awaiting');
  return busy ? 'finishing' : 'closed';
}

/** What's still open before a group can close: who pays whom, payments to confirm, questions, suggestions, flags. */
export function beforeClosing(s: State, groupId: string) {
  const expenses = groupExpenses(s, groupId);
  return {
    transfers: transfersOf(s, groupId),
    awaiting: s.payments.filter((p) => p.groupId === groupId && p.status === 'awaiting'),
    questions: expenses.flatMap((e) => e.messages.filter((m) => m.kind === 'question' && !m.resolved).map((m) => ({ expense: e, message: m }))),
    suggestions: expenses.flatMap((e) => e.suggestions.filter((x) => x.status === 'open').map((x) => ({ expense: e, suggestion: x }))),
    disputes: expenses.flatMap((e) => e.disputes.map((d) => ({ expense: e, by: d.by, reason: d.reason }))),
  };
}

// ---------- actions ----------

export type Action =
  | { type: 'add_group'; id: string; name: string; memberNames: string[] }
  | { type: 'rename_group'; groupId: string; name: string }
  | { type: 'finish_group'; groupId: string }
  | { type: 'reopen_group'; groupId: string }
  /** The owner hands the group over; they stay on as an admin. */
  | { type: 'make_owner'; groupId: string; memberId: string }
  | { type: 'add_expense'; id: string; groupId: string; title: string; icon: ExpenseIcon; total: bigint; payer: string; split: SplitSpec }
  | { type: 'edit_expense'; id: string; title: string; total: bigint; payer: string; split: SplitSpec }
  /** From a Splitwise file: a dated expense with exact shares (member id → amount, summing to `total`). */
  | { type: 'import_expense'; id: string; groupId: string; title: string; date: string; total: bigint; payer: string; shares: Record<string, bigint> }
  | { type: 'suggest'; id: string; total: bigint; split: SplitSpec; reason: string }
  | { type: 'decide'; id: string; suggestionId: string; accept: boolean }
  /** A message in an expense's thread; `question` marks it as needing an answer. */
  | { type: 'post'; id: string; messageId: string; text: string; question: boolean }
  | { type: 'resolve'; id: string; messageId: string }
  | { type: 'pair_message'; groupId: string; with: string; messageId: string; text: string }
  | { type: 'add_member'; groupId: string; memberId: string; name: string }
  | { type: 'remove_member'; groupId: string; memberId: string; acknowledgeBalance: boolean }
  | { type: 'leave_group'; groupId: string; acknowledgeBalance: boolean }
  | { type: 'set_role'; groupId: string; memberId: string; role: 'admin' | 'member' }
  | { type: 'dispute'; id: string; reason: string }
  | { type: 'withdraw_dispute'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'restore'; id: string }
  | { type: 'record_payment'; groupId: string; from: string; to: string; amount: bigint; via: 'upi' | 'cash'; paymentId?: string }
  | { type: 'add_receipt'; id: string; receipt: Receipt }
  | { type: 'remove_receipt'; id: string; receiptId: string }
  | { type: 'confirm_payment'; id: string }
  | { type: 'decline_payment'; id: string }
  | { type: 'void_payment'; id: string }
  | { type: 'withdraw_payment'; id: string };

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

function withVersion(e: Expense, total: bigint, split: SplitSpec, by: string, title = e.title, payer = e.payer): Expense {
  return {
    ...e,
    versions: [...e.versions, { n: current(e).n + 1, total, split, by, title, payer, at: now() }],
    disputes: [],
    suggestions: e.suggestions.map((x) => (x.status === 'open' ? { ...x, status: 'outdated' as const } : x)),
  };
}

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

/**
 * Who answers "did you get it?" for a payment: the receiver, or, when the receiver is a name that
 * hasn't joined yet, the group's owner or an admin on their behalf.
 */
export function answersPayment(s: State, p: Payment, me = ME): boolean {
  if (p.to === me) return true;
  const receiver = s.roster[p.groupId]?.find((m) => m.id === p.to);
  return !!receiver && !receiver.joined && roleOf(s, p.groupId, me) !== 'member';
}

/** Delete and restore: the expense's owners, or the group's owner or an admin. */
export const canDelete = (s: State, e: Expense, me = ME) => e.owners.includes(me) || roleOf(s, e.groupId, me) !== 'member';

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
      return { ...s, members, groups: [{ id, name: a.name, members: [me, ...ids] }, ...s.groups], roster: { ...s.roster, [id]: roster } };
    }
    case 'rename_group':
      return { ...s, groups: s.groups.map((g) => (g.id === a.groupId ? { ...g, name: a.name } : g)) };
    case 'finish_group':
      return { ...s, groups: s.groups.map((g) => (g.id === a.groupId ? { ...g, finishedAt: g.finishedAt ?? now() } : g)) };
    case 'reopen_group':
      return { ...s, groups: s.groups.map((g) => (g.id === a.groupId ? { ...g, finishedAt: undefined, closedAt: undefined } : g)) };
    case 'make_owner':
      return {
        ...s,
        roster: {
          ...s.roster,
          [a.groupId]: (s.roster[a.groupId] ?? []).map((m) => (m.id === a.memberId ? { ...m, role: 'owner' as const } : m.id === me ? { ...m, role: 'admin' as const } : m)),
        },
      };
    case 'add_expense': {
      const e: Expense = {
        id: a.id,
        groupId: a.groupId,
        title: a.title,
        icon: a.icon,
        date: today(),
        payer: a.payer,
        versions: [{ n: 1, total: a.total, split: a.split, by: me, title: a.title, payer: a.payer, at: now() }],
        deleted: false,
        disputes: [],
        messages: [],
        canChat: true,
        suggestions: [],
        receipts: [],
        owners: [...new Set([me, a.payer])],
      };
      return { ...s, expenses: [e, ...s.expenses] };
    }
    case 'import_expense': {
      if (find(a.id)) return s;
      const split: SplitSpec = { method: 'exact', amounts: a.shares };
      const e: Expense = {
        id: a.id,
        groupId: a.groupId,
        title: a.title,
        icon: 'other',
        date: a.date,
        payer: a.payer,
        versions: [{ n: 1, total: a.total, split, by: me, title: a.title, payer: a.payer, at: now() }],
        deleted: false,
        disputes: [],
        messages: [],
        canChat: true,
        suggestions: [],
        receipts: [],
        owners: [...new Set([me, a.payer])],
      };
      return { ...s, expenses: [e, ...s.expenses] };
    }
    case 'edit_expense': {
      const e = find(a.id);
      if (!e || !e.owners.includes(me)) return s;
      return mapExpense(s, a.id, (x) => ({ ...withVersion(x, a.total, a.split, me, a.title, a.payer), title: a.title, payer: a.payer }));
    }
    case 'suggest': {
      const e = find(a.id);
      if (!e || e.owners.includes(me)) return s;
      const sg: Suggestion = { id: uid('s'), by: me, total: a.total, split: a.split, reason: a.reason, baseVersion: current(e).n, status: 'open' };
      return bump(mapExpense(s, a.id, (x) => ({ ...x, suggestions: [...x.suggestions, sg] })));
    }
    case 'decide': {
      const e = find(a.id);
      const sg = e?.suggestions.find((x) => x.id === a.suggestionId);
      if (!e || !sg || !e.owners.includes(me) || sg.status !== 'open' || sg.baseVersion !== current(e).n) return s;
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
    case 'leave_group':
      return reducer(s, { type: 'remove_member', groupId: a.groupId, memberId: me, acknowledgeBalance: a.acknowledgeBalance }, me);
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
    // Owners, and the group's owner or admins (spam, mistakes); the expense says who deleted it.
    case 'delete':
      return mapExpense(s, a.id, (x) => (canDelete(s, x, me) ? { ...x, deleted: true, deletedBy: me } : x));
    case 'restore':
      return mapExpense(s, a.id, (x) => (canDelete(s, x, me) ? { ...x, deleted: false, deletedBy: undefined } : x));
    case 'add_receipt':
      return mapExpense(s, a.id, (x) => (x.receipts.some((r) => r.id === a.receipt.id) ? x : { ...x, receipts: [...x.receipts, a.receipt] }));
    case 'remove_receipt':
      return mapExpense(s, a.id, (x) => ({ ...x, receipts: x.receipts.filter((r) => r.id !== a.receiptId) }));
    case 'record_payment': {
      if (me !== a.from && me !== a.to) return s;
      // Receiver-recorded payments count immediately; payer-recorded ones wait for the receiver.
      const p: Payment = { id: a.paymentId ?? uid('p'), groupId: a.groupId, from: a.from, to: a.to, amount: a.amount, via: a.via, status: me === a.to ? 'confirmed' : 'awaiting', by: me, at: now() };
      return bump({ ...s, payments: [...s.payments, p] });
    }
    case 'confirm_payment':
    case 'decline_payment':
      return {
        ...s,
        payments: s.payments.map((p) =>
          p.id === a.id && answersPayment(s, p, me) && p.status === 'awaiting'
            ? { ...p, status: a.type === 'confirm_payment' ? ('confirmed' as const) : ('declined' as const) }
            : p,
        ),
      };
    // A mistake: whoever answers for the receiver undoes a counted payment; the payer cancels one still waiting.
    case 'void_payment':
      return { ...s, payments: s.payments.map((p) => (p.id === a.id && p.status === 'confirmed' && answersPayment(s, p, me) ? { ...p, status: 'voided' as const } : p)) };
    case 'withdraw_payment':
      return { ...s, payments: s.payments.map((p) => (p.id === a.id && p.status === 'awaiting' && (p.by ?? p.from) === me ? { ...p, status: 'declined' as const } : p)) };
  }
}

// ---------- seed ----------

const all4 = [ME, 'bilal', 'chitra', 'dev'];

export function seed(): State {
  const nights: SplitSpec = { method: 'shares', shares: { [ME]: 3, bilal: 3, chitra: 2, dev: 3 } };
  const blank = { deleted: false, disputes: [], messages: [], canChat: true, suggestions: [], receipts: [] };
  const owned = (payer: string) => ({ payer, owners: [payer] });
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
      { id: 'goa', name: 'Goa Trip', members: all4 },
      { id: 'flat', name: 'Flat 302', members: [ME, 'rohan', 'meera'] },
      { id: 'lunch', name: 'Office lunch', members: [ME, 'kabir', 'isha', 'tara', 'neel', 'meera'], finishedAt: '2026-10-12T10:00:00.000Z', closedAt: '2026-10-12T10:00:00.000Z' },
    ],
    expenses: [
      { ...blank, id: 'e3', groupId: 'goa', title: 'Taxi', icon: 'taxi', date: '2026-10-22', ...owned('dev'), versions: [
          { n: 1, total: 120000n, split: { method: 'equal', members: [ME, 'bilal', 'chitra', 'dev'] }, by: 'dev', title: 'Cab', payer: 'dev', at: '2026-10-22T08:10:00.000Z' },
          { n: 2, total: 90000n, split: { method: 'equal', members: [ME, 'bilal', 'dev'] }, by: 'dev', title: 'Taxi', payer: 'dev', at: '2026-10-22T11:40:00.000Z' },
        ] },
      { ...blank, id: 'e2', groupId: 'goa', title: 'Dinner at Thalassa', icon: 'food', date: '2026-10-21', ...owned('bilal'), versions: [{ n: 1, total: 240000n, split: { method: 'equal', members: all4 }, by: 'bilal' }] },
      {
        ...blank,
        id: 'e1',
        groupId: 'goa',
        title: 'Hotel',
        icon: 'hotel',
        date: '2026-10-21',
        ...owned(ME),
        versions: [{ n: 1, total: 660000n, split: nights, by: ME }],
        messages: [{ id: 'q1', by: 'bilal', kind: 'question', text: 'Breakfast included tha?', at: '2026-10-22T09:30:00.000Z', resolved: false }],
        suggestions: [{ id: 's1', by: 'dev', total: 600000n, split: nights, reason: 'Discount code laga tha, final bill ₹6,000 aaya.', baseVersion: 1, status: 'open' }],
      },
      { ...blank, id: 'f2', groupId: 'flat', title: 'Wi-Fi bill', icon: 'wifi', date: '2026-10-21', ...owned('rohan'), versions: [{ n: 1, total: 120000n, split: { method: 'equal', members: [ME, 'rohan', 'meera'] }, by: 'rohan' }] },
      { ...blank, id: 'f1', groupId: 'flat', title: 'Groceries', icon: 'cart', date: '2026-10-18', ...owned('meera'), versions: [{ n: 1, total: 135000n, split: { method: 'equal', members: [ME, 'rohan', 'meera'] }, by: 'meera' }] },
      { ...blank, id: 'l1', groupId: 'lunch', title: 'Team lunch', icon: 'food', date: '2026-10-10', ...owned(ME), versions: [{ n: 1, total: 300000n, split: { method: 'equal', members: [ME, 'kabir', 'isha', 'tara', 'neel', 'meera'] }, by: ME }] },
    ],
    payments: [
      { id: 'p1', groupId: 'goa', from: 'bilal', to: ME, amount: 30000n, via: 'upi', status: 'awaiting' },
      ...['kabir', 'isha', 'tara', 'neel', 'meera'].map((m, i) => ({ id: `lp${i}`, groupId: 'lunch', from: m, to: ME, amount: 50000n, via: 'upi' as const, status: 'confirmed' as const })),
    ],
  };
}
