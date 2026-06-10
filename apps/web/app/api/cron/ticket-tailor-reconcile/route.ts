import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { syncEventCounts } from '~/lib/server/ticket-tailor/sync';

import { isAuthorizedCron } from './auth';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/ticket-tailor-reconcile — correctness backstop for the webhook.
 * Webhooks get missed, duplicated, or arrive before a tenant configures them, so
 * every 15 min (vercel.json) we re-pull counts for upcoming events of every
 * connected tenant. Cheap, idempotent, eventual-correct. Guarded by CRON_SECRET
 * (Vercel cron sends `authorization: Bearer <CRON_SECRET>`).
 */
export async function GET(request: NextRequest) {
  if (
    !isAuthorizedCron(
      request.headers.get('authorization'),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseServerAdminClient();

  const { data: conns } = await (admin as any)
    .from('ticket_tailor_connections')
    .select('tenant_id')
    .eq('is_connected', true);

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  let synced = 0;
  for (const c of (conns ?? []) as Array<{ tenant_id: string }>) {
    const { data: events } = await (admin as any)
      .from('ticket_tailor_events')
      .select('tt_event_id')
      .eq('tenant_id', c.tenant_id)
      .gte('event_date', today);
    for (const e of (events ?? []) as Array<{ tt_event_id: string }>) {
      try {
        await syncEventCounts(
          admin,
          String(c.tenant_id),
          String(e.tt_event_id),
        );
        synced++;
      } catch {
        /* keep going; the next run reconciles */
      }
    }
  }

  return NextResponse.json({ ok: true, synced }, { status: 200 });
}
