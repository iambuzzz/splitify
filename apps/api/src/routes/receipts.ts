import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Router } from '../app';
import { activeMember, isAdmin, recordEvent } from '../context';
import type { Db, Tx } from '../db';
import { ApiError, notFound } from '../errors';
import { type ReceiptStore, receiptKey, sniffType } from '../receipts-store';

/** Photos are shrunk in the app before upload; PDFs come as they are. */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const MAX_PER_EXPENSE = 20;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
const PATH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uploadQuery = z.object({
  id: z.uuid(),
  width: z.coerce.number().int().min(1).max(20000).optional(),
  height: z.coerce.number().int().min(1).max(20000).optional(),
});

export interface ReceiptRow {
  id: string;
  uploaded_by: string;
  content_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  created_at: Date;
}
export const RECEIPT_COLUMNS = 'id, uploaded_by, content_type, byte_size, width, height, created_at';

export const receiptJson = (r: ReceiptRow) => ({
  id: r.id,
  uploadedBy: r.uploaded_by,
  contentType: r.content_type,
  byteSize: r.byte_size,
  width: r.width,
  height: r.height,
  createdAt: r.created_at,
});

/**
 * Whether the receipts table exists yet. A database that hasn't had the receipts migration (for
 * example the shared dev project while this is being built) then still works: expenses just show no
 * receipts. Checked once per process; restart the API after applying the migration.
 */
let tableExists: Promise<boolean> | undefined;
export function hasReceiptsTable(tx: Tx): Promise<boolean> {
  tableExists ??= tx.query<{ ok: boolean }>(`select to_regclass('app.receipts') is not null as ok`).then((r) => r.rows[0]!.ok);
  tableExists.catch(() => (tableExists = undefined));
  return tableExists;
}

const notConfigured = () => new ApiError(503, 'receipts_not_configured', 'Adding photos is not set up on this server yet');

/** The expense (if I can see it) with who may manage its receipts. */
async function expenseFor(tx: Tx, expenseId: string) {
  const r = await tx.query<{ group_id: string; created_by: string; payers: { memberId: string }[]; title: string }>(
    `select e.group_id, e.created_by, v.payers, v.title
       from app.expenses e join app.expense_versions v on v.expense_id = e.id and v.version = e.current_version
      where e.id = $1`,
    [expenseId],
  );
  const row = r.rows[0];
  if (!row) throw notFound('Expense not found');
  return row;
}

/**
 * Upload and download are raw routes (the body and the answer are the file itself, not JSON), so
 * they sit beside the JSON router. Uploads are idempotent by the receipt id the app picks.
 */
