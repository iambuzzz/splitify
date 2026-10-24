/**
 * UUIDv7 from given random bytes. Lives apart from ids.ts/ids.native.ts: on phones Metro resolves
 * './ids' to ids.native.ts itself, so the native file can't import the shared code from there.
 */
export function makeUuidv7(now: number, random: (bytes: Uint8Array<ArrayBuffer>) => void): string {
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
