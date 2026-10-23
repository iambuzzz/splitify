import { type SplitInput, breakdownExpense } from '@app/ledger';
import { assertCurrency } from '@app/money';
import {
  type ExpenseAction,
  type ExpenseState,
  type ReviewPolicy,
  canonicalize,
  eligibleReviewers,
  newDraft,
  transitionExpense,
  transitionSuggestion,
} from '@app/workflow';
import type { Router } from '../app';
import { type Membership, activeMember, activeMemberIds, membership, recordEvent, reviewPolicy, reviewerIds } from '../context';
import type { Tx } from '../db';
import { ApiError, notFound, workflowError } from '../errors';
import { uuidv7 } from '../ids';
import * as s from '../schemas';

interface ExpenseRow {
  id: string;
  group_id: string;
  created_by: string;
  kind: 'expense' | 'refund';
  status: 'draft' | 'in_review' | 'active' | 'deleted';
  current_version: number;
  posted_version: number | null;
  review_version: number | null;
  restorable_version: number | null;
  expense_date: string;
  created_at: Date;
  updated_at: Date;
}

interface Line {
  memberId: string;
  paid: string;
  owed: string;
}

interface Payer {
  memberId: string;
  amount: string;
}

interface VersionRow {
  version: number;
  title: string;
  notes: string | null;
  category: string | null;
  currency: string;
  original_total_minor: string;
  ledger_total_minor: string;
  rate: string | null;
  rate_source: string | null;
  split_method: string;
  split_input: s.SplitBody;
  payers: Payer[];
  created_by: string;
  created_at: Date;
  lines: Line[];
}

interface Loaded {
  e: ExpenseRow;
  m: Membership;
  versions: Map<number, VersionRow>;
  state: ExpenseState;
  policy: ReviewPolicy;
}

