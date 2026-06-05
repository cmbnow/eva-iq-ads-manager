import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { metaAuthorizeUrl } from '~/lib/server/meta/oauth';

/**
 * GET /api/meta/oauth/start
 * Kicks off the Meta consent flow: generate a CSRF `state`, stash it (with the
 * tenant id) in an httpOnly cookie, and redirect the browser to Facebook.
 * No token handling here — that's the callback.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/auth/sign-in', request.url));
  }

  // Resolve the tenant this user manages (RLS returns only their own).
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!tenant) {
    return NextResponse.redirect(new URL('/home/clients', request.url));
  }

  let authorizeUrl: string;
  const state = `${crypto.randomUUID()}.${crypto.randomUUID()}`;
  try {
    authorizeUrl = metaAuthorizeUrl(state);
  } catch {
    // META_APP_ID / site URL not configured yet.
    return NextResponse.redirect(
      new URL('/home/clients?meta_error=config', request.url),
    );
  }

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set('meta_oauth_state', `${state}::${tenant.id}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });
  return res;
}