export function receiptFileRoutes(scope: FastifyInstance, db: Db, store: ReceiptStore | undefined) {
  scope.register(async (r) => {
    r.addContentTypeParser([...TYPES], { parseAs: 'buffer', bodyLimit: MAX_RECEIPT_BYTES }, (_req, body, done) => done(null, body));

    r.post('/v1/expenses/:expenseId/receipts', { bodyLimit: MAX_RECEIPT_BYTES }, async (req, reply) => {
      if (!store) throw notConfigured();
      const { expenseId } = req.params as { expenseId: string };
      if (!PATH_ID.test(expenseId)) throw notFound('Expense not found');
      const q = uploadQuery.safeParse(req.query);
      if (!q.success) throw new ApiError(400, 'invalid_request', 'Send the receipt id (and optionally width and height) in the query string');
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new ApiError(400, 'invalid_request', 'Send the file as the request body');
      const declared = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
      const actual = sniffType(body);
      if (!actual || actual !== declared) {
        throw new ApiError(415, 'unsupported_file', 'Only photos (JPEG, PNG, WebP) and PDFs can be attached');
      }
      const sha = createHash('sha256').update(body).digest();

      const result = await db.asUser(req.userId, async (tx) => {
        const e = await expenseFor(tx, expenseId);
        const m = await activeMember(tx, e.group_id);
        const count = await tx.query<{ n: number }>('select count(*)::int as n from app.receipts where expense_id = $1 and deleted_at is null', [expenseId]);
        if (count.rows[0]!.n >= MAX_PER_EXPENSE) throw new ApiError(422, 'too_many_receipts', `An expense can have up to ${MAX_PER_EXPENSE} photos and files`);
        // The same file on another expense in this group is a hint that it may be a duplicate.
        const dup = await tx.query<{ expense_id: string; title: string }>(
          `select r.expense_id, v.title
             from app.receipts r
             join app.expenses x on x.id = r.expense_id
             join app.expense_versions v on v.expense_id = x.id and v.version = x.current_version
            where r.group_id = $1 and r.sha256 = $2 and r.deleted_at is null and x.status <> 'deleted'
            order by r.created_at limit 1`,
          [e.group_id, sha],
        );
        const key = receiptKey(e.group_id, expenseId, q.data.id);
        const row = await tx.query<ReceiptRow>(
          `insert into app.receipts (id, group_id, expense_id, uploaded_by, content_type, byte_size, sha256, storage_key, width, height)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning ${RECEIPT_COLUMNS}`,
          [q.data.id, e.group_id, expenseId, m.memberId, actual, body.length, sha, key, q.data.width ?? null, q.data.height ?? null],
        );
        await recordEvent(tx, { groupId: e.group_id, actor: m.memberId, entityType: 'expense', entityId: expenseId, type: 'receipt_added', payload: { receiptId: q.data.id } });
        // Stored inside the transaction: if storing fails, the record rolls back with it.
        await store.put(key, body, actual);
        const d = dup.rows[0];
        return { receipt: receiptJson(row.rows[0]!), duplicateOf: d ? { expenseId: d.expense_id, title: d.title, sameExpense: d.expense_id === expenseId } : null };
      });
      return reply.status(201).send(result);
    });

    r.get('/v1/receipts/:id', async (req, reply) => {
      if (!store) throw notConfigured();
      const { id } = req.params as { id: string };
      if (!PATH_ID.test(id)) throw notFound('Receipt not found');
      // Row-level security decides who may see it (anyone who can see the expense).
      const row = await db.asUser(req.userId, async (tx) => {
        const r = await tx.query<{ storage_key: string; content_type: string }>('select storage_key, content_type from app.receipts where id = $1 and deleted_at is null', [id]);
        return r.rows[0];
      });
      if (!row) throw notFound('Receipt not found');
      const bytes = await store.get(row.storage_key);
      if (!bytes) throw notFound('Receipt not found');
      const ext = row.content_type === 'application/pdf' ? 'pdf' : row.content_type.split('/')[1];
      return reply
        .header('content-type', row.content_type)
        .header('cache-control', 'private, max-age=3600')
        .header('x-content-type-options', 'nosniff')
        // Shown as a file, never run as a page.
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('content-disposition', `inline; filename="receipt.${ext}"`)
        .send(bytes);
    });
  });
}

/** Removing a receipt: whoever added it, the expense's owners (creator or payer), or an admin. The file is kept for the record. */
export function receiptRoutes(r: Router) {
  r.mutate('POST', '/receipts/:id/delete', z.strictObject({}), async ({ tx, params }) => {
    const found = await tx.query<{ expense_id: string; uploaded_by: string }>('select expense_id, uploaded_by from app.receipts where id = $1 and deleted_at is null', [params.id]);
    const row = found.rows[0];
    if (!row) throw notFound('Receipt not found');
    const e = await expenseFor(tx, row.expense_id);
    const m = await activeMember(tx, e.group_id);
    const owner = e.created_by === m.memberId || e.payers.some((p) => p.memberId === m.memberId);
    if (row.uploaded_by !== m.memberId && !owner && !isAdmin(m)) {
      throw new ApiError(403, 'forbidden', 'Only whoever added it, or the expense’s owner, can remove this');
    }
    await tx.query('update app.receipts set deleted_at = now(), deleted_by = $2 where id = $1', [params.id, m.memberId]);
    await recordEvent(tx, { groupId: e.group_id, actor: m.memberId, entityType: 'expense', entityId: row.expense_id, type: 'receipt_removed', payload: { receiptId: params.id } });
    return { ok: true };
  });
}
