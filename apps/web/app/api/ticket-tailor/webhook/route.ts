import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { createHash } from 'node:crypto';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { syncEventCounts } from '~/lib/server/ticket-tailor/sync';

import {
  isCountRefreshEvent,
  isEventMetaEvent,
  pickEventMeta,
  pickWebhookEventId,
  secretsMatch,
} from './parse';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/ticket-tailor/webhook?t=<tenant_id>&s=<webhook_secret>
 * Receives TicketTailor order/ticket events. Tenant is resolved EXPLICITLY from
 * the query tenant id AND only accepted if the provided secret matches the
 * tenant's stored webhook_secret — never trusting a tenant id from the body.
 * Buyers are upserted into the first-party store; the related event's counts are
 * re-pulled so B1's walk-up projection updates itself (cron is the backstop).
 */
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
  if (
    !tok?.webhook_secret ||
    !secretsMatch(secret, String(tok.webhook_secret))
  ) {
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
      metadata: {
        event_type: eventType,
        order_id: orderId ?? null,
        has_email: Boolean(email),
      },
    });
    await (admin as any)
      .from('ticket_tailor_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('tenant_id', tenantId);
  } catch {
    // Don't fail the webhook on a storage hiccup — TicketTailor would just retry.
  }

  // D2a: refresh the affected event's counts so total_issued (the field B1 reads)
  // stays current. Re-pull, not increment — authoritative every time. Failures
  // are swallowed; the reconcile cron is the correctness backstop.
  if (isCountRefreshEvent(eventType)) {
    const ttEventId = pickWebhookEventId(payload);
    if (ttEventId) {
      try {
        await syncEventCounts(admin, tenantId, ttEventId);
      } catch {
        /* cron will reconcile */
      }
    }
  } else if (isEventMetaEvent(eventType)) {
    // event.created/updated/deleted -> keep the event's metadata current.
    const meta = pickEventMeta(payload);
    if (meta) {
      try {
        await (admin as any).from('ticket_tailor_events').upsert(
          {
            tenant_id: tenantId,
            tt_event_id: meta.id,
            name: meta.name,
            event_date: meta.event_date,
          },
          { onConflict: 'tenant_id,tt_event_id' },
        );
      } catch {
        /* cron will reconcile */
      }
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