export function expenseRoutes(r: Router) {
  r.get('/groups/:groupId/expenses', async ({ tx, params }) => {
    const m = await membership(tx, params.groupId!);
    const rows = await tx.query<
      ExpenseRow & { title: string; category: string | null; currency: string; original_total_minor: string; ledger_total_minor: string; lines: Line[]; open_suggestions: number; open_questions: number; disputed: boolean }
    >(
      `select e.*, v.title, v.category, v.currency, v.original_total_minor, v.ledger_total_minor,
              ${LINES_JSON} as lines,
              (select count(*)::int from app.suggestions x where x.expense_id = e.id and x.status = 'open') as open_suggestions,
              (select count(*)::int from app.messages q
                where q.expense_id = e.id and q.kind = 'question' and q.resolved_at is null and q.deleted_at is null) as open_questions,
              exists (select 1 from app.disputes d where d.expense_id = e.id and d.closed_at is null) as disputed
         from app.expenses e
         join app.expense_versions v
           on v.expense_id = e.id and v.version = coalesce(e.posted_version, e.restorable_version, e.current_version)
        where e.group_id = $1 and (e.status <> 'draft' or e.created_by = $2)
        order by e.expense_date desc, e.created_at desc
        limit 500`,
      [m.group.id, m.memberId],
    );
    return {
      expenses: rows.rows.map((x) => ({
        id: x.id,
        kind: x.kind,
        status: x.status,
        counted: x.posted_version !== null,
        pendingChange: x.status === 'in_review' && x.posted_version !== null,
        date: x.expense_date,
        title: x.title,
        category: x.category,
        currency: x.currency,
        total: x.original_total_minor,
        ledgerTotal: x.ledger_total_minor,
        createdBy: x.created_by,
        lines: x.lines,
        openSuggestions: x.open_suggestions,
        openQuestions: x.open_questions,
        disputed: x.disputed,
      })),
    };
  });

  r.get('/expenses/:expenseId', async ({ tx, params }) => detail(tx, await load(tx, params.expenseId!, false)));

  r.mutate(
    'POST',
    '/groups/:groupId/expenses',
    s.createExpense,
    async ({ tx, params, body }) => {
      const m = await activeMember(tx, params.groupId!);
      const id = body.id ?? uuidv7();
      const content = normalize(body);
      checkMembers(content, await activeMemberIds(tx, m.group.id));
      const computed = compute(content, body.kind, id, m.group.currency);
      await tx.query(
        `insert into app.expenses (id, group_id, created_by, kind, status, current_version, expense_date)
         values ($1, $2, $3, $4, 'draft', 1, $5)`,
        [id, m.group.id, m.memberId, body.kind, content.date],
      );
      await writeVersion(tx, id, m.group.id, 1, content, computed, m.memberId);
      const draft = newDraft(unique([m.memberId, ...content.payers.map((p) => p.memberId)]), computed.ledgerTotal);
      let state = draft;
      let effects: unknown[] = [];
      if (!body.draft) {
        const affected = intersect(await reviewerIds(tx, m.group.id), computed.lines.map((l) => l.memberId));
        const result = transitionExpense(draft, { type: 'submit', baseVersion: 1 }, m.actor, { policy: reviewPolicy(m.group), affected });
        if (!result.ok) throw workflowError(result.error);
        state = result.state;
        effects = result.effects;
      }
      const e = await expenseRow(tx, id, true);
      await saveState(tx, e, state, m.memberId);
      await recordEvent(tx, { groupId: m.group.id, actor: m.memberId, entityType: 'expense', entityId: id, version: 1, type: 'expense.created', payload: { title: content.title, effects } });
      return detail(tx, await load(tx, id, false));
    },
    201,
  );

  r.mutate('PUT', '/expenses/:expenseId', s.editExpense, async ({ tx, params, body }) => {
    const x = await load(tx, params.expenseId!, true);
    const { baseVersion, ...content } = body;
    await applyEdit(tx, x, content, baseVersion);
    return detail(tx, await load(tx, x.e.id, false));
  });

  const action = <S extends import('zod').ZodType>(path: string, schema: S, toAction: (body: import('zod').output<S>) => ExpenseAction) =>
    r.mutate('POST', `/expenses/:expenseId/${path}`, schema, async ({ tx, params, body }) =>
      runAction(tx, params.expenseId!, toAction(body)),
    );

  action('submit', s.baseVersion, (b) => ({ type: 'submit', baseVersion: b.baseVersion }));
  action('approve', s.reviewDecision, (b) => ({ type: 'approve', version: b.version }));
  action('decline', s.reviewDecline, (b) => ({ type: 'decline', version: b.version, reason: b.reason }));
  action('withdraw-review', s.empty, () => ({ type: 'withdraw_review' }));
  action('delete', s.baseVersion, (b) => ({ type: 'delete', baseVersion: b.baseVersion }));
  action('restore', s.baseVersion, (b) => ({ type: 'restore', baseVersion: b.baseVersion }));
  action('dispute', s.dispute, (b) => ({ type: 'dispute', baseVersion: b.baseVersion, reason: b.reason }));
  action('withdraw-dispute', s.empty, () => ({ type: 'withdraw_dispute' }));

  // ---------- suggestions ----------

  r.mutate(
    'POST',
    '/expenses/:expenseId/suggestions',
    s.createSuggestion,
    async ({ tx, params, body }) => {
      const x = await load(tx, params.expenseId!, true);
      if (x.e.status === 'draft' || x.e.status === 'deleted') {
        throw new ApiError(409, 'invalid_state', 'You can suggest changes only to saved expenses');
      }
      if (body.baseVersion !== x.e.current_version) throw workflowError('stale_version');
      const content = normalize(body.proposal);
      checkMembers(content, await allowedMembers(tx, x));
      compute(content, x.e.kind, x.e.id, x.m.group.currency); // same checks as an edit
      const id = body.id ?? uuidv7();
      await tx.query(
        `insert into app.suggestions (id, expense_id, group_id, author_id, base_version, proposal, reason)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, x.e.id, x.e.group_id, x.m.memberId, body.baseVersion, JSON.stringify(content), body.reason ?? null],
      );
      await recordEvent(tx, { groupId: x.e.group_id, actor: x.m.memberId, entityType: 'suggestion', entityId: id, version: body.baseVersion, type: 'suggestion.created', payload: { expenseId: x.e.id } });
      return detail(tx, await load(tx, x.e.id, false));
    },
    201,
  );

  r.mutate('POST', '/suggestions/:suggestionId/accept', s.empty, async ({ tx, params }) => {
    const sg = await suggestion(tx, params.suggestionId!);
    const x = await load(tx, sg.expense_id, true);
    const result = transitionSuggestion(
      { status: sg.status, authorId: sg.author_id, baseVersion: sg.base_version },
      { type: 'accept' },
      x.m.actor,
      { expenseOwnerIds: x.state.ownerIds, currentExpenseVersion: x.state.version },
    );
    if (!result.ok) throw workflowError(result.error);
    // An accepted suggestion becomes the next version, written as an edit by the owner who accepted it.
    await tx.query(
      `update app.suggestions set status = 'accepted', decided_by = $2, decided_at = now(), applied_version = $3 where id = $1`,
      [sg.id, x.m.memberId, x.e.current_version + 1],
    );
    await applyEdit(tx, x, sg.proposal, sg.base_version, sg.id);
    return detail(tx, await load(tx, x.e.id, false));
  });

  r.mutate('POST', '/suggestions/:suggestionId/decline', s.withReason, async ({ tx, params, body }) =>
    closeSuggestion(tx, params.suggestionId!, { type: 'decline', reason: body.reason }),
  );
  r.mutate('POST', '/suggestions/:suggestionId/withdraw', s.empty, async ({ tx, params }) =>
    closeSuggestion(tx, params.suggestionId!, { type: 'withdraw' }),
  );

  // ---------- questions and comments on an expense ----------

  r.mutate(
    'POST',
    '/expenses/:expenseId/messages',
    s.postMessage,
    async ({ tx, params, body }) => {
      const x = await load(tx, params.expenseId!, true);
      if (!(await inExpense(tx, x.e.id))) throw new ApiError(403, 'not_in_expense', 'Only the people in this expense can talk about it');
      if (body.replyTo) {
        const target = await tx.query('select 1 from app.messages where id = $1 and expense_id = $2', [body.replyTo, x.e.id]);
        if (target.rows.length === 0) throw new ApiError(422, 'invalid_reference', 'You can reply only to a message in this thread');
      }
      const id = body.id ?? uuidv7();
      await tx.query(
        `insert into app.messages (id, group_id, author_id, kind, body, expense_id, reply_to) values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, x.e.group_id, x.m.memberId, body.kind, body.body, x.e.id, body.replyTo ?? null],
      );
      await recordEvent(tx, { groupId: x.e.group_id, actor: x.m.memberId, entityType: 'message', entityId: id, type: `message.${body.kind}`, payload: { expenseId: x.e.id } });
      return detail(tx, await load(tx, x.e.id, false));
    },
    201,
  );

  r.mutate('POST', '/messages/:messageId/resolve', s.empty, async ({ tx, params }) => {
    const q = await tx.query<{ id: string; author_id: string; kind: string; expense_id: string | null; resolved_at: Date | null }>(
      'select id, author_id, kind, expense_id, resolved_at from app.messages where id = $1 and deleted_at is null',
      [params.messageId],
    );
    const msg = q.rows[0];
    if (!msg || !msg.expense_id) throw notFound('Message not found');
    const x = await load(tx, msg.expense_id, true);
    if (msg.kind !== 'question') throw new ApiError(409, 'invalid_state', 'Only questions can be resolved');
    if (msg.author_id !== x.m.memberId && !x.state.ownerIds.includes(x.m.memberId)) {
      throw new ApiError(403, 'forbidden', 'Only the person who asked or the expense owner can resolve this');
    }
    if (!msg.resolved_at) {
      await tx.query('update app.messages set resolved_at = now(), resolved_by = $2 where id = $1', [msg.id, x.m.memberId]);
      await recordEvent(tx, { groupId: x.e.group_id, actor: x.m.memberId, entityType: 'message', entityId: msg.id, type: 'message.resolved', payload: { expenseId: x.e.id } });
    }
    return detail(tx, await load(tx, x.e.id, false));
  });
}

