import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../apps/client/src/data/ids';
import { inviteInLink } from '../apps/client/src/data/openedLink';

const client = join(__dirname, '../apps/client');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? (d.name === 'node_modules' ? [] : files(join(dir, d.name))) : [join(dir, d.name)]));

describe('phone-only files', () => {
  // On phones Metro resolves './ids' to ids.native.ts, so a native file importing its own base name
  // imports itself: every call recursed until "Maximum call stack size exceeded" (adding a member crashed).
  it('never import their own base name', () => {
    const native = [...files(join(client, 'src')), ...files(join(client, 'app'))].filter((f) => /\.native\.tsx?$/.test(f));
    expect(native.length).toBeGreaterThan(0);
    for (const f of native) {
      const self = basename(f).replace(/\.native\.tsx?$/, '');
      expect(readFileSync(f, 'utf8'), f).not.toMatch(new RegExp(`from '\\./${self}'`));
    }
  });

  it('web ids are still UUIDv7', () => {
    expect(uuidv7(0, (b) => b.fill(0xff))).toBe('00000000-0000-7fff-bfff-ffffffffffff');
  });

  it('find the invite in the link that opened the app, once', () => {
    const link = 'https://splitify.iambuzzdev.in/join#t=abc123';
    expect(inviteInLink(null)).toBeNull();
    expect(inviteInLink('https://splitify.iambuzzdev.in/group/g1/settle')).toBeNull();
    expect(inviteInLink(link)).toBe('abc123');
    expect(inviteInLink(link)).toBeNull(); // already used: signing in again doesn't reopen it
    expect(inviteInLink('splitify:///join#t=xyz')).toBe('xyz');
  });
});
