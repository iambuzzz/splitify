import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isNewer, updateFor } from '../apps/client/src/data/appUpdate';
import { deviceName, webUpdateFor } from '../apps/client/src/data/appVersion';

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

describe('search', () => {
  const pagesMod = () => import('../apps/landing/build-pages.mjs');

  it('the landing page has a searchable title, description and matching question data', () => {
    const title = landing.match(/<title>([^<]+)<\/title>/)![1]!;
    const desc = landing.match(/<meta name="description" content="([^"]+)">/)![1]!;
    expect(title.length).toBeLessThanOrEqual(65);
    expect(desc.length).toBeLessThanOrEqual(160);
    const ld = JSON.parse(landing.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!);
    const faq = ld['@graph'].find((n: { '@type': string }) => n['@type'] === 'FAQPage');
    // Every question in the data is on the page, word for word (search engines check).
    for (const q of faq.mainEntity) {
      expect(landing).toContain(`<summary>${q.name}<span`);
      expect(landing).toContain(`<p>${q.acceptedAnswer.text}</p>`);
    }
  });

  it('every guide is a whole page with its own title, canonical link and question data', async () => {
    const { readPages, renderPage, questionsOf } = await pagesMod();
    const pages = readPages();
    expect(pages.map((p) => p.slug)).toEqual(['split-bill-calculator', 'split-dinner-bill', 'split-rent-with-flatmates', 'split-trip-expenses']);
    const titles = new Set<string>();
    for (const p of pages) {
      const html = renderPage(p, pages);
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain(`<link rel="canonical" href="https://splitify.iambuzzdev.in/${p.slug}">`);
      expect(p.meta.description.length).toBeLessThanOrEqual(160);
      expect(p.meta.title.length).toBeLessThanOrEqual(65);
      expect(html.match(/<h1>/g)).toHaveLength(1);
      titles.add(p.meta.title);
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!);
      expect(ld['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(['BreadcrumbList', p.meta.type === 'tool' ? 'WebApplication' : 'Article', 'FAQPage']);
      expect(questionsOf(p.body).length).toBeGreaterThanOrEqual(3);
      // Links stay on this site's real pages.
      for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) {
        expect(['/', '/?tour', '/groups', '/new', '/guides.css', '/icons/favicon-32.png', '/icons/apple-touch-icon.png', ...pages.map((x) => `/${x.slug}`)]).toContain(href);
      }
    }
    expect(titles.size).toBe(pages.length);
  });

  it('reads questions from the page markup, without tags', async () => {
    const { questionsOf } = await pagesMod();
    expect(questionsOf('<section class="faq"><details><summary>Is it <b>free</b>?</summary><p>Yes, see <a href="/x">this</a>.</p></details></section>')).toEqual([{ q: 'Is it free?', a: 'Yes, see this.' }]);
  });

  it('the sitemap lists the landing page and every guide; robots points at it', async () => {
    const { readPages, sitemap } = await pagesMod();
    const xml = sitemap(readPages(), '2026-10-27');
    expect(xml.match(/<loc>/g)).toHaveLength(5);
    expect(xml).toContain('<loc>https://splitify.iambuzzdev.in/</loc>');
    const robots = readFileSync(join(root, 'apps/client/public/robots.txt'), 'utf8');
    expect(robots).toContain('Sitemap: https://splitify.iambuzzdev.in/sitemap.xml');
    expect(robots).not.toMatch(/Disallow: \/split/);
  });

  it('keeps the signed-in app out of search results', () => {
    expect(readFileSync(join(root, 'apps/client/public/index.html'), 'utf8')).toContain('<meta name="robots" content="noindex" />');
    expect(landing).not.toContain('noindex');
  });
});

describe('version and updates', () => {
  it('names the device from the browser', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('iPhone');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5)).toBe('iPad');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0')).toBe('Mac');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0')).toBe('Windows');
    expect(deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile')).toBe('Android');
  });

  it('offers the website update only for a different build', () => {
    expect(webUpdateFor({ version: '1.1.3', build: 'b' }, 'a')).toEqual({ version: '1.1.3', build: 'b' });
    expect(webUpdateFor({ version: '1.1.3', build: 'a' }, 'a')).toBeNull();
    // Local runs have no build id, and an unreachable server says nothing.
    expect(webUpdateFor({ version: '1.1.3', build: 'b' }, undefined)).toBeNull();
    expect(webUpdateFor(null, 'a')).toBeNull();
  });

  it('every deploy stamps the website with a build id and writes /version.json', () => {
    const deploy = readFileSync(join(root, 'deploy/deploy.sh'), 'utf8');
    expect(deploy).toContain('EXPO_PUBLIC_WEB_BUILD="$BUILD"');
    expect(deploy).toContain('dist/web/version.json');
    expect(readFileSync(join(root, 'deploy/Caddyfile'), 'utf8')).toContain('try_files {path} {path}.html /index.html');
  });
});
