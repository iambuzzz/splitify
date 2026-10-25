import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNewer, updateFor } from '../apps/client/src/data/appUpdate';

const root = join(__dirname, '..');
const landing = readFileSync(join(root, 'apps/landing/index.html'), 'utf8');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]));

/** Runs the landing page's first <script> (the redirect) against a pretend browser; returns where it sent us. */
function firstVisit(url: string, opts: { signedIn?: boolean; installed?: boolean } = {}): string | null {
  const script = landing.match(/<head>\s*<meta charset="utf-8">\s*<script>([\s\S]*?)<\/script>/)![1]!;
  const u = new URL(url);
  let went: string | null = null;
  const keys = opts.signedIn ? ['splitify.theme', 'sb-abcd-auth-token'] : ['splitify.theme'];
  const location = { search: u.search, hash: u.hash, replace: (to: string) => (went = to) };
  const localStorage = { length: keys.length, key: (i: number) => keys[i] ?? null };
  const navigator = { standalone: opts.installed ? true : undefined };
  const window = { matchMedia: () => ({ matches: false }) };
  new Function('location', 'localStorage', 'navigator', 'window', 'matchMedia', script)(location, localStorage, navigator, window, window.matchMedia);
  return went;
}

describe('landing page', () => {
  it('is a whole page that lays out at phone width', () => {
    expect(landing.startsWith('<!doctype html>')).toBe(true);
    expect(landing).toContain('<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">');
    expect(landing).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(landing.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('sends its buttons into the app, on this site', () => {
    expect(landing).not.toContain('target="_blank"');
    expect(landing).toContain('<a class="btn btn-primary" href="/groups">Open Splitify</a>');
    expect(landing).toMatch(/href="\/new">\s*Start a group/);
  });

  it('offers all four devices, with real Android files', () => {
    for (const os of ['android', 'ios', 'windows', 'mac']) expect(landing).toContain(`<div class="gt-item" data-os="${os}">`);
    expect(landing).toContain('href="/download/splitify-android.apk"');
    expect(landing).toContain('href="/download/splitify-android-32bit.apk"');
    expect(landing).not.toContain('goes live with the app');
  });

  it('shows itself to new visitors, and gets out of the way otherwise', () => {
    expect(firstVisit('https://s.in/')).toBeNull();
    expect(firstVisit('https://s.in/', { signedIn: true })).toBe('/groups');
    expect(firstVisit('https://s.in/?tour', { signedIn: true })).toBeNull();
    expect(firstVisit('https://s.in/?tour#get', { signedIn: true })).toBeNull();
    expect(firstVisit('https://s.in/', { installed: true })).toBe('/groups');
    // Sign-in leftovers after # never reach the server: they go on to the app.
    expect(firstVisit('https://s.in/#access_token=a&type=magiclink')).toBe('/groups#access_token=a&type=magiclink');
    expect(firstVisit('https://s.in/#error=access_denied&error_description=x')).toBe('/groups#error=access_denied&error_description=x');
    expect(firstVisit('https://s.in/#get')).toBeNull();
  });
});

describe('installable web app', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'apps/client/public/manifest.webmanifest'), 'utf8'));
  it('opens on the groups, never the landing page, and has the icons browsers ask for', () => {
    expect(manifest.start_url).toBe('/groups');
    expect(manifest.display).toBe('standalone');
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    for (const i of manifest.icons) expect(existsSync(join(root, 'apps/client/public', i.src))).toBe(true);
  });
  it('is linked from the app page', () => {
    const html = readFileSync(join(root, 'apps/client/public/index.html'), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('viewport-fit=cover');
  });
});

describe('the app home is /groups', () => {
  it('no screen sends people to / any more (the website shows the landing page there)', () => {
    const client = join(root, 'apps/client');
    const code = [...files(join(client, 'app')), ...files(join(client, 'src'))].filter((f) => /\.tsx?$/.test(f));
    for (const f of code) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/(push|replace|navigate)\(\s*'\/'\s*\)|href="\/"|back = '\/'|replaceState\(null, '', '\/'\)/);
    }
    expect(readFileSync(join(client, 'app/index.tsx'), 'utf8')).toContain('<Redirect href="/groups" />');
  });
});

describe('Android update check', () => {
  it('compares versions number by number', () => {
    expect(isNewer('1.10.0', '1.9.2')).toBe(true);
    expect(isNewer('1.1.0', '1.1')).toBe(false);
    expect(isNewer('1.1.1', '1.1')).toBe(true);
    expect(isNewer('1.0.9', '1.1.0')).toBe(false);
  });
  it('offers the file for this phone, only when it is newer', () => {
    const latest = { version: '1.2.0', apk64: { file: 'a64.apk', mb: 20 }, apk32: { file: 'a32.apk', mb: 18 } };
    expect(updateFor(latest, '1.2.0', '64')).toBeNull();
    expect(updateFor(latest, '1.1.0', '64')).toEqual({ version: '1.2.0', url: 'https://splitify.iambuzzdev.in/download/a64.apk', mb: 20 });
    expect(updateFor(latest, '1.1.0', '32')?.url).toBe('https://splitify.iambuzzdev.in/download/a32.apk');
    expect(updateFor(null, '1.1.0', '64')).toBeNull();
    expect(updateFor({ version: '2.0.0' }, '1.1.0', '64')).toBeNull();
  });
});
