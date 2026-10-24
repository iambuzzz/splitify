import { api } from './api';
import { type Action, type Expense, type ExpenseIcon, type Payment, type SeenMark, type SplitSpec, type State, ME, pairKey, reducer } from './model';

/**
 * Builds the app's State from the API and turns the app's actions into API calls. The screens
 * stay the same in demo and signed-in mode: the signed-in user's member id in each group is
 * shown as ME, and mapped back to the real id when talking to the API.
 */

// Untyped API JSON, read field by field below.
type Json = any;

/** What the API knows about an expense that the screens don't show but edits must send back. */
export interface ExpenseMeta {
  currentVersion: number;
  date: string;
  notes?: string;
  category?: string;
}

export interface Remote {
  state: State;
  /** What the server can do (from the snapshots). */
  features: { receipts: boolean };
  /** groupId → my member id there. */
  me: Record<string, string>;
  meta: Record<string, ExpenseMeta>;
}

const ICONS: ExpenseIcon[] = ['hotel', 'food', 'taxi', 'home', 'wifi', 'cart', 'other'];

export const emptyRemote = (): Remote => ({
  state: { members: {}, groups: [], roster: {}, expenses: [], payments: [], pairMessages: [], seen: [], nextId: 1 },
  features: { receipts: false },
  me: {},
  meta: {},
});

export function buildRemote(snapshots: Json[]): Remote {
  const out = emptyRemote();
  for (const snap of snapshots) {
    const groupId: string = snap.group.id;
    const myId: string = snap.me.memberId;
    out.me[groupId] = myId;
    if (snap.features?.receipts) out.features.receipts = true;
    const id = (memberId: string) => (memberId === myId ? ME : memberId);

    for (const m of snap.members) out.state.members[id(m.id)] = { id: id(m.id), name: m.displayName };
    out.state.groups.push({
      id: groupId,
      name: snap.group.name,
      members: snap.members.filter((m: Json) => m.status === 'active').map((m: Json) => id(m.id)),
      finishedAt: snap.group.finishedAt ?? undefined,
      closedAt: snap.group.closedAt ?? undefined,
    });
    out.state.roster[groupId] = snap.members.map((m: Json) => ({ id: id(m.id), role: m.role, joined: m.joined, active: m.status === 'active' }));
    for (const m of snap.pairMessages ?? []) {
      if (m.deleted) continue;
      out.state.pairMessages.push({ id: m.id, groupId, pair: pairKey(id(m.pair[0]), id(m.pair[1])), by: id(m.authorId), kind: 'text', text: m.body, at: m.createdAt, resolved: false });
    }
    for (const x of snap.seen ?? []) {
      out.state.seen.push({ groupId, by: id(x.memberId), type: x.type, id: x.type === 'pair' ? id(x.id) : x.id, version: x.version ?? undefined, at: x.seenAt });
    }

    for (const d of snap.expenses) {
      const e = toExpense(d, id);
      if (!e) continue;
      out.state.expenses.push(e);
      const cur = d.versions.find((v: Json) => v.version === d.currentVersion);
      out.meta[d.id] = { currentVersion: d.currentVersion, date: d.date, notes: cur?.notes ?? undefined, category: cur?.category ?? undefined };
    }

    for (const p of snap.settlements) out.state.payments.push(toPayment(p, groupId, id));
  }
  return out;
}

function toExpense(d: Json, id: (m: string) => string): Expense | null {
  // What counts (or counted, for a deleted expense). Drafts and new expenses still waiting for
  // review don't count yet; the screens don't show those states until review mode arrives in R2.
  const counted: number | null = d.postedVersion ?? (d.status === 'deleted' ? d.restorableVersion : null);
  if (counted === null) return null;
  const versions = d.versions.filter((v: Json) => v.version <= counted);
  const last = versions[versions.length - 1];
  const payer = mainPayer(last);
  return {
    id: d.id,
    groupId: d.groupId,
    title: last.title,
    icon: ICONS.includes(last.category) ? last.category : 'other',
    date: d.date,
    payer: id(payer.memberId),
    versions: versions.map((v: Json) => ({
      n: v.version,
      total: BigInt(v.ledgerTotal),
      split: toSpec(v.split, id),
      by: id(v.createdBy),
      title: v.title,
      payer: id(mainPayer(v).memberId),
      at: v.createdAt,
    })),
    deleted: d.status === 'deleted',
    deletedBy: d.deletedBy ? id(d.deletedBy) : undefined,
    owners: (d.ownerIds ?? [d.createdBy]).map(id),
    disputes: d.disputes.map((x: Json) => ({ by: id(x.memberId), reason: x.reason })),
    messages: d.messages
      .filter((m: Json) => !m.deleted)
      .map((m: Json) => ({ id: m.id, by: id(m.authorId), kind: m.kind, text: m.body, at: m.createdAt, resolved: m.resolvedAt !== null })),
    canChat: d.canChat,
    receipts: (d.receipts ?? []).map((r: Json) => ({ id: r.id, by: id(r.uploadedBy), contentType: r.contentType, size: r.byteSize, at: r.createdAt })),
    suggestions: d.suggestions.map((s: Json) => ({
      id: s.id,
      by: id(s.authorId),
      total: BigInt(s.proposal.total),
      split: toSpec(s.proposal.split, id),
      reason: s.reason ?? '',
      baseVersion: s.baseVersion,
      status: s.status === 'withdrawn' ? 'declined' : s.status,
    })),
  };
}

