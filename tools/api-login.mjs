// Sets up the API's database login on the linked Supabase project, without the password ever
// being printed, committed or pasted into chat:
//   1. generates a random password locally;
//   2. copies `alter role api_login ... password '…'` to the clipboard for you to run in the SQL editor;
//   3. checks the API can log in and become app_api (TLS, certificate checked);
//   4. writes DATABASE_URL, SUPABASE_URL and DATABASE_CA_CERT into .env.local, and the app's
//      public settings into apps/client/.env.local (both git-ignored).
// Run it again any time to rotate the password.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import pg from 'pg';

const POOLER_FILE = 'supabase/.temp/pooler-url';
const ENV_FILE = '.env.local';
const CLIENT_ENV_FILE = 'apps/client/.env.local';

const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

if (!existsSync(POOLER_FILE)) fail('Project not linked yet. Run: npm run db:login, then npm run db:link');
const pooler = new URL(readFileSync(POOLER_FILE, 'utf8').trim());
const ref = decodeURIComponent(pooler.username).split('.')[1];
if (!ref) fail(`Could not read the project ref from ${POOLER_FILE}`);

const cert = readdirSync('supabase').find((f) => f.endsWith('.crt'));
if (!cert) {
  fail(
    'The database SSL certificate is missing.\n' +
      '  Supabase dashboard → Project Settings → Database → SSL Configuration → Download certificate,\n' +
      '  then move the .crt file into the supabase/ folder of this project and run this again.',
  );
}
const caPath = `./supabase/${cert}`;
const ca = readFileSync(caPath, 'utf8');

const password = randomBytes(32).toString('base64url'); // URL-safe: no escaping needed
const databaseUrl = `postgresql://api_login.${ref}:${password}@${pooler.hostname}:6543/postgres`;
const sql = `alter role api_login with login password '${password}';`;

let clipboard = false;
try {
  execFileSync('pbcopy', { input: sql });
  clipboard = true;
} catch {}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log('\nStep 1. Open https://supabase.com/dashboard/project/' + ref + '/sql/new');
if (clipboard) {
  console.log('Step 2. Paste (Cmd+V) the SQL that is now on your clipboard, and click Run.');
  console.log('        (It sets a new random password for api_login. It is not shown here on purpose.)');
} else {
  fail('No clipboard tool (pbcopy) found. This script is written for macOS.');
}

let ok = false;
for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
  await rl.question('Step 3. Press Enter here after it says "Success". ');
  const client = new pg.Client({ connectionString: databaseUrl, ssl: { ca, rejectUnauthorized: true } });
  try {
    await client.connect();
    await client.query('begin');
    await client.query('set local role app_api');
    await client.query('select count(*) from app.groups');
    await client.query('rollback');
    ok = true;
  } catch (err) {
    const why = String(err?.message ?? err).replaceAll(password, '<password>');
    console.log(`   Could not log in yet (${why}).`);
    if (/does not exist/.test(why)) console.log('   Something is missing on the database: run npm run db:push first.');
    else if (/password authentication failed/.test(why)) console.log('   The new password is not set yet: run the SQL in the editor first.');
  } finally {
    await client.end().catch(() => {});
  }
}
if (clipboard) execFileSync('pbcopy', { input: '' }); // don't leave the password on the clipboard
rl.close();
if (!ok) fail('The API could not log in. Nothing was saved; run this again to start over.');

/** Sets these keys in an env file, keeping every other line as it was. */
function setEnv(file, values) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  const kept = lines.filter((l) => !Object.keys(values).some((k) => l.startsWith(`${k}=`)));
  while (kept.length && kept.at(-1) === '') kept.pop();
  writeFileSync(file, [...kept, ...Object.entries(values).map(([k, v]) => `${k}=${v}`)].join('\n') + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
}

setEnv(ENV_FILE, { DATABASE_URL: databaseUrl, SUPABASE_URL: `https://${ref}.supabase.co`, DATABASE_CA_CERT: caPath });
// Public values only: the app ships them to every browser and phone.
setEnv(CLIENT_ENV_FILE, { EXPO_PUBLIC_API_URL: 'http://localhost:3001', EXPO_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co` });
const hasKey = readFileSync(CLIENT_ENV_FILE, 'utf8').includes('EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_');
console.log(`\n✓ The API can log in. Saved to ${ENV_FILE} (only readable by you). Start it with: npm run api`);
if (!hasKey) {
  console.log(
    `\nOne more line for the app: open ${CLIENT_ENV_FILE} and add\n` +
      '  EXPO_PUBLIC_SUPABASE_KEY=<your publishable key>\n' +
      '  (Supabase → Project Settings → API Keys → Publishable key, starts with sb_publishable_. Never the secret key.)',
  );
}
console.log('');