/** Full detail of one expense, as `GET /expenses/:id` returns it. */
export async function expenseDetail(tx: Tx, id: string) {
  return detail(tx, await load(tx, id, false));
}

const inExpense = async (tx: Tx, expenseId: string) =>
  (await tx.query<{ ok: boolean }>('select app.is_in_expense($1) as ok', [expenseId])).rows[0]!.ok;

// ---------- loading ----------

const LINES_JSON = `coalesce((select json_agg(json_build_object('memberId', l.member_id, 'paid', l.paid_minor::text, 'owed', l.owed_minor::text)
                                       order by l.member_id)
                            from app.expense_version_lines l where l.expense_id = v.expense_id and l.version = v.version), '[]'::json)`;

async function expenseRow(tx: Tx, id: string, lock: boolean): Promise<ExpenseRow> {
  const r = await tx.query<ExpenseRow>(`select * from app.expenses where id = $1${lock ? ' for update' : ''}`, [id]);
  if (!r.rows[0]) throw notFound('Expense not found');
  return r.rows[0];
}

/**
 * Loads an expense with everything the workflow needs. `change` requires a current member and
 * locks the row, so concurrent changes to one expense run one after another.
 */
async function load(tx: Tx, id: string, change: boolean): Promise<Loaded> {
  const first = await expenseRow(tx, id, false);
  const m = change ? await activeMember(tx, first.group_id) : await membership(tx, first.group_id);
  const e = change ? await expenseRow(tx, id, true) : first;
  // Drafts are private to whoever created them.
  if (e.status === 'draft' && e.created_by !== m.memberId) throw notFound('Expense not found');

  const v = await tx.query<VersionRow>(
    `select v.version, v.title, v.notes, v.category, v.currency, v.original_total_minor, v.ledger_total_minor, v.rate,
            v.rate_source, v.split_method, v.split_input, v.payers, v.created_by, v.created_at, ${LINES_JSON} as lines
       from app.expense_versions v where v.expense_id = $1 order by v.version`,
    [id],
  );
  const versions = new Map(v.rows.map((row) => [row.version, row]));
  const policy = reviewPolicy(m.group);
  return { e, m, versions, policy, state: await toState(tx, e, versions) };
}

/** Rebuilds the workflow state of an expense from its rows. */
async function toState(tx: Tx, e: ExpenseRow, versions: Map<number, VersionRow>): Promise<ExpenseState> {
  const disputes = await tx.query<{ member_id: string }>(
    'select member_id from app.disputes where expense_id = $1 and closed_at is null order by created_at',
    [e.id],
  );
  const approvals =
    e.review_version === null
      ? []
      : (
          await tx.query<{ member_id: string }>(
            `select member_id from app.review_decisions where expense_id = $1 and version = $2 and decision = 'approve' order by created_at`,
            [e.id, e.review_version],
          )
        ).rows.map((a) => a.member_id);
  return buildState(e, versions, disputes.rows.map((d) => d.member_id), approvals);
}

