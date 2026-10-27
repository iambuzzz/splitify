import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ON, KINDS as SERVER_KINDS } from '../apps/api/src/push';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('notifications: app and server agree', () => {
  it('the settings screen lists exactly the kinds the server sends, with the same defaults', async () => {
    // The client module reads AsyncStorage and the device at import; only its constant is needed here.
    const src = read('apps/client/src/ui/useNotifications.ts');
    const listed = [...src.matchAll(/\{ kind: '(\w+)', title: '[^']+', hint: '[^']+', on: (true|false) \}/g)].map((m) => [m[1], m[2] === 'true']);
    expect(Object.fromEntries(listed)).toEqual(DEFAULT_ON);
    expect(listed.map((x) => x[0])).toEqual([...SERVER_KINDS]);
  });

  it('the service worker only handles notifications: it caches nothing, so updates work as before', () => {
    const sw = read('apps/client/public/sw.js');
    expect(sw).not.toMatch(/caches\.|addEventListener\('fetch'/);
    expect(sw).toContain("addEventListener('push'");
    expect(sw).toContain("addEventListener('notificationclick'");
  });

  it('only the server sends: the API on a Mac shares the live database', () => {
    expect(read('apps/api/src/index.ts')).toContain("PUSH_SENDER: z.enum(['0', '1']).default('0')");
    expect(read('deploy/push-env.sh')).toContain("echo 'PUSH_SENDER=1'");
  });

  it('Firebase settings stay out of git and reach EAS builds through app.config.js', () => {
    expect(read('apps/client/.gitignore')).toMatch(/^google-services\.json$/m);
    expect(read('apps/client/app.config.js')).toContain('process.env.GOOGLE_SERVICES_JSON');
  });
});
