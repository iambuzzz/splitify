import { LedgerError } from '@app/ledger';
import { MoneyError } from '@app/money';
import type { WorkflowErrorCode } from '@app/workflow';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (what = 'Not found') => new ApiError(404, 'not_found', what);

const WORKFLOW: Record<WorkflowErrorCode, [number, string]> = {
  forbidden: [403, 'You are not allowed to do this'],
  not_eligible: [403, 'You cannot do this on this item'],
  invalid_state: [409, 'This is not possible in its current state'],
  stale_version: [409, 'Someone changed this in the meantime. Reload and try again'],
  reason_required: [422, 'Please give a reason'],
};

export function workflowError(code: WorkflowErrorCode): ApiError {
  const [status, message] = WORKFLOW[code];
  return new ApiError(status, code, message);
}

/** Maps errors from the money engine and the database to API errors; anything else is a 500. */
export function toApiError(err: unknown): ApiError | null {
  if (err instanceof ApiError) return err;
  if (err instanceof LedgerError || err instanceof MoneyError) return new ApiError(422, err.code, err.message);
  const code = (err as { code?: unknown } | null)?.code;
  switch (code) {
    case '40001': // serialization_failure: a concurrent edit took this version number
    case '40P01': // deadlock
      return new ApiError(409, 'conflict', 'Someone changed this in the meantime. Reload and try again');
    case '23505':
      return new ApiError(409, 'already_exists', 'This already exists');
    case '23503':
      return new ApiError(422, 'invalid_reference', 'Refers to something that does not exist in this group');
    case '23514':
    case '23502':
      return new ApiError(422, 'invalid_value', 'A value is not allowed');
    case '42501':
      return new ApiError(403, 'forbidden', 'You are not allowed to do this');
    case '28000':
      return new ApiError(404, 'invite_invalid', 'This invite link is not valid any more');
    default:
      return null;
  }
}
