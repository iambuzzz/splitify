import { uuidv7 } from './ids';

/** Set once at start-up (StoreProvider); kept out of this file so it runs anywhere, tests included. */
let target: { url: string; token: () => Promise<string | null | undefined> } | null = null;
export function configureApi(url: string, token: () => Promise<string | null | undefined>) {
  target = { url: url.replace(/\/$/, ''), token };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Untyped JSON at this edge; remote.ts maps it into the app's types.
type Json = any;

async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown): Promise<Json> {
  const token = await target?.token();
  if (!target || !token) throw new ApiError(401, 'unauthenticated', 'Please sign in again');
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    // A fresh key per action; the server stores the result, so a resent request is not applied twice.
    headers['idempotency-key'] = uuidv7();
  }
  let res: Response;
  try {
    res = await fetch(`${target.url}/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach Splitify. Check your internet and try again");
  }
  const json: Json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? 'Something went wrong. Try again');
  return json;
}

/** A receipt photo or PDF, sent as it is (not JSON). Retrying with the same `id` can't add it twice. */
export async function uploadReceipt(expenseId: string, id: string, file: Blob, contentType: string, size?: { width: number; height: number }): Promise<Json> {
  const token = await target?.token();
  if (!target || !token) throw new ApiError(401, 'unauthenticated', 'Please sign in again');
  const q = new URLSearchParams({ id, ...(size ? { width: String(size.width), height: String(size.height) } : {}) });
  let res: Response;
  try {
    res = await fetch(`${target.url}/v1/expenses/${expenseId}/receipts?${q}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': contentType }, body: file });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach Splitify. Check your internet and try again");
  }
  const json: Json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? 'Could not add the file. Try again');
  return json;
}

/** A receipt's file, for showing it (the request carries the sign-in token, so it can't be a plain link). */
export async function fetchReceipt(id: string): Promise<Blob> {
  const token = await target?.token();
  if (!target || !token) throw new ApiError(401, 'unauthenticated', 'Please sign in again');
  const res = await fetch(`${target.url}/v1/receipts/${id}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ApiError(res.status, 'error', 'Could not load this file');
  return res.blob();
}

/** Before sign-in: ask our API to email a 6-digit code and a sign-in button (no token needed). */
/** Emails a sign-in code; returns how many digits it has. */
export async function requestSignInEmail(email: string): Promise<number> {
  if (!target) throw new ApiError(0, 'offline', "Can't reach Splitify. Check your internet and try again");
  let res: Response;
  try {
    res = await fetch(`${target.url}/auth/email-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach Splitify. Check your internet and try again");
  }
  const json: Json = await res.json().catch(() => null);
  if (res.ok) return typeof json?.codeLength === 'number' ? json.codeLength : 6;
  throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? 'Something went wrong. Try again');
}

export const api = {
  get: (path: string) => call('GET', path),
  send: (method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown = {}) => call(method, path, body),
};
