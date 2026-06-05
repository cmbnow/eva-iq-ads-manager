'use server';

import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { fetchAdAccounts } from './graph';

export type DiscoveredAccount = {
  id: string;
  meta_account_id: string;
  name: string | null;
  is_selected: boolean;
  is_ads_mcp_enabled: boolean;
  is_queryable: boolean;
  data_path: 'mcp' | 'csv';
  pixel_id: string | null;
};

/** Resolve the tenant for the signed-in user (RLS-scoped to their memberships). */
async function currentTenantId(): Promise<string | null> {
  const supabase = getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function listAdAccounts(): Promise<DiscoveredAccount[]> {
  const tenantId = await currentTenantId();
  if (!tenantId) return [];
  const supabase = getSupabaseServerClient(); // RLS-scoped read
  const { data } = await supabase
    .from('ad_accounts')
    .select(
      'id, meta_account_id, name, is_selected, is_ads_mcp_enabled, is_queryable, data_path, pixel_id',
    )
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });
  return (data ?? []) as DiscoveredAccount[];
}

/**
 * Discover the connected Meta account's ad accounts and persist each (§4.3).
 * Token is read server-side via the service_role-only get_meta_token function.
 * is_ads_mcp_enabled is NOT detectable from the app's Graph access (Meta exposes
 * no such field, and the Ads MCP isn't callable from the app runtime), so new
 * rows default to false => data_path 'csv' (the safe degrade, correct for
 * Foundry). A manually-set true is preserved across re-discovery.
 */
export async function discoverAdAccounts(): Promise<
  { ok: true; accounts: DiscoveredAccount[] } | { ok: false; error: string }
> {
  const tenantId = await currentTenantId();
  if (!tenantId) return { ok: false, error: 'Please sign in and try again.' };

  const admin = getSupabaseServerAdminClient();

  // service_role-only: decrypt the tenant's Meta token from Vault.
  const { data: token, error: tErr } = await (
    admin as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: string | null; error: unknown }>;
    }
  ).rpc('get_meta_token', { p_tenant: tenantId });
  if (tErr || !token) {
    return { ok: false, error: 'Connect Meta first — no stored token was found.' };
  }

  let accounts;
  try {
    accounts = await fetchAdAccounts(token);
  } catch {
    return {
      ok: false,
      error:
        'Could not read ad accounts from Meta. Reconnect Meta and try again.',
    };
  }

  const { data: conn } = await admin
    .from('tenant_platform_connections')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('platform', 'meta')
    .maybeSingle();

  for (const a of accounts) {
    // Upsert without is_ads_mcp_enabled / data_path / is_selected, so an existing
    // manual flag or prior selection is preserved; new rows take column defaults
    // (is_ads_mcp_enabled=false, data_path='csv', is_selected=false).
    await admin.from('ad_accounts').upsert(
      {
        tenant_id: tenantId,
        connection_id: conn?.id ?? null,
        meta_account_id: a.meta_account_id,
        name: a.name,
        is_queryable: a.account_status === 1,
        discovered_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,meta_account_id' },
    );
  }

  return { ok: true, accounts: await listAdAccounts() };
}

/**
 * Persist the operator's choice of the ONE account EVA-IQ manages (§4.4), and
 * route the MCP/CSV branch: data_path = is_ads_mcp_enabled ? 'mcp' : 'csv'.
 * Reflects the choice onto the connection record (capability tier + enabled).
 */
export async function selectAdAccount(
  rowId: string,
): Promise<
  { ok: true; account: DiscoveredAccount } | { ok: false; error: string }
> {
  const tenantId = await currentTenantId();
  if (!tenantId) return { ok: false, error: 'Please sign in and try again.' };

  const admin = getSupabaseServerAdminClient();

  const { data: row } = await admin
    .from('ad_accounts')
    .select('id, is_ads_mcp_enabled, meta_account_id, name')
    .eq('id', rowId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'That account was not found.' };

  const dataPath: 'mcp' | 'csv' = row.is_ads_mcp_enabled ? 'mcp' : 'csv';

  // Two steps so the one-selected-per-tenant unique index never sees two trues.
  await admin
    .from('ad_accounts')
    .update({ is_selected: false })
    .eq('tenant_id', tenantId);
  await admin
    .from('ad_accounts')
    .update({ is_selected: true, data_path: dataPath })
    .eq('id', rowId);

  // Reflect onto the connection record.
  await admin
    .from('tenant_platform_connections')
    .update({
      external_account_id: row.meta_account_id,
      external_account_name: row.name,
      is_enabled: row.is_ads_mcp_enabled,
      capability_tier: row.is_ads_mcp_enabled ? 'managed' : 'advisor',
    })
    .eq('tenant_id', tenantId)
    .eq('platform', 'meta');

  const accounts = await listAdAccounts();
  const account = accounts.find((a) => a.id === rowId);
  if (!account) return { ok: false, error: 'Selection saved but could not be reloaded.' };
  return { ok: true, account };
}