/** The workflow state from already-loaded rows: open disputes' members and the review's approvals. */
function buildState(e: ExpenseRow, versions: Map<number, VersionRow>, disputedBy: string[], approvals: string[]): ExpenseState {
  const current = versions.get(e.current_version)!;
  const counted = versions.get(e.posted_version ?? e.current_version)!;
  let review: ExpenseState['review'] = null;
  if (e.review_version !== null) {
    const reviewed = versions.get(e.review_version)!;
    review = {
      // In the database a pending edit is `in_review` with the old version still posted.
      kind: e.posted_version === null ? 'create' : 'edit',
      version: e.review_version,
      ledgerTotal: BigInt(reviewed.ledger_total_minor),
      authorId: reviewed.created_by,
      approvals,
    };
  }
  return {
    status: e.status === 'in_review' && e.posted_version !== null ? 'active' : e.status,
    version: e.current_version,
    postedVersion: e.posted_version,
    ledgerTotal: BigInt(counted.ledger_total_minor),
    // The creator, and whoever paid, may edit directly; everyone else suggests.
    ownerIds: unique([e.created_by, ...current.lines.filter((l) => l.paid !== '0').map((l) => l.memberId)]),
    disputedBy,
    review,
    restorableVersion: e.restorable_version,
  };
}

/**
 * Signed-up current members whose share or payment this expense touches, in any version that
 * matters now: the people who may review or dispute it.
 */
async function affectedMembers(tx: Tx, x: Loaded, extra: readonly string[] = [], leaving?: string): Promise<string[]> {
  const active = await reviewerIds(tx, x.e.group_id);
  if (leaving) active.delete(leaving);
  return affectedAmong(x, active, extra);
}

function affectedAmong(x: Pick<Loaded, 'e' | 'versions'>, reviewers: Set<string>, extra: readonly string[] = []): string[] {
  const ids = new Set(extra);
  for (const v of [x.e.posted_version, x.e.current_version, x.e.review_version]) {
    if (v !== null) for (const l of x.versions.get(v)!.lines) ids.add(l.memberId);
  }
  return intersect(reviewers, [...ids]);
}

/** Who may appear in an edit: current members, plus anyone already in the expense (they may have left). */
async function allowedMembers(tx: Tx, x: Loaded): Promise<Set<string>> {
  const allowed = await activeMemberIds(tx, x.e.group_id);
  for (const l of x.versions.get(x.e.current_version)!.lines) allowed.add(l.memberId);
  return allowed;
}

async function suggestion(tx: Tx, id: string) {
  const r = await tx.query<{ id: string; expense_id: string; author_id: string; base_version: number; status: 'open' | 'accepted' | 'declined' | 'withdrawn' | 'outdated'; proposal: s.ExpenseContent }>(
    'select id, expense_id, author_id, base_version, status, proposal from app.suggestions where id = $1',
    [id],
  );
  if (!r.rows[0]) throw notFound('Suggestion not found');
  return r.rows[0];
}

// ---------- changing ----------

async function runAction(tx: Tx, id: string, action: ExpenseAction) {
  const x = await load(tx, id, true);
  const result = transitionExpense(x.state, action, x.m.actor, { policy: x.policy, affected: await affectedMembers(tx, x) });
  if (!result.ok) throw workflowError(result.error);
  if (!result.duplicate) {
    switch (action.type) {
      case 'approve':
      case 'decline':
        await tx.query(
          `insert into app.review_decisions (expense_id, group_id, version, member_id, decision, reason) values ($1, $2, $3, $4, $5, $6)`,
          [x.e.id, x.e.group_id, action.version, x.m.memberId, action.type, action.type === 'decline' ? action.reason : null],
        );
        break;
      case 'dispute':
        await tx.query('insert into app.disputes (expense_id, group_id, member_id, reason) values ($1, $2, $3, $4)', [
          x.e.id,
          x.e.group_id,
          x.m.memberId,
          action.reason,
        ]);
        break;
      case 'withdraw_dispute':
        await tx.query(
          `update app.disputes set closed_at = now(), close_reason = 'withdrawn' where expense_id = $1 and member_id = $2 and closed_at is null`,
          [x.e.id, x.m.memberId],
        );
        break;
    }
    await saveState(tx, x.e, result.state, x.m.memberId);
    await recordEvent(tx, {
      groupId: x.e.group_id,
      actor: x.m.memberId,
      entityType: 'expense',
      entityId: x.e.id,
      version: result.state.version,
      type: `expense.${action.type}`,
      payload: { effects: result.effects },
    });
  }
  return detail(tx, await load(tx, id, false));
}

async function applyEdit(tx: Tx, x: Loaded, raw: s.ExpenseContent, baseVersion: number, suggestionId?: string) {
  const content = normalize(raw);
  checkMembers(content, await allowedMembers(tx, x));
  const computed = compute(content, x.e.kind, x.e.id, x.m.group.currency);
  const current = x.versions.get(x.e.current_version)!;
  const material = fingerprint(content) !== fingerprint(fromRow(current));
  const affected = await affectedMembers(tx, x, computed.lines.map((l) => l.memberId));
  const result = transitionExpense(
    x.state,
    { type: 'edit', baseVersion, material, ledgerTotal: computed.ledgerTotal },
    x.m.actor,
    { policy: x.policy, affected },
  );
  if (!result.ok) throw workflowError(result.error);
  await writeVersion(tx, x.e.id, x.e.group_id, result.state.version, content, computed, x.m.memberId);
  if (content.date !== x.e.expense_date) {
    await tx.query('update app.expenses set expense_date = $2 where id = $1', [x.e.id, content.date]);
  }
  await saveState(tx, x.e, result.state, x.m.memberId);
  await recordEvent(tx, {
    groupId: x.e.group_id,
    actor: x.m.memberId,
    entityType: 'expense',
    entityId: x.e.id,
    version: result.state.version,
    type: 'expense.edited',
    payload: { material, effects: result.effects, suggestionId: suggestionId ?? null },
  });
}

