import type { MemberId } from './types';

/**
 * Review mode: one rule per group. When enabled, new expenses and material edits whose amount
 * (the larger of old and new, in ledger minor units) reaches the threshold need
 * `approvalsRequired` OKs from affected members other than the author.
 */
export interface ReviewPolicy {
  enabled: boolean;
  thresholdMinor: bigint;
  approvalsRequired: number;
}

export const REVIEW_OFF: ReviewPolicy = { enabled: false, thresholdMinor: 0n, approvalsRequired: 1 };

export function needsReview(policy: ReviewPolicy, amountMinor: bigint): boolean {
  return policy.enabled && amountMinor >= policy.thresholdMinor;
}

/**
 * Approvals still count only while the approver is eligible (a current, affected member who is
 * not the author). If fewer eligible members remain than the policy asks for, the requirement
 * shrinks to match; with nobody eligible, the review passes.
 */
export function reviewSatisfied(
  approvals: readonly MemberId[],
  eligible: readonly MemberId[],
  approvalsRequired: number,
): boolean {
  const required = Math.min(approvalsRequired, eligible.length);
  const counted = approvals.filter((id) => eligible.includes(id)).length;
  return counted >= required;
}
