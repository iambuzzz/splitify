export type LedgerErrorCode =
  | 'invalid_total'
  | 'no_participants'
  | 'duplicate_member'
  | 'exact_mismatch'
  | 'percent_mismatch'
  | 'invalid_share'
  | 'payers_mismatch'
  | 'invalid_payer'
  | 'missing_rate'
  | 'unbalanced'
  | 'already_posted'
  | 'not_posted'
  | 'version_mismatch';

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}
