import { makeUuidv7 } from './uuid';

/** UUIDv7: time-ordered, so ids the app creates (for safe retries) sort by creation time. */
export const uuidv7 = (now = Date.now(), random: (bytes: Uint8Array<ArrayBuffer>) => void = (b) => globalThis.crypto.getRandomValues(b)): string =>
  makeUuidv7(now, random);
