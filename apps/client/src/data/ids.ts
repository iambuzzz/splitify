/** UUIDv7: time-ordered, so ids the app creates (for safe retries) sort by creation time. */
export function uuidv7(now = Date.now(), random: (bytes: Uint8Array<ArrayBuffer>) => void = (b) => globalThis.crypto.getRandomValues(b)): string {
  const b = new Uint8Array(16);
  random(b);
  let ms = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
