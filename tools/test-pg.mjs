// Runs tests/pg and tests/api against a throwaway Postgres: initdb in a temp folder, start on a free localhost
// port, run vitest, stop, delete. Nothing is installed or left running.
// Uses TEST_DATABASE_URL as-is when set (CI provides a Postgres service).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const vitest = (env) =>
  spawnSync('npx', ['vitest', 'run', 'tests/pg', 'tests/api'], { stdio: 'inherit', env: { ...process.env, ...env } }).status ?? 1;

if (process.env.TEST_DATABASE_URL) process.exit(vitest({}));

const candidates = [process.env.PG_BIN, '/opt/homebrew/opt/postgresql@17/bin', '/usr/local/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'];
const bin = candidates.find((dir) => dir && existsSync(join(dir, 'initdb')));
if (!bin) {
  console.error('Postgres 17 not found. Install it (macOS: brew install postgresql@17) or set PG_BIN or TEST_DATABASE_URL.');
  process.exit(1);
}

const port = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

const dir = mkdtempSync(join(tmpdir(), 'splitify-pg-'));
const data = join(dir, 'data');
let server;
let code = 1;
try {
  execFileSync(join(bin, 'initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-sync'], { stdio: 'ignore' });
  server = spawn(join(bin, 'postgres'), ['-D', data, '-p', String(port), '-k', dir, '-c', 'listen_addresses=127.0.0.1', '-c', 'fsync=off'], {
    stdio: 'ignore',
  });
  for (let i = 0; ; i++) {
    const ready = spawnSync(join(bin, 'pg_isready'), ['-h', '127.0.0.1', '-p', String(port)]).status === 0;
    if (ready) break;
    if (i > 100) throw new Error('Postgres did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
  code = vitest({ TEST_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/postgres` });
} finally {
  server?.kill('SIGINT');
  await new Promise((r) => (server ? server.once('exit', r) : r()));
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
