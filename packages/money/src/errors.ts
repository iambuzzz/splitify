export type MoneyErrorCode =
  | 'unknown_currency'
  | 'invalid_amount'
  | 'too_many_decimals'
  | 'amount_out_of_range'
  | 'invalid_rate'
  | 'invalid_weights'
  | 'currency_mismatch';

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}
