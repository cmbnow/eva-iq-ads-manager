import 'server-only';

/**
 * Meta (Facebook) OAuth — server-only token exchange helpers.
 * The App Secret and every token live ONLY on the server. Nothing here is ever
 * imported by a client component ('server-only' enforces that at build time).
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v21.0';
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const META_SCOPES = ['ads_read', 'ads_management', 'business_management'];

export function metaRedirectUri(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) throw new Error('NEXT_PUBLIC_SITE_URL is not set');
  return `${site.replace(/\/$/, '')}/api/meta/oauth/callback`;
}

export function metaAuthorizeUrl(state: string): string {
  const appId = process.env.META_APP_ID;
  if (!appId) throw new Error('META_APP_ID is not set');
  const u = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  u.searchParams.set('client_id', appId);
  u.searchParams.set('redirect_uri', metaRedirectUri());
  u.searchParams.set('state', state);
  u.searchParams.set('scope', META_SCOPES.join(','));
  u.searchParams.set('response_type', 'code');
  return u.toString();
}

/**
 * Exchange the OAuth `code` for a SHORT-lived user token, then upgrade it to a
 * LONG-lived (~60 day) token. Returns the long-lived token only.
 */
export async function exchangeCodeForLongLivedToken(code: string): Promise<string> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error('META_APP_ID / META_APP_SECRET not set');

  // 1) code -> short-lived token
  const u1 = new URL(`${BASE}/oauth/access_token`);
  u1.searchParams.set('client_id', appId);
  u1.searchParams.set('client_secret', appSecret);
  u1.searchParams.set('redirect_uri', metaRedirectUri());
  u1.searchParams.set('code', code);
  const r1 = await fetch(u1, { cache: 'no-store' });
  if (!r1.ok) throw new Error(`short-lived exchange failed (${r1.status})`);
  const j1 = (await r1.json()) as { access_token?: string };
  if (!j1.access_token) throw new Error('no short-lived access_token');

  // 2) short-lived -> long-lived token
  const u2 = new URL(`${BASE}/oauth/access_token`);
  u2.searchParams.set('grant_type', 'fb_exchange_token');
  u2.searchParams.set('client_id', appId);
  u2.searchParams.set('client_secret', appSecret);
  u2.searchParams.set('fb_exchange_token', j1.access_token);
  const r2 = await fetch(u2, { cache: 'no-store' });
  if (!r2.ok) throw new Error(`long-lived exchange failed (${r2.status})`);
  const j2 = (await r2.json()) as { access_token?: string };
  if (!j2.access_token) throw new Error('no long-lived access_token');

  return j2.access_token;
}

/** Read the scopes the user actually granted (so we store the truth, not the ask). */
export async function fetchGrantedScopes(token: string): Promise<string[]> {
  const u = new URL(`${BASE}/me/permissions`);
  u.searchParams.set('access_token', token);
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) return [];
  const j = (await r.json()) as { data?: { permission: string; status: string }[] };
  return (j.data ?? [])
    .filter((p) => p.status === 'granted')
    .map((p) => p.permission);
}
