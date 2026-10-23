// npm audit with a reviewed allowlist (audit-allowlist.json).
// Fails on: any advisory not on the list, any expired entry. Warns when an entry is no longer needed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const allow = JSON.parse(readFileSync(new URL('../audit-allowlist.json', import.meta.url), 'utf8')).advisories;

let raw;
try {
  raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
} catch (e) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
  raw = e.stdout;
}
if (!raw) {
  console.error('npm audit produced no output (registry unreachable?)');
  process.exit(1);
}
const report = JSON.parse(raw);

// Root advisories are the `via` entries that are objects (strings just point at other packages).
const found = new Map();
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via === 'object') {
      const id = via.url.split('/').pop();
      found.set(id, { id, package: via.name, severity: via.severity, title: via.title });
    }
  }
}

const today = new Date().toISOString().slice(0, 10);
const allowed = new Map(allow.map((a) => [a.id, a]));
const problems = [];
for (const f of found.values()) {
  const a = allowed.get(f.id);
  if (!a) problems.push(`NEW ${f.severity} advisory ${f.id} in ${f.package}: ${f.title}`);
  else if (a.reviewBy < today) problems.push(`EXPIRED allowlist entry ${f.id} (${f.package}), review was due ${a.reviewBy}`);
}
for (const a of allow) {
  if (!found.has(a.id)) console.warn(`note: ${a.id} (${a.package}) no longer reported; remove it from audit-allowlist.json`);
}
for (const f of found.values()) {
  if (allowed.has(f.id) && allowed.get(f.id).reviewBy >= today) {
    console.log(`allowed until ${allowed.get(f.id).reviewBy}: ${f.id} ${f.package} (${f.severity})`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`audit ok: ${found.size} known advisor${found.size === 1 ? 'y' : 'ies'}, all on the reviewed allowlist`);
