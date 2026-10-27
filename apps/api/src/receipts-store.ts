import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { ApiError } from './errors';

/** Where receipt files are kept. Only the API reads and writes them; keys come from the API, never from a request. */
export interface ReceiptStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Null when the file isn't there. */
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

/** Local development: files in a folder on this machine. */
export function folderReceiptStore(root: string): ReceiptStore {
  const base = resolve(root);
  const path = (key: string) => {
    const p = resolve(base, key);
    if (!p.startsWith(base + sep)) throw new Error('receipt key outside the store');
    return p;
  };
  return {
    async put(key, bytes) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      // Write then rename, so a half-written file is never read.
      await writeFile(`${p}.part`, bytes);
      await rename(`${p}.part`, p);
    },
    async get(key) {
      try {
        return await readFile(path(key));
      } catch (err) {
        if ((err as { code?: string }).code === 'ENOENT') return null;
        throw err;
      }
    },
    async remove(key) {
      await rm(path(key), { force: true });
    },
  };
}

/**
 * Production: a private Supabase Storage bucket, reached with the project's secret key (server side
 * only). The bucket must exist and must not be public.
 */
export function supabaseReceiptStore(cfg: {
  supabaseUrl: string;
  secretKey: string;
  bucket: string;
  fetch?: typeof fetch;
  /** How long one read may take before it's tried again (storage sometimes stalls for 10 s or more). */
  readTimeoutMs?: number;
  warn?: (msg: string, details: Record<string, unknown>) => void;
}): ReceiptStore {
  const http = cfg.fetch ?? fetch;
  const readTimeout = cfg.readTimeoutMs ?? 8000;
  const warn = cfg.warn ?? ((msg, details) => console.warn(JSON.stringify({ level: 40, msg, ...details })));
  const headers: Record<string, string> = { apikey: cfg.secretKey };
  if (!cfg.secretKey.startsWith('sb_secret_')) headers.authorization = `Bearer ${cfg.secretKey}`;
  const url = (key: string) => `${cfg.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(cfg.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const unavailable = () => new ApiError(502, 'storage_unavailable', 'Could not reach file storage. Try again in a minute');
  return {
    async put(key, bytes, contentType) {
      // Not retried: a write that timed out may still have landed, and a second one would be refused.
      const res = await http(url(key), { method: 'POST', headers: { ...headers, 'content-type': contentType, 'x-upsert': 'false' }, body: bytes });
      if (!res.ok) {
        warn('receipt storage write failed', { status: res.status });
        throw unavailable();
      }
    },
    async get(key) {
      // Reading is safe to repeat, so a stalled or failed read gets one more go before the app is told.
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await http(url(key), { headers, signal: AbortSignal.timeout(readTimeout) });
          if (res.status === 400 || res.status === 404) return null;
          if (res.ok) return Buffer.from(await res.arrayBuffer());
          warn('receipt storage read failed', { status: res.status, attempt });
        } catch (err) {
          warn('receipt storage read failed', { error: err instanceof Error ? err.name : 'unknown', attempt });
        }
        if (attempt >= 2) throw unavailable();
      }
    },
    async remove(key) {
      const res = await http(url(key), { method: 'DELETE', headers });
      if (!res.ok && res.status !== 404 && res.status !== 400) throw unavailable();
    },
  };
}

/**
 * Keeps recently used files in memory, up to `maxBytes` in all. A stored receipt never changes (its
 * key is its own id), so a kept copy can't go stale, and a photo opened twice skips storage the second time.
 */
export function cachedReceiptStore(store: ReceiptStore, maxBytes: number): ReceiptStore {
  const kept = new Map<string, Buffer>();
  let total = 0;
  const forget = (key: string) => {
    const b = kept.get(key);
    if (b) {
      total -= b.length;
      kept.delete(key);
    }
  };
  const keep = (key: string, bytes: Buffer) => {
    if (bytes.length > maxBytes / 4) return;
    forget(key);
    kept.set(key, bytes);
    total += bytes.length;
    // A Map iterates in insertion order, so the first key is the one used longest ago.
    for (const k of kept.keys()) {
      if (total <= maxBytes) break;
      forget(k);
    }
  };
  return {
    async put(key, bytes, contentType) {
      await store.put(key, bytes, contentType);
      keep(key, bytes);
    },
    async get(key) {
      const hit = kept.get(key);
      if (hit) {
        keep(key, hit);
        return hit;
      }
      const bytes = await store.get(key);
      if (bytes) keep(key, bytes);
      return bytes;
    },
    async remove(key) {
      forget(key);
      await store.remove(key);
    },
  };
}

/** What the bytes actually are, from their first bytes; null for anything we don't take. */
export function sniffType(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export const receiptKey = (groupId: string, expenseId: string, receiptId: string) => join(groupId, expenseId, receiptId).split(sep).join('/');
