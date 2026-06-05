import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  exchangeCodeForLongLivedToken,
  fetchGrantedScopes,
} from '~/lib/server/meta/oauth';

/**
 * GET /api/meta/oauth/callback
 * Facebook redirects here after consent. Validates the CSRF state, exchanges
 * the code for a long-lived token, stores the token in Supabase Vault (via the
 * service_role-only store_meta_token function), and marks the connection live.
 * The token is never returned to the browser.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookie = request.cookies.get('meta_oauth_state')?.value;

  const fail = (reason: string) => {
    const res = NextResponse.redirect(
      new URL(`/home/clients?meta_error=${reason}`, request.url),
    );
    res.cookies.delete('meta_oauth_state');
    return res;
  };

  // Facebook can redirect back with an explicit denial.
  if (url.searchParams.get('error')) return fail('denied');
  if (!code || !state || !cookie) return fail('missing');

  const [cookieState, tenantId] = cookie.split('::');
  if (!cookieState || !tenantId || cookieState !== state) return fail('state');

  // Must be a logged-in member of the tenant. RLS makes the select return the
  // row ONLY if this user is a member — so this doubles as the authz check.
  const supabase = getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('auth');

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();
  if (!tenant) return fail('forbidden');

  // Exchange the code for a long-lived token + read granted scopes.
  let token: string;
  let scopes: string[];
  try {
    token = await exchangeCodeForLongLivedToken(code);
    scopes = await fetchGrantedScopes(token);
  } catch {
    return fail('exchange');
  }

  // Service-role for the token write (and the connection upsert, kept atomic-ish).
  const admin = getSupabaseServerAdminClient();

  const { data: conn } = await admin
    .from('tenant_platform_connections')
    .upsert(
      {
        tenant_id: tenantId,
        platform: 'meta',
        connection_status: 'connected',
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,platform' },
    )
    .select('id')
    .maybeSingle();

  // store_meta_token: Vault secret create/rotate + meta_tokens upsert (secret id
  // only). Not in generated types yet, so call is untyped.
  const { error } = await (admin as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: unknown }>;
  }).rpc('store_meta_token', {
    p_tenant: tenantId,
    p_connection: conn?.id ?? null,
    p_token: token,
    p_scopes: scopes,
  });
  if (error) return fail('store');

  const res = NextResponse.redirect(
    new URL('/home/clients?meta=connected', request.url),
  );
  res.cookies.delete('meta_oauth_state');
  return res;
}
