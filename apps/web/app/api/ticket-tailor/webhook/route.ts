import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/ticket-tailor/webhook?t=<tenant_id>&s=<webhook_secret>
 * Receives TicketTailor order/ticket events. Tenant is resolved EXPLICITLY from
 * the query tenant id AND only accepted if the provided secret matches the
 * tenant's stored webhook_secret — never trusting a tenant id from the body.
 * Buyers are upserted into the first-party store (source='tickettailor').
 */
function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('t');
  const secret = url.searchParams.get('s');
  if (!tenantId || !secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseServerAdminClient();

  // Verify the secret against the tenant's stored webhook_secret.
  const { data: tok } = await (admin as any)
    .from('ticket_tailor_tokens')
    .select('webhook_secret')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!tok?.webhook_secret || !secretsMatch(secret, String(tok.webhook_secret))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Parse best-effort; on any shape, store the event as a first-party record.
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* keep empty */
  }

  const eventType: string =
    body?.event ?? body?.type ?? body?.event_type ?? 'order.created';
  const payload = body?.payload ?? body;
  const email: string | undefined =
    payload?.email ??
    payload?.buyer_details?.email ??
    payload?.order?.buyer_details?.email ??
    payload?.buyer?.email;
  const orderId: string | undefined =
    payload?.id ?? payload?.order_id ?? payload?.order?.id;

  // Avoid storing raw PII: hash the email for the external_ref.
  const externalRef = email
    ? createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
    : (orderId ?? null);

  try {
    await (admin as any).from('tenant_data_records').insert({
      tenant_id: tenantId,
      record_type: 'ticket_purchase',
      external_ref: externalRef,
      source: 'tickettailor',
      is_first_party: true,
      consent_status: 'unknown',
      collected_at: new Date().toISOString(),
      metadata: { event_type: eventType, order_id: orderId ?? null, has_email: Boolean(email) },
    });
    await (admin as any)
      .from('ticket_tailor_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('tenant_id', tenantId);
  } catch {
    // Don't fail the webhook on a storage hiccup — TicketTailor would just retry.
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