/** The app shows one payer per expense: whoever paid the most in that version. */
const mainPayer = (v: Json): Json => [...v.payers].sort((a: Json, b: Json) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1))[0];

function toPayment(p: Json, groupId: string, id: (m: string) => string): Payment {
  return {
    id: p.id,
    groupId,
    from: id(p.from),
    to: id(p.to),
    amount: BigInt(p.amount),
    via: p.method === 'cash' ? 'cash' : 'upi',
    status: p.status === 'confirmed' || p.status === 'voided' ? p.status : p.status === 'awaiting_confirmation' ? 'awaiting' : 'declined',
    by: id(p.recordedBy),
    at: p.createdAt,
  };
}

/** The API's split, in the app's terms (member ids mapped, amounts as bigint). */
function toSpec(split: Json, id: (m: string) => string): SplitSpec {
  switch (split.method) {
    case 'equal':
      return { method: 'equal', members: split.members.map(id) };
    case 'shares':
      return { method: 'shares', shares: Object.fromEntries(split.shares.map((s: Json) => [id(s.memberId), Number(s.shares)])) };
    case 'exact':
      return { method: 'exact', amounts: Object.fromEntries(split.amounts.map((s: Json) => [id(s.memberId), BigInt(s.amount)])) };
    default:
      return { method: 'percent', basisPoints: Object.fromEntries(split.basisPoints.map((s: Json) => [id(s.memberId), s.basisPoints])) };
  }
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Sends one action to the API. The caller reloads afterwards; the API's answer is the truth. */
export async function perform(a: Action, r: Remote): Promise<void> {
  const groupOf = (expenseId: string) => r.state.expenses.find((e) => e.id === expenseId)?.groupId ?? '';
  const real = (groupId: string, memberId: string) => (memberId === ME ? r.me[groupId]! : memberId);
  const split = (groupId: string, spec: SplitSpec) =>
    spec.method === 'equal'
      ? { method: 'equal', members: spec.members.map((m) => real(groupId, m)) }
      : spec.method === 'exact'
        ? { method: 'exact', amounts: Object.entries(spec.amounts).filter(([, v]) => v > 0n).map(([m, v]) => ({ memberId: real(groupId, m), amount: v.toString() })) }
        : spec.method === 'percent'
          ? { method: 'percent', basisPoints: Object.entries(spec.basisPoints).filter(([, n]) => n > 0).map(([m, n]) => ({ memberId: real(groupId, m), basisPoints: n })) }
          : {
          method: 'shares',
          shares: Object.entries(spec.shares)
            .filter(([, n]) => n > 0)
            .map(([m, n]) => ({ memberId: real(groupId, m), shares: String(n) })),
        };
  const content = (groupId: string, x: { title: string; total: bigint; payer: string; split: SplitSpec }, meta?: ExpenseMeta, icon?: string) => ({
    title: x.title,
    notes: meta?.notes,
    category: icon ?? meta?.category,
    date: meta?.date ?? today(),
    currency: 'INR',
    total: x.total.toString(),
    payers: [{ memberId: real(groupId, x.payer), amount: x.total.toString() }],
    split: split(groupId, x.split),
  });
  const base = (expenseId: string) => r.meta[expenseId]!.currentVersion;

  switch (a.type) {
    case 'add_group':
      await api.send('POST', '/groups', { id: a.id, name: a.name, placeholders: a.memberNames });
      return;
    case 'rename_group':
      await api.send('PATCH', `/groups/${a.groupId}`, { name: a.name });
      return;
    case 'finish_group':
    case 'reopen_group':
      await api.send('POST', `/groups/${a.groupId}/${a.type === 'finish_group' ? 'finish' : 'reopen'}`);
      return;
    case 'make_owner':
      await api.send('POST', `/groups/${a.groupId}/members/${real(a.groupId, a.memberId)}/make-owner`);
      return;
    case 'add_expense':
      await api.send('POST', `/groups/${a.groupId}/expenses`, { id: a.id, ...content(a.groupId, a, undefined, a.icon) });
      return;
    case 'import_expense':
      await api.send('POST', `/groups/${a.groupId}/expenses`, {
        id: a.id,
        title: a.title,
        category: 'other',
        date: a.date,
        currency: 'INR',
        total: a.total.toString(),
        payers: [{ memberId: real(a.groupId, a.payer), amount: a.total.toString() }],
        split: { method: 'exact', amounts: Object.entries(a.shares).map(([m, v]) => ({ memberId: real(a.groupId, m), amount: v.toString() })) },
      });
      return;
    case 'edit_expense': {
      const g = groupOf(a.id);
      await api.send('PUT', `/expenses/${a.id}`, { ...content(g, a, r.meta[a.id]), baseVersion: base(a.id) });
      return;
    }
    case 'suggest': {
      const g = groupOf(a.id);
      const e = r.state.expenses.find((x) => x.id === a.id)!;
      const proposal = content(g, { title: e.title, total: a.total, payer: e.payer, split: a.split }, r.meta[a.id]);
      await api.send('POST', `/expenses/${a.id}/suggestions`, { baseVersion: base(a.id), proposal, reason: a.reason || undefined });
      return;
    }
    case 'decide':
      await (a.accept
        ? api.send('POST', `/suggestions/${a.suggestionId}/accept`)
        : api.send('POST', `/suggestions/${a.suggestionId}/decline`, { reason: 'Kept as it is' }));
      return;
    case 'post':
      await api.send('POST', `/expenses/${a.id}/messages`, { id: a.messageId, kind: a.question ? 'question' : 'text', body: a.text });
      return;
    case 'resolve':
      await api.send('POST', `/messages/${a.messageId}/resolve`);
      return;
    case 'pair_message':
      await api.send('POST', `/groups/${a.groupId}/pairs/${real(a.groupId, a.with)}/messages`, { id: a.messageId, body: a.text });
      return;
    case 'add_member':
      await api.send('POST', `/groups/${a.groupId}/members`, { id: a.memberId, displayName: a.name });
      return;
    case 'remove_member':
      await api.send('POST', `/groups/${a.groupId}/members/${real(a.groupId, a.memberId)}/remove`, { acknowledgeBalance: a.acknowledgeBalance });
      return;
    case 'leave_group':
      await api.send('POST', `/groups/${a.groupId}/leave`, { acknowledgeBalance: a.acknowledgeBalance });
      return;
    case 'set_role':
      await api.send('PATCH', `/groups/${a.groupId}/members/${real(a.groupId, a.memberId)}`, { role: a.role });
      return;
    case 'dispute':
      await api.send('POST', `/expenses/${a.id}/dispute`, { baseVersion: base(a.id), reason: a.reason });
      return;
    case 'withdraw_dispute':
      await api.send('POST', `/expenses/${a.id}/withdraw-dispute`);
      return;
    case 'delete':
    case 'restore':
      await api.send('POST', `/expenses/${a.id}/${a.type}`, { baseVersion: base(a.id) });
      return;
    case 'record_payment':
      await api.send('POST', `/groups/${a.groupId}/settlements`, {
        id: a.paymentId,
        from: real(a.groupId, a.from),
        to: real(a.groupId, a.to),
        amount: a.amount.toString(),
        method: a.via,
      });
      return;
    case 'add_receipt':
      // Uploaded on its own (uploadReceipt); this action only shows it before the reload.
      return;
    case 'remove_receipt':
      await api.send('POST', `/receipts/${a.receiptId}/delete`);
      return;
    case 'confirm_payment':
      await api.send('POST', `/settlements/${a.id}/confirm`);
      return;
    case 'decline_payment':
      await api.send('POST', `/settlements/${a.id}/decline`, { reason: 'Not received yet' });
      return;
    case 'void_payment':
      await api.send('POST', `/settlements/${a.id}/void`, { reason: 'Marked by mistake' });
      return;
    case 'withdraw_payment':
      await api.send('POST', `/settlements/${a.id}/withdraw`);
      return;
  }
}

export const fetchGroupIds = async (): Promise<string[]> => (await api.get('/groups')).groups.map((g: Json) => g.id as string);
export const fetchSnapshot = (groupId: string): Promise<Json> => api.get(`/groups/${groupId}/snapshot`);
/** groupId → a token that changes whenever anything this person can see in the group changes. */
export const fetchPulse = async (): Promise<Record<string, string>> => (await api.get('/pulse')).groups;

/** Seen marks on money items; the server ignores anything this person cannot see. */
export async function sendSeen(groupId: string, items: { type: 'expense' | 'settlement' | 'pair'; id: string; version?: number }[], r: Remote) {
  const real = (memberId: string) => (memberId === ME ? r.me[groupId]! : memberId);
  await api.send('POST', '/seen', { items: items.map((x) => ({ groupId, type: x.type, id: x.type === 'pair' ? real(x.id) : x.id, version: x.version })) });
}

/** Everything the signed-in user can see, one snapshot per group. */
export async function loadRemote(): Promise<Remote> {
  const ids = await fetchGroupIds();
  return buildRemote(await Promise.all(ids.map(fetchSnapshot)));
}

/** A group's snapshot, numbered by when its request started. */
export type Snap = { data: unknown; seq: number };
/**
 * A change shown before the server has it. `sentAt`: the request number when I made it. `base`: the
 * group's snapshot from before it (and before any of my other changes still unconfirmed there); null
 * for a group that had none. `doneAt`: the request number when the API answered. `reloaded`: the
 * reload after that has finished (the group may be gone, say after leaving it).
 */
export type Pending = { key: number; action: Action; group: string | undefined; sentAt: number; base?: Snap | null; doneAt?: number; reloaded?: boolean };

/** Confirmed: the API has answered, and a snapshot requested after that is in, so it shows the change (or its refusal). */
export function settled(p: Pending, snaps: Record<string, Snap>): boolean {
  if (p.doneAt === undefined) return false;
  if (!p.group) return true;
  const snap = snaps[p.group];
  return snap ? snap.seq > p.doneAt : !!p.reloaded;
}

/**
 * What the screens show: the snapshots, plus my unconfirmed changes on top. While a group has one, it
 * is drawn from the snapshot taken before them, with each of them applied, never from a newer one:
 * a reload that starts after the tap can still be answered before the server saves the change (a
 * live hint for something else, the /pulse check), and showing it would make the change vanish and
 * come back. It also can't show a change twice. The newest snapshot takes over once every change in
 * that group is confirmed.
 */
export function withPending(snaps: Record<string, Snap>, pending: Pending[], seenLocally: SeenMark[] = []): Remote {
  const view = { ...snaps };
  const apply: Pending[] = [];
  for (const g of new Set(pending.map((p) => p.group))) {
    const mine = pending.filter((p) => p.group === g);
    if (g === undefined) {
      apply.push(...mine.filter((p) => p.doneAt === undefined));
      continue;
    }
    const open = mine.find((p) => !settled(p, snaps));
    if (!open) continue;
    if (open.base === undefined) {
      // No snapshot recorded with it: the snapshot as it is, if it's from before the change.
      apply.push(...mine.filter((p) => !settled(p, snaps) && (snaps[g]?.seq ?? -1) < p.sentAt));
      continue;
    }
    if (open.base) view[g] = open.base;
    else delete view[g];
    const from = open.base?.seq ?? -1;
    apply.push(...mine.filter((p) => p.sentAt > from));
  }
  const base = buildRemote(Object.values(view).map((x) => x.data));
  let state = base.state;
  for (const p of apply.sort((a, b) => a.sentAt - b.sentAt)) state = reducer(state, p.action);
  // What I've looked at on this device counts as seen by me at once (the server records it too).
  if (seenLocally.length) {
    const mine = new Map(state.seen.filter((x) => x.by === ME).map((x) => [`${x.type}|${x.id}`, x]));
    for (const x of seenLocally) {
      const had = mine.get(`${x.type}|${x.id}`);
      if (!had || had.at < x.at) mine.set(`${x.type}|${x.id}`, x);
    }
    state = { ...state, seen: [...state.seen.filter((x) => x.by !== ME), ...mine.values()] };
  }
  return { ...base, state };
}
