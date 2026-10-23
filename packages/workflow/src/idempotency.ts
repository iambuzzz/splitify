/**
 * Deterministic serialisation used to compare idempotent request payloads: object keys are
 * sorted, bigints are tagged so `1n` and `1` differ, and values JSON cannot represent exactly
 * are rejected rather than silently dropped.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('Cannot canonicalize a non-finite number');
      return Object.is(value, -0) ? '0' : String(value);
    case 'bigint':
      return `{"$bigint":"${value.toString()}"}`;
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
      const entries = Object.keys(value as object)
        .sort()
        .map((key) => {
          const field = (value as Record<string, unknown>)[key];
          if (field === undefined) throw new TypeError(`Cannot canonicalize undefined field "${key}"`);
          return `${JSON.stringify(key)}:${canonicalize(field)}`;
        });
      return `{${entries.join(',')}}`;
    }
    default:
      throw new TypeError(`Cannot canonicalize a ${typeof value}`);
  }
}

export type IdempotencyOutcome<R> =
  | { kind: 'executed'; result: R }
  | { kind: 'replayed'; result: R }
  /** Same key reused with a different payload: a client bug, answered with HTTP 422. */
  | { kind: 'conflict' };

/**
 * Reference model of the server's idempotency table: (key → canonical payload, stored result).
 * The R1 database implementation must behave identically (a unique key constraint makes the
 * first committed request win under concurrency). Only successful results are stored, so a
 * failed attempt can be retried with the same key.
 */
export class IdempotencyRegistry<R> {
  readonly #entries = new Map<string, { payload: string; result: R }>();

  execute(key: string, payload: unknown, run: () => R): IdempotencyOutcome<R> {
    const canonical = canonicalize(payload);
    const existing = this.#entries.get(key);
    if (existing) {
      return existing.payload === canonical ? { kind: 'replayed', result: existing.result } : { kind: 'conflict' };
    }
    const result = run();
    this.#entries.set(key, { payload: canonical, result });
    return { kind: 'executed', result };
  }
}
