import { MoneyError } from './errors';

/**
 * Splits `total` minor units in proportion to `weights` so the parts sum exactly to `total`.
 *
 * Largest-remainder method: every part gets the floor of its exact share, and the leftover
 * units go to the parts with the largest fractional remainders. Ties are broken by a hash of
 * (seed, key), so across expenses (different seeds) the extra unit rotates between members
 * instead of always landing on the same person, while staying fully deterministic.
 */
export function allocate(
  total: bigint,
  weights: readonly bigint[],
  keys: readonly string[],
  seed: string,
): bigint[] {
  if (weights.length === 0 || weights.length !== keys.length) {
    throw new MoneyError('invalid_weights', 'Weights and keys must be non-empty and the same length');
  }
  if (new Set(keys).size !== keys.length) {
    throw new MoneyError('invalid_weights', 'Keys must be unique');
  }
  let weightSum = 0n;
  for (const weight of weights) {
    if (weight < 0n) throw new MoneyError('invalid_weights', 'Weights must be non-negative');
    weightSum += weight;
  }
  if (weightSum === 0n) throw new MoneyError('invalid_weights', 'At least one weight must be positive');

  if (total < 0n) return allocate(-total, weights, keys, seed).map((part) => -part);

  const parts = weights.map((weight) => (total * weight) / weightSum);
  const remainders = weights.map((weight) => (total * weight) % weightSum);
  let leftover = total - parts.reduce((acc, part) => acc + part, 0n);

  // leftover < number of non-zero remainders, so zero-weight parts never receive a unit.
  const order = keys
    .map((key, index) => ({ index, key, remainder: remainders[index]!, tie: tieBreak(seed, key) }))
    .sort(
      (a, b) =>
        compareBigint(b.remainder, a.remainder) ||
        a.tie - b.tie ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );

  for (const { index } of order) {
    if (leftover === 0n) break;
    parts[index] = parts[index]! + 1n;
    leftover -= 1n;
  }
  return parts;
}

function compareBigint(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * FNV-1a (32-bit) over `${seed}:${key}` followed by the murmur3 finaliser; identical on every
 * JS runtime. The finaliser matters: raw FNV-1a orders keys that differ only in their last
 * character with a strong bias, which skewed who received leftover units.
 */
function tieBreak(seed: string, key: string): number {
  const input = `${seed}:${key}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}
