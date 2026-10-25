import { config } from './config';

/**
 * The Android app comes from our website, not a store, so nothing updates it. The website lists the
 * latest build in /download/latest.json (written by deploy/push-apk.sh) and the app offers it.
 */
export interface LatestApk {
  version: string;
  minAndroid?: string;
  apk64?: { file: string; mb: number };
  apk32?: { file: string; mb: number };
}

const SITE = (config.appUrl ?? 'https://splitify.iambuzzdev.in').replace(/\/$/, '');

/** Whether version a (e.g. "1.10.0") is newer than b ("1.9.2"). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/** The newer build for this phone's kind of chip (32 or 64-bit), or null when this one is the latest. */
export function updateFor(latest: LatestApk | null, current: string, bits: '32' | '64'): { version: string; url: string; mb?: number } | null {
  if (!latest?.version || !isNewer(latest.version, current)) return null;
  const apk = bits === '32' ? latest.apk32 : latest.apk64;
  if (!apk?.file) return null;
  return { version: latest.version, url: `${SITE}/download/${apk.file}`, mb: apk.mb };
}

export async function fetchLatestApk(): Promise<LatestApk | null> {
  try {
    const r = await fetch(`${SITE}/download/latest.json`, { headers: { 'Cache-Control': 'no-cache' } });
    return r.ok ? ((await r.json()) as LatestApk) : null;
  } catch {
    return null;
  }
}