/**
 * Stores a workflow state. The ledger follows `posted_version` by itself at commit (database
 * triggers), so "post" and "reverse" effects need no code here.
 *
 * An active expense always shows the version that counts (`posted_version = current_version`).
 * When the workflow keeps an older version counted while newer ones exist:
 * - the newer versions changed only title or notes → the newest one counts (same money);
 * - otherwise (a declined or withdrawn change) → the counted version is saved again as the newest,
 *   so history reads "changed, then changed back".
 */
async function saveState(tx: Tx, e: ExpenseRow, state: ExpenseState, actor: string): Promise<void> {
  const status = state.review ? 'in_review' : state.status;
  let current = state.version;
  let posted = state.postedVersion;
  if (status === 'active' && posted !== null && posted !== current) {
    const v = await tx.query<VersionRow>(
      `select version, currency, original_total_minor, rate, split_input, payers from app.expense_versions
        where expense_id = $1 and version between $2 and $3 order by version`,
      [e.id, posted, current],
    );
    const base = fingerprint(fromRow(v.rows[0]!));
    if (v.rows.every((row) => fingerprint(fromRow(row)) === base)) {
      posted = current;
    } else {
      current += 1;
      await copyVersion(tx, e.id, posted, current, actor);
      posted = current;
    }
  }
  await tx.query(
    `update app.expenses set status = $2, current_version = $3, posted_version = $4, review_version = $5, restorable_version = $6
      where id = $1`,
    [e.id, status, current, posted, state.review?.version ?? null, state.restorableVersion],
  );
  // A suggestion written against an older version can no longer be accepted as it is.
  await tx.query(
    `update app.suggestions set status = 'outdated', decided_at = now()
      where expense_id = $1 and status = 'open' and base_version <> $2`,
    [e.id, current],
  );
  // Disputes end when the money changes or the expense is deleted.
  await tx.query(
    `update app.disputes set closed_at = now(), close_reason = 'resolved'
      where expense_id = $1 and closed_at is null and not (member_id = any($2::uuid[]))`,
    [e.id, state.disputedBy],
  );
}

async function closeSuggestion(tx: Tx, id: string, action: { type: 'decline'; reason: string } | { type: 'withdraw' }) {
  const sg = await suggestion(tx, id);
  const x = await load(tx, sg.expense_id, true);
  const result = transitionSuggestion(
    { status: sg.status, authorId: sg.author_id, baseVersion: sg.base_version },
    action,
    x.m.actor,
    { expenseOwnerIds: x.state.ownerIds, currentExpenseVersion: x.state.version },
  );
  if (!result.ok) throw workflowError(result.error);
  await tx.query(
    `update app.suggestions set status = $2, decided_by = $3, decided_at = now(), decline_reason = $4 where id = $1`,
    [sg.id, result.state.status, x.m.memberId, action.type === 'decline' ? action.reason : null],
  );
  await recordEvent(tx, { groupId: x.e.group_id, actor: x.m.memberId, entityType: 'suggestion', entityId: sg.id, type: `suggestion.${result.state.status}`, payload: { expenseId: x.e.id } });
  return detail(tx, await load(tx, x.e.id, false));
}

/**
 * Called before someone leaves or is removed: reviews that were waiting on them may now have
 * every OK they can get.
 */
export async function reevaluateReviews(tx: Tx, m: Membership, leaving: string): Promise<void> {
  const pending = await tx.query<{ id: string }>(
    `select id from app.expenses where group_id = $1 and status = 'in_review' order by id`,
    [m.group.id],
  );
  for (const { id } of pending.rows) {
    const x = await load(tx, id, true);
    const affected = await affectedMembers(tx, x, [], leaving);
    const result = transitionExpense(x.state, { type: 'reevaluate_review' }, m.actor, { policy: x.policy, affected });
    if (!result.ok || result.effects.length === 0) continue;
    await saveState(tx, x.e, result.state, m.memberId);
    await recordEvent(tx, { groupId: m.group.id, actor: m.memberId, entityType: 'expense', entityId: id, version: result.state.version, type: 'expense.review_passed', payload: { effects: result.effects } });
  }
}

// ---------- versions ----------

interface Computed {
  ledgerTotal: bigint;
  rate: string | null;
  lines: { memberId: string; paid: bigint; owed: bigint }[];
}

