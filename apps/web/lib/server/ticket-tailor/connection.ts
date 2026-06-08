'use server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { getTenantContext } from '~/lib/server/ai';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SaveKeyResult = { ok: true } | { ok: false; error: string };

/**
 * Validate the key against TicketTailor (HTTP Basic, key as username, empty
 * password), then store it ENCRYPTED in Vault via the service_role-only RPC.
 * The key is never returned, rendered, or logged.
 */
export async function saveTicketTailorKey(key: string): Promise<SaveKeyResult> {
  const { tenant } = await getTenantContext();
  if (!tenant) return { ok: false, error: 'No client found.' };

  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: 'Enter your API key.' };

  // Verify before storing.
  const auth = Buffer.from(`${trimmed}:`).toString('base64');
  let r: Response;
  try {
    r = await fetch('https://api.tickettailor.com/v1/events?limit=1', {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return { ok: false, error: 'Could not reach TicketTailor. Try again.' };
  }
  if (r.status === 401) return { ok: false, error: 'TicketTailor rejected that key.' };
  if (!r.ok) return { ok: false, error: `Could not reach TicketTailor (${r.status}).` };

  // service_role RPC → Vault.
  const admin = getSupabaseServerAdminClient();
  const { error: rpcErr } = await (admin as any).rpc('store_ticket_tailor_key', {
    p_tenant: tenant.id,
    p_key: trimmed,
  });
  if (rpcErr) return { ok: false, error: 'Could not store the key securely. Try again.' };

  await (admin as any)
    .from('ticket_tailor_connections')
    .upsert({
      tenant_id: tenant.id,
      is_connected: true,
      updated_at: new Date().toISOString(),
    });

  return { ok: true };
}

export async function getTicketTailorStatus(): Promise<{
  connected: boolean;
  lastSyncedAt: string | null;
  webhookUrl: string;
}> {
  const { supabase, tenant } = await getTenantContext();
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  if (!tenant) return { connected: false, lastSyncedAt: null, webhookUrl: '' };

  const { data: conn } = await (supabase as any)
    .from('ticket_tailor_connections')
    .select('is_connected, last_synced_at')
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  // The webhook URL carries the tenant id + the per-tenant secret (read via
  // service_role — not exposed to the browser except as this paste-in URL).
  let webhookUrl = '';
  if (conn?.is_connected) {
    const admin = getSupabaseServerAdminClient();
    const { data: tok } = await (admin as any)
      .from('ticket_tailor_tokens')
      .select('webhook_secret')
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    if (tok?.webhook_secret) {
      webhookUrl = `${site}/api/ticket-tailor/webhook?t=${tenant.id}&s=${tok.webhook_secret}`;
    }
  }

  return {
    connected: Boolean(conn?.is_connected),
    lastSyncedAt: (conn?.last_synced_at as string) ?? null,
    webhookUrl,
  };
}
