'use server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { getTenantContext } from '~/lib/server/ai';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TT = 'https://api.tickettailor.com/v1';

async function getKey(tenantId: string): Promise<string | null> {
  const admin = getSupabaseServerAdminClient();
  const { data } = await (admin as any).rpc('get_ticket_tailor_key', {
    p_tenant: tenantId,
  });
  return (data as string) ?? null;
}

async function ttGet(key: string, path: string): Promise<any> {
  const auth = Buffer.from(`${key}:`).toString('base64');
  const r = await fetch(`${TT}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  // Never include the key (or the Authorization header) in the thrown message.
  if (!r.ok) throw new Error(`Ticket Tailor ${r.status} on ${path}`);
  return r.json();
}

// Paginate a TT list endpoint (limit + starting_after cursor on id).
// Verified against the live v1 docs: list responses are { data: [...],
// links: { next, previous } } and pagination is cursor-based on object id.
async function ttList(key: string, basePath: string): Promise<any[]> {
  const out: any[] = [];
  let after: string | undefined;
  for (let i = 0; i < 50; i++) {
    const sep = basePath.includes('?') ? '&' : '?';
    const page = await ttGet(
      key,
      `${basePath}${sep}limit=100${after ? `&starting_after=${after}` : ''}`,
    );
    const items = page.data ?? [];
    out.push(...items);
    if (!items.length || !page.links?.next) break;
    after = items[items.length - 1].id;
  }
  return out;
}

export async function syncTicketTailorEvents(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  const { tenant } = await getTenantContext();
  if (!tenant) return { ok: false, error: 'No client found.' };
  const key = await getKey(tenant.id);
  if (!key) return { ok: false, error: 'Connect Ticket Tailor first.' };
  const admin = getSupabaseServerAdminClient();

  const events = await ttList(key, '/events');
  for (const e of events) {
    await (admin as any).from('ticket_tailor_events').upsert(
      {
        tenant_id: tenant.id,
        tt_event_id: String(e.id),
        name: e.name ?? null,
        event_date: e.start?.date ?? null,
      },
      { onConflict: 'tenant_id,tt_event_id' },
    );
  }
  return { ok: true, count: events.length };
}

export async function syncTicketTailorEvent(
  ttEventId: string,
): Promise<
  | { ok: true; issued: number; checkedIn: number; revenueCents: number }
  | { ok: false; error: string }
> {
  const { tenant } = await getTenantContext();
  if (!tenant) return { ok: false, error: 'No client found.' };
  const key = await getKey(tenant.id);
  if (!key) return { ok: false, error: 'Connect Ticket Tailor first.' };
  const admin = getSupabaseServerAdminClient();

  const issued = await ttList(key, `/issued_tickets?event_id=${ttEventId}`);
  // VERIFIED against live TT v1 docs: an issued ticket's status is
  // 'valid' | 'voided' (NOT 'void'), and checked_in is the STRING "true"/"false"
  // (NOT a boolean). The connection spec's `!== 'void'` / `!!t.checked_in` would
  // count voided tickets as sold and every ticket as checked-in.
  const valid = issued.filter((t) => t.status !== 'voided');
  const isCheckedIn = (t: any) =>
    t.checked_in === true || t.checked_in === 'true';
  const checkedIn = valid.filter(isCheckedIn).length;

  const orders = await ttList(key, `/orders?event_id=${ttEventId}`);
  let revenueCents = 0;
  for (const o of orders) {
    // VERIFIED: order `total` is an integer in cents (currency base_multiplier
    // 100), and `created_at` is a Unix epoch in SECONDS (e.g. 1587042691).
    const amount = Number(o.total ?? 0);
    revenueCents += amount;
    await (admin as any).from('ticket_tailor_orders').upsert(
      {
        tenant_id: tenant.id,
        tt_event_id: String(ttEventId),
        tt_order_id: String(o.id),
        buyer_name: o.buyer_details?.name ?? null,
        buyer_email: o.buyer_details?.email ?? null,
        ticket_qty: o.issued_tickets?.length ?? o.line_items?.length ?? 0,
        amount_cents: amount,
        ordered_at: o.created_at
          ? new Date(Number(o.created_at) * 1000).toISOString()
          : null,
      },
      { onConflict: 'tenant_id,tt_order_id' },
    );
  }

  await (admin as any)
    .from('ticket_tailor_events')
    .update({
      total_issued: valid.length,
      total_checked_in: checkedIn,
      gross_revenue_cents: revenueCents,
      last_synced_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenant.id)
    .eq('tt_event_id', String(ttEventId));

  return { ok: true, issued: valid.length, checkedIn, revenueCents };
}

export type TicketTailorEventRow = {
  tt_event_id: string;
  name: string | null;
  event_date: string | null;
  total_issued: number;
  total_checked_in: number;
  gross_revenue_cents: number;
  last_synced_at: string | null;
};

// Read the tenant's events through the RLS-scoped client (authenticated SELECT
// is granted; a second tenant cannot read the first tenant's rows).
export async function listTicketTailorEvents(): Promise<
  TicketTailorEventRow[]
> {
  const { supabase, tenant } = await getTenantContext();
  if (!tenant) return [];
  const { data } = await (supabase as any)
    .from('ticket_tailor_events')
    .select(
      'tt_event_id, name, event_date, total_issued, total_checked_in, gross_revenue_cents, last_synced_at',
    )
    .eq('tenant_id', tenant.id)
    .order('event_date', { ascending: false });
  return (data as TicketTailorEventRow[]) ?? [];
}