/** Sorted, so that the same expense entered twice compares equal. */
function normalize(c: s.ExpenseContent): s.ExpenseContent {
  const byMember = <T extends { memberId: string }>(rows: readonly T[]) => [...rows].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
  const split: s.SplitBody =
    c.split.method === 'equal'
      ? { method: 'equal', members: unique(c.split.members).sort() }
      : c.split.method === 'exact'
        ? { method: 'exact', amounts: byMember(c.split.amounts) }
        : c.split.method === 'percent'
          ? { method: 'percent', basisPoints: byMember(c.split.basisPoints) }
          : { method: 'shares', shares: byMember(c.split.shares) };
  return {
    title: c.title,
    notes: c.notes || undefined,
    category: c.category || undefined,
    date: c.date,
    currency: c.currency,
    total: c.total,
    rate: c.rate,
    rateSource: c.rateSource,
    payers: byMember(c.payers),
    split,
  };
}

function splitMembers(split: s.SplitBody): string[] {
  switch (split.method) {
    case 'equal':
      return [...split.members];
    case 'exact':
      return split.amounts.map((a) => a.memberId);
    case 'percent':
      return split.basisPoints.map((a) => a.memberId);
    case 'shares':
      return split.shares.map((a) => a.memberId);
  }
}

function checkMembers(c: s.ExpenseContent, allowed: Set<string>) {
  const unknown = [...c.payers.map((p) => p.memberId), ...splitMembers(c.split)].filter((id) => !allowed.has(id));
  if (unknown.length > 0) {
    throw new ApiError(422, 'unknown_member', 'Someone in this expense is not in the group', { members: unique(unknown) });
  }
}

function toSplit(split: s.SplitBody): SplitInput {
  return split.method === 'exact'
    ? { method: 'exact', amounts: split.amounts.map((a) => ({ memberId: a.memberId, amount: BigInt(a.amount) })) }
    : split;
}

/** Runs the money engine: converts to the group currency and works out who paid and owes what. */
function compute(c: s.ExpenseContent, kind: 'expense' | 'refund', expenseId: string, groupCurrency: string): Computed {
  const foreign = c.currency !== groupCurrency;
  const b = breakdownExpense(
    {
      expenseId,
      kind,
      currency: assertCurrency(c.currency),
      total: BigInt(c.total),
      payers: c.payers.map((p) => ({ memberId: p.memberId, amount: BigInt(p.amount) })),
      split: toSplit(c.split),
      rate: foreign ? c.rate : undefined,
    },
    assertCurrency(groupCurrency),
  );
  const lines = new Map<string, { paid: bigint; owed: bigint }>();
  for (const p of b.payers) lines.set(p.memberId, { paid: p.amount, owed: 0n });
  for (const sh of b.shares) lines.set(sh.memberId, { paid: lines.get(sh.memberId)?.paid ?? 0n, owed: sh.amount });
  return {
    ledgerTotal: b.ledgerTotal,
    rate: foreign ? c.rate! : null,
    // A tiny total can give someone a zero share; a line with nothing paid and nothing owed is not stored.
    lines: [...lines].filter(([, l]) => l.paid !== 0n || l.owed !== 0n).map(([memberId, l]) => ({ memberId, ...l })),
  };
}

async function writeVersion(tx: Tx, expenseId: string, groupId: string, version: number, c: s.ExpenseContent, computed: Computed, actor: string) {
  await tx.query(
    `insert into app.expense_versions (expense_id, version, group_id, title, notes, category, currency, original_total_minor,
       rate, rate_source, rate_at, ledger_total_minor, split_method, split_input, payers, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, case when $9::numeric is null then null else now() end, $11, $12, $13, $14, $15)`,
    [
      expenseId,
      version,
      groupId,
      c.title,
      c.notes ?? null,
      c.category ?? null,
      c.currency,
      c.total,
      computed.rate,
      computed.rate === null ? null : (c.rateSource ?? 'manual'),
      computed.ledgerTotal.toString(),
      c.split.method,
      JSON.stringify(c.split),
      JSON.stringify(c.payers),
      actor,
    ],
  );
  await tx.query(
    `insert into app.expense_version_lines (expense_id, version, group_id, member_id, paid_minor, owed_minor)
     select $1, $2, $3, (x->>'memberId')::uuid, (x->>'paid')::bigint, (x->>'owed')::bigint
       from jsonb_array_elements($4::jsonb) x`,
    [
      expenseId,
      version,
      groupId,
      JSON.stringify(computed.lines.map((l) => ({ memberId: l.memberId, paid: l.paid.toString(), owed: l.owed.toString() }))),
    ],
  );
}

async function copyVersion(tx: Tx, expenseId: string, from: number, to: number, actor: string) {
  await tx.query(
    `insert into app.expense_versions (expense_id, version, group_id, title, notes, category, currency, original_total_minor,
       rate, rate_source, rate_at, ledger_total_minor, split_method, split_input, payers, created_by)
     select expense_id, $3, group_id, title, notes, category, currency, original_total_minor,
            rate, rate_source, rate_at, ledger_total_minor, split_method, split_input, payers, $4
       from app.expense_versions where expense_id = $1 and version = $2`,
    [expenseId, from, to, actor],
  );
  await tx.query(
    `insert into app.expense_version_lines (expense_id, version, group_id, member_id, paid_minor, owed_minor)
     select expense_id, $3, group_id, member_id, paid_minor, owed_minor
       from app.expense_version_lines where expense_id = $1 and version = $2`,
    [expenseId, from, to],
  );
}

type Money = Pick<s.ExpenseContent, 'currency' | 'total' | 'rate' | 'payers' | 'split'>;

