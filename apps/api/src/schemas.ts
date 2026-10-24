import { SUPPORTED_CURRENCIES } from '@app/money';
import { z } from 'zod';

/**
 * Request bodies. Money travels as a string of minor units ("60000" = ₹600.00) so it never
 * passes through a JS number; the money engine checks the range.
 */
export const minor = z.string().regex(/^[1-9]\d{0,12}$/, 'Amount in minor units, e.g. "60000"');
const id = z.uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const currency = z.enum(SUPPORTED_CURRENCIES as [string, ...string[]]);

export const split = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('equal'), members: z.array(id).min(1).max(100) }),
  z.strictObject({
    method: z.literal('exact'),
    amounts: z.array(z.strictObject({ memberId: id, amount: z.string().regex(/^\d{1,13}$/) })).min(1).max(100),
  }),
  z.strictObject({
    method: z.literal('percent'),
    basisPoints: z.array(z.strictObject({ memberId: id, basisPoints: z.int().min(0).max(10_000) })).min(1).max(100),
  }),
  z.strictObject({
    method: z.literal('shares'),
    shares: z.array(z.strictObject({ memberId: id, shares: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/) })).min(1).max(100),
  }),
]);
export type SplitBody = z.infer<typeof split>;

/** Everything a version holds; used to create, edit and suggest. */
export const expenseContent = z.strictObject({
  title: text(120),
  notes: optionalText(2000),
  category: optionalText(40),
  date: z.iso.date(),
  currency,
  total: minor,
  /** Ledger-currency units per 1 unit of `currency`; required when it differs from the group currency. */
  rate: z.string().regex(/^\d{1,20}(\.\d{1,10})?$/).optional(),
  rateSource: optionalText(40),
  payers: z.array(z.strictObject({ memberId: id, amount: minor })).min(1).max(100),
  split,
});
export type ExpenseContent = z.infer<typeof expenseContent>;

export const createExpense = expenseContent.extend({
  id: id.optional(),
  kind: z.enum(['expense', 'refund']).default('expense'),
  /** Save privately without counting it yet. */
  draft: z.boolean().default(false),
});

export const editExpense = expenseContent.extend({ baseVersion: z.int().min(1) });
export const baseVersion = z.strictObject({ baseVersion: z.int().min(1) });
export const reviewDecision = z.strictObject({ version: z.int().min(1) });
export const reviewDecline = z.strictObject({ version: z.int().min(1), reason: text(500) });
export const dispute = z.strictObject({ baseVersion: z.int().min(1), reason: text(500) });

export const createSuggestion = z.strictObject({
  id: id.optional(),
  baseVersion: z.int().min(1),
  proposal: expenseContent,
  reason: optionalText(500),
});

export const empty = z.strictObject({});
export const withReason = z.strictObject({ reason: text(500) });

export const createGroup = z.strictObject({
  id: id.optional(),
  memberId: id.optional(),
  name: text(80),
  kind: z.enum(['trip', 'home', 'couple', 'event', 'food', 'other']).default('other'),
  currency: currency.default('INR'),
  /** Your name in this group; defaults to your profile name. */
  displayName: text(60).optional(),
  /** Friends added by name before they join; each can later claim their name from an invite link. */
  placeholders: z.array(text(60)).max(50).default([]),
});

export const updateGroup = z
  .strictObject({
    name: text(80).optional(),
    kind: z.enum(['trip', 'home', 'couple', 'event', 'food', 'other']).optional(),
    /** Review mode: expenses at or above this amount need OKs. Null turns review mode off. */
    reviewThreshold: minor.nullable().optional(),
    reviewRequired: z.int().min(1).max(10).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');

export const addMember = z.strictObject({ id: id.optional(), displayName: text(60) });
export const updateMember = z
  .strictObject({ displayName: text(60).optional(), role: z.enum(['admin', 'member']).optional() })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export const leave = z.strictObject({
  /** Required when the member still owes or is owed money. */
  acknowledgeBalance: z.boolean().default(false),
});

export const createInvite = z.strictObject({
  expiresInDays: z.int().min(1).max(30).default(14),
  maxUses: z.int().min(1).max(100).optional(),
});
export const inviteToken = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const acceptInvite = inviteToken.extend({
  claimMemberId: id.optional(),
  displayName: text(60).optional(),
});

export const recordSettlement = z.strictObject({
  id: id.optional(),
  from: id,
  to: id,
  amount: minor,
  method: z.enum(['upi', 'cash', 'bank', 'other']),
  note: optionalText(500),
});

export const postMessage = z.strictObject({
  id: id.optional(),
  kind: z.enum(['text', 'question']).default('text'),
  body: text(4000),
  replyTo: id.optional(),
});

export const profile = z.strictObject({ displayName: text(60) });

export const pairMessage = z.strictObject({ id: id.optional(), body: text(4000) });

export const seen = z.strictObject({
  items: z
    .array(
      z.strictObject({
        groupId: id,
        type: z.enum(['expense', 'settlement', 'pair']),
        /** The expense, the payment, or the other member of a pair thread. */
        id,
        version: z.int().min(1).optional(),
      }),
    )
    .min(1)
    .max(50),
});
