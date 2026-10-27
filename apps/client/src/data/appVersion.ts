/**
 * Which version is running, and whether a newer one is out. One version number for every device
 * (app.json); the website also carries a build id, since it can change several times per version.
 */

/** What the server says the website is now (deploy/deploy.sh writes /version.json on every deploy). */
export interface WebVersion {
  version: string;
  build: string;
}

/** A different build on the server than the one running here. Without a build id (local runs) never. */
export function webUpdateFor(server: WebVersion | null, myBuild: string | undefined): WebVersion | null {
  if (!server?.build || !myBuild || server.build === myBuild) return null;
  return server;
}

/** "iPhone", "Windows"…, from the browser's own description of itself. */
export function deviceName(ua: string, touchPoints = 0): string {
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  // iPads ask for desktop pages and say "Macintosh"; the touch screen gives them away.
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Linux';
  return 'this device';
}

/** Website only: asks the server it was loaded from. */
export async function fetchWebVersion(): Promise<WebVersion | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
    return r.ok ? ((await r.json()) as WebVersion) : null;
  } catch {
    return null;
  }
}