function fromRow(v: Pick<VersionRow, 'currency' | 'original_total_minor' | 'rate' | 'payers' | 'split_input'>): Money {
  return { currency: v.currency, total: v.original_total_minor, rate: v.rate ?? undefined, payers: v.payers, split: v.split_input };
}

/** The material content of a version (amount, currency, rate, who paid, who shares and how). */
function fingerprint(c: Money): string {
  return canonicalize({ currency: c.currency, total: c.total, rate: normalRate(c.rate), payers: c.payers, split: c.split });
}

/** "83.1200000000" (numeric from the database) and "83.12" are the same rate. */
function normalRate(rate: string | undefined): string | null {
  if (!rate) return null;
  const [whole = '0', fraction = ''] = rate.split('.');
  const f = fraction.replace(/0+$/, '');
  return `${whole.replace(/^0+(?=\d)/, '')}${f ? `.${f}` : ''}`;
}

// ---------- response ----------

type DisputeRow = { id: string; member_id: string; reason: string; created_at: Date };
type SuggestionRow = { id: string; author_id: string; base_version: number; proposal: unknown; reason: string | null; status: string; decided_by: string | null; decided_at: Date | null; decline_reason: string | null; applied_version: number | null; created_at: Date };
type MessageRow = { id: string; author_id: string; kind: string; body: string; reply_to: string | null; resolved_at: Date | null; resolved_by: string | null; edited_at: Date | null; deleted_at: Date | null; created_at: Date };
type SeenRow = { member_id: string; version: number | null; seen_at: Date };
/** What an expense's detail shows besides its own rows. */
interface DetailRows {
  disputes: DisputeRow[];
  suggestions: SuggestionRow[];
  messages: MessageRow[];
  seen: SeenRow[];
  inExpense: boolean;
  /** Signed-up current members (who may review). */
  reviewers: Set<string>;
}

const SUGGESTION_COLUMNS = 'id, author_id, base_version, proposal, reason, status, decided_by, decided_at, decline_reason, applied_version, created_at';
const MESSAGE_COLUMNS = `id, author_id, kind, case when deleted_at is null then body else '' end as body, reply_to, resolved_at, resolved_by,
            edited_at, deleted_at, created_at`;

async function detail(tx: Tx, x: Loaded) {
  const { e } = x;
  // One transaction is one connection: its queries run one after another.
  const disputes = await tx.query<DisputeRow>(
    'select id, member_id, reason, created_at from app.disputes where expense_id = $1 and closed_at is null order by created_at',
    [e.id],
  );
  const suggestions = await tx.query<SuggestionRow>(`select ${SUGGESTION_COLUMNS} from app.suggestions where expense_id = $1 order by created_at desc`, [e.id]);
  const messages = await tx.query<MessageRow>(`select ${MESSAGE_COLUMNS} from app.messages where expense_id = $1 order by created_at, id`, [e.id]);
  const seen = await tx.query<SeenRow>(`select member_id, version, seen_at from app.seen where entity_type = 'expense' and entity_id = $1 order by seen_at`, [e.id]);
  return render(x, {
    disputes: disputes.rows,
    suggestions: suggestions.rows,
    messages: messages.rows,
    seen: seen.rows,
    inExpense: await inExpense(tx, e.id),
    reviewers: x.state.review ? await reviewerIds(tx, e.group_id) : new Set(),
  });
}

/**
 * Every expense of a group in full, in a fixed handful of queries however many there are (the
 * group screen loads them all at once; one query per expense made it slow over a real network).
 */
