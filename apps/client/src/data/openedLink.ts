/**
 * Phones: the invite in the link that opened the app (an invite link opens the app, not the browser).
 * Signed out, the sign-in screen shows first; this is how the app goes on to /join afterwards. Each link once.
 */
let usedLink: string | null = null;

export function inviteInLink(url: string | null): string | null {
  if (!url || url === usedLink) return null;
  const [where = '', hash = ''] = url.split('#');
  if (!/\/join$/.test(where.split('?')[0]!)) return null;
  usedLink = url;
  return new URLSearchParams(hash).get('t');
}
