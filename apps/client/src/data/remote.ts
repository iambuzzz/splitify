import { api } from './api';
import { type Action, type Expense, type ExpenseIcon, type Group, type Payment, type SeenMark, type SplitSpec, type State, ME, pairKey, reducer } from './model';

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
  /** groupId → my member id there. */
  me: Record<string, string>;
  meta: Record<string, ExpenseMeta>;
}

const ICONS: ExpenseIcon[] = ['hotel', 'food', 'taxi', 'home', 'wifi', 'cart', 'other'];
const KINDS: Group['kind'][] = ['trip', 'home', 'food'];

export const emptyRemote = (): Remote => ({
  state: { members: {}, groups: [], roster: {}, expenses: [], payments: [], pairMessages: [], seen: [], nextId: 1 },
  me: {},
  meta: {},
});

export function buildRemote(snapshots: Json[]): Remote {
  const out = emptyRemote();
  for (const snap of snapshots) {
    const groupId: string = snap.group.id;
    const myId: string = snap.me.memberId;
    out.me[groupId] = myId;
    const id = (memberId: string) => (memberId === myId ? ME : memberId);

    for (const m of snap.members) out.state.members[id(m.id)] = { id: id(m.id), name: m.displayName };
    out.state.groups.push({
      id: groupId,
      name: snap.group.name,
      kind: KINDS.includes(snap.group.kind) ? snap.group.kind : 'trip',
      members: snap.members.filter((m: Json) => m.status === 'active').map((m: Json) => id(m.id)),
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
  const payer = [...last.payers].sort((a: Json, b: Json) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1))[0];
  return {
    id: d.id,
    groupId: d.groupId,
    title: last.title,
    icon: ICONS.includes(last.category) ? last.category : 'other',
    date: d.date,
    payer: id(payer.memberId),
    versions: versions.map((v: Json) => ({ n: v.version, total: BigInt(v.ledgerTotal), split: toSpec(v.split, id), by: id(v.createdBy) })),
    deleted: d.status === 'deleted',
    disputes: d.disputes.map((x: Json) => ({ by: id(x.memberId), reason: x.reason })),
    messages: d.messages
      .filter((m: Json) => !m.deleted)
      .map((m: Json) => ({ id: m.id, by: id(m.authorId), kind: m.kind, text: m.body, at: m.createdAt, resolved: m.resolvedAt !== null })),
    canChat: d.canChat,
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

function toPayment(p: Json, groupId: string, id: (m: string) => string): Payment {
  return {
    id: p.id,
    groupId,
    from: id(p.from),
    to: id(p.to),
    amount: BigInt(p.amount),
    via: p.method === 'cash' ? 'cash' : 'upi',
    status: p.status === 'confirmed' ? 'confirmed' : p.status === 'awaiting_confirmation' ? 'awaiting' : 'declined',
  };
}

/** The app edits splits as equal or shares; exact and percent splits (from elsewhere) show as shares. */
function toSpec(split: Json, id: (m: string) => string): SplitSpec {
  switch (split.method) {
    case 'equal':
      return { method: 'equal', members: split.members.map(id) };
    case 'shares':
      return { method: 'shares', shares: Object.fromEntries(split.shares.map((s: Json) => [id(s.memberId), Number(s.shares)])) };
    case 'exact':
      return { method: 'shares', shares: Object.fromEntries(split.amounts.map((s: Json) => [id(s.memberId), Number(s.amount)])) };
    default:
      return { method: 'shares', shares: Object.fromEntries(split.basisPoints.map((s: Json) => [id(s.memberId), s.basisPoints])) };
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
      await api.send('POST', '/groups', { id: a.id, name: a.name, kind: a.kind, placeholders: a.memberNames });
      return;
    case 'add_expense':
      await api.send('POST', `/groups/${a.groupId}/expenses`, { id: a.id, ...content(a.groupId, a, undefined, a.icon) });
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
        from: real(a.groupId, a.from),
        to: real(a.groupId, a.to),
        amount: a.amount.toString(),
        method: a.via,
      });
      return;
    case 'confirm_payment':
      await api.send('POST', `/settlements/${a.id}/confirm`);
      return;
    case 'decline_payment':
      await api.send('POST', `/settlements/${a.id}/decline`, { reason: 'Not received yet' });
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
/** A change shown before the server has it. `sentAt`: the request number when I made it. */
export type Pending = { key: number; action: Action; group: string | undefined; sentAt: number };

/**
 * What the screens show: the snapshots, plus each of my unsaved changes on top of a snapshot that was
 * requested before I made it (so an older reply arriving late can't undo it on screen). A snapshot
 * requested after I made it is the server's word: it may already include the change (the live hint
 * often beats the API's reply), and adding it again would show it twice.
 */
export function withPending(snaps: Record<string, Snap>, pending: Pending[], seenLocally: SeenMark[] = []): Remote {
  const base = buildRemote(Object.values(snaps).map((x) => x.data));
  let state = base.state;
  for (const p of pending) if (!p.group || (snaps[p.group]?.seq ?? -1) < p.sentAt) state = reducer(state, p.action);
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