export async function expenseDetails(tx: Tx, m: Membership, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await tx.query<ExpenseRow>('select * from app.expenses where id = any ($1::uuid[])', [ids]);
  const versions = await tx.query<VersionRow & { expense_id: string }>(
    `select v.expense_id, v.version, v.title, v.notes, v.category, v.currency, v.original_total_minor, v.ledger_total_minor, v.rate,
            v.rate_source, v.split_method, v.split_input, v.payers, v.created_by, v.created_at, ${LINES_JSON} as lines
       from app.expense_versions v where v.expense_id = any ($1::uuid[]) order by v.expense_id, v.version`,
    [ids],
  );
  const disputes = await tx.query<DisputeRow & { expense_id: string }>(
    'select id, expense_id, member_id, reason, created_at from app.disputes where expense_id = any ($1::uuid[]) and closed_at is null order by created_at',
    [ids],
  );
  const approvals = await tx.query<{ expense_id: string; version: number; member_id: string }>(
    `select expense_id, version, member_id from app.review_decisions where expense_id = any ($1::uuid[]) and decision = 'approve' order by created_at`,
    [ids],
  );
  const suggestions = await tx.query<SuggestionRow & { expense_id: string }>(
    `select expense_id, ${SUGGESTION_COLUMNS} from app.suggestions where expense_id = any ($1::uuid[]) order by created_at desc`,
    [ids],
  );
  // RLS leaves out the threads of expenses I'm not in.
  const messages = await tx.query<MessageRow & { expense_id: string }>(
    `select expense_id, ${MESSAGE_COLUMNS} from app.messages where expense_id = any ($1::uuid[]) order by created_at, id`,
    [ids],
  );
  const seen = await tx.query<SeenRow & { entity_id: string }>(
    `select entity_id, member_id, version, seen_at from app.seen where entity_type = 'expense' and entity_id = any ($1::uuid[]) order by seen_at`,
    [ids],
  );
  const inExp = await tx.query<{ id: string; ok: boolean }>('select id, app.is_in_expense(id) as ok from unnest ($1::uuid[]) as id', [ids]);
  const reviewers = await reviewerIds(tx, m.group.id);

  const by = <T, K extends keyof T>(list: T[], key: K) => {
    const out = new Map<T[K], T[]>();
    for (const row of list) out.set(row[key], [...(out.get(row[key]) ?? []), row]);
    return out;
  };
  const versionsOf = by(versions.rows, 'expense_id');
  const disputesOf = by(disputes.rows, 'expense_id');
  const approvalsOf = by(approvals.rows, 'expense_id');
  const suggestionsOf = by(suggestions.rows, 'expense_id');
  const messagesOf = by(messages.rows, 'expense_id');
  const seenOf = by(seen.rows, 'entity_id');
  const inExpense = new Map(inExp.rows.map((r) => [r.id, r.ok]));
  const policy = reviewPolicy(m.group);
  const byId = new Map(rows.rows.map((e) => [e.id, e]));

  return ids.flatMap((id) => {
    const e = byId.get(id);
    // Drafts are private to whoever created them.
    if (!e || (e.status === 'draft' && e.created_by !== m.memberId)) return [];
    const v = new Map((versionsOf.get(id) ?? []).map(({ expense_id: _, ...row }) => [row.version, row as VersionRow]));
    const openDisputes = disputesOf.get(id) ?? [];
    const approved = (approvalsOf.get(id) ?? []).filter((a) => a.version === e.review_version).map((a) => a.member_id);
    const state = buildState(e, v, openDisputes.map((d) => d.member_id), approved);
    return [
      render(
        { e, m, versions: v, policy, state },
        {
          disputes: openDisputes,
          suggestions: suggestionsOf.get(id) ?? [],
          messages: messagesOf.get(id) ?? [],
          seen: seenOf.get(id) ?? [],
          inExpense: inExpense.get(id) ?? false,
          reviewers,
        },
      ),
    ];
  });
}

/** An expense's detail from its loaded rows (no queries). */
function render(x: Loaded, d: DetailRows) {
  const { e, m } = x;
  let review = null;
  if (x.state.review) {
    const eligible = eligibleReviewers(affectedAmong(x, d.reviewers), x.state.review.authorId);
    review = {
      kind: x.state.review.kind,
      version: x.state.review.version,
      authorId: x.state.review.authorId,
      approvals: x.state.review.approvals,
      eligible,
      required: Math.min(x.policy.approvalsRequired, eligible.length),
    };
  }

  return {
    id: e.id,
    groupId: e.group_id,
    kind: e.kind,
    status: e.status,
    date: e.expense_date,
    createdBy: e.created_by,
    createdAt: e.created_at,
    currentVersion: e.current_version,
    /** The version that counts in balances; null when nothing counts (draft, new expense in review, deleted). */
    postedVersion: e.posted_version,
    restorableVersion: e.restorable_version,
    ownerIds: x.state.ownerIds,
    canEdit: m.status === 'active' && x.state.ownerIds.includes(m.memberId),
    review,
    disputes: d.disputes.map((d) => ({ id: d.id, memberId: d.member_id, reason: d.reason, createdAt: d.created_at })),
    versions: [...x.versions.values()].map((v) => ({
      version: v.version,
      title: v.title,
      notes: v.notes,
      category: v.category,
      currency: v.currency,
      total: v.original_total_minor,
      ledgerTotal: v.ledger_total_minor,
      rate: v.rate === null ? null : normalRate(v.rate),
      rateSource: v.rate_source,
      split: v.split_input,
      payers: v.payers,
      lines: v.lines,
      createdBy: v.created_by,
      createdAt: v.created_at,
    })),
    suggestions: d.suggestions.map((g) => ({
      id: g.id,
      authorId: g.author_id,
      baseVersion: g.base_version,
      proposal: g.proposal,
      reason: g.reason,
      status: g.status,
      decidedBy: g.decided_by,
      decidedAt: g.decided_at,
      declineReason: g.decline_reason,
      appliedVersion: g.applied_version,
      createdAt: g.created_at,
    })),
    messages: d.messages.map((q) => ({
      id: q.id,
      authorId: q.author_id,
      kind: q.kind,
      body: q.body,
      replyTo: q.reply_to,
      resolvedAt: q.resolved_at,
      resolvedBy: q.resolved_by,
      editedAt: q.edited_at,
      deleted: q.deleted_at !== null,
      createdAt: q.created_at,
    })),
    /** Only the people in the expense can read and write its thread (I11 for conversation). */
    canChat: m.status === 'active' && d.inExpense,
    seen: d.seen.map((s) => ({ memberId: s.member_id, version: s.version, seenAt: s.seen_at })),
  };
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function intersect(set: Set<string>, items: readonly string[]): string[] {
  return unique(items.filter((id) => set.has(id)));
}
