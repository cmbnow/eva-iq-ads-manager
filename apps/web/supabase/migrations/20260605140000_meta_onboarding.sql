/*
 * ===========================================================================
 * Meta onboarding (spec §3) — Step 2: schema + RLS
 * ---------------------------------------------------------------------------
 * Source of truth: tenant_platform_connections (tpc) remains the SINGLE Meta
 * connection record and is LEFT UNTOUCHED — connection state only (status,
 * is_enabled, capability_tier, external account id/name, connected_at).
 *
 * TOKEN SAFETY (hard rule): the scoped Meta OAuth token is stored in Supabase
 * Vault (encrypted; service_role-only). The POINTER to it lives in a dedicated
 * server-only table `meta_tokens` that has NO grants to anon/authenticated —
 * service_role only, with RLS enabled (default-deny) for defense-in-depth.
 * Nothing token-related is reachable by any browser role, so there is no
 * table-vs-column grant subtlety to get wrong.
 *
 * Adds: meta_tokens (token pointer), ad_accounts (multi-account picker + the
 * load-bearing MCP/CSV capability branch). Reuses show_analyses (already
 * tenant_id + RLS) and the ticket-tier rows from 20260605120000.
 * ===========================================================================
 */

/* ---------------------------------------------------------------------------
 * Section 1: Enums
 * ------------------------------------------------------------------------- */
-- Which data path the selected account runs on (the §4 load-bearing branch).
create type public.account_data_path as enum ('mcp', 'csv');
-- The event analyze.ts / the engine scope to. IC is the default (NEVER Purchase
-- hard-coded) per the established rule.
create type public.optimization_event as enum ('purchase', 'initiate_checkout');

/* ---------------------------------------------------------------------------
 * Section 2: meta_tokens — SERVER-ONLY token pointer (no client role access)
 * The actual token sits in Supabase Vault; this row holds only the Vault
 * secret id + the scopes granted. service_role writes/reads it; authenticated
 * and anon get NOTHING (no grant + RLS default-deny).
 * ------------------------------------------------------------------------- */
create table if not exists public.meta_tokens
(
    id                   uuid primary key default gen_random_uuid(),
    tenant_id            uuid not null references public.tenants (id) on delete cascade,
    connection_id        uuid references public.tenant_platform_connections (id) on delete cascade,
    -- Supabase Vault secret id for the scoped Meta OAuth token. Never the token.
    meta_token_secret_id uuid not null,
    scopes               text[] not null default '{}',
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    unique (tenant_id)
);

comment on table public.meta_tokens is
    'SERVER-ONLY pointer to a tenant''s scoped Meta OAuth token. The token itself '
    'lives in Supabase Vault (service_role-decryptable). This table has no grants '
    'to anon/authenticated and RLS is on (default-deny) — defense-in-depth so a '
    'token reference can never reach a browser.';

create trigger set_meta_tokens_updated_at
    before update on public.meta_tokens
    for each row execute function kit.set_updated_at();

-- Defense-in-depth: RLS on, and NO policy for authenticated/anon => default-deny.
-- service_role bypasses RLS and is the only role with a grant (below).
alter table public.meta_tokens enable row level security;

-- Strip any inherited default privileges, then grant ONLY to service_role.
revoke all on public.meta_tokens from anon, authenticated;
grant all on public.meta_tokens to service_role;

/* ---------------------------------------------------------------------------
 * Section 3: ad_accounts (spec §3) — discovered accounts + capability branch
 * ------------------------------------------------------------------------- */
create table if not exists public.ad_accounts
(
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references public.tenants (id) on delete cascade,
    connection_id       uuid references public.tenant_platform_connections (id) on delete set null,
    meta_account_id     varchar(255) not null,
    name                varchar(255),
    -- the ONE account EVA-IQ manages for this tenant (enforced unique below)
    is_selected         boolean not null default false,
    -- cached from discovery; drives the §4 branch. Never assumed — detected.
    is_ads_mcp_enabled  boolean not null default false,
    is_queryable        boolean not null default false,
    -- 'csv' is the safe degrade until discovery proves 'mcp'.
    data_path           public.account_data_path  not null default 'csv',
    pixel_id            varchar(255),
    optimization_event  public.optimization_event not null default 'initiate_checkout',
    discovered_at       timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (tenant_id, meta_account_id)
);

comment on table public.ad_accounts is
    'Meta ad accounts discovered for a tenant. is_selected = the one EVA-IQ manages. '
    'is_ads_mcp_enabled + data_path drive the load-bearing MCP/CSV branch (spec §4.4).';

create index ad_accounts_tenant_id_idx on public.ad_accounts (tenant_id);
-- At most ONE selected account per tenant.
create unique index ad_accounts_one_selected_per_tenant
    on public.ad_accounts (tenant_id) where is_selected;

create trigger set_ad_accounts_updated_at
    before update on public.ad_accounts
    for each row execute function kit.set_updated_at();

-- RLS: members of the tenant only (same pattern as every other domain table).
alter table public.ad_accounts enable row level security;

create policy ad_accounts_read on public.ad_accounts
    for select to authenticated using (public.has_tenant_access(tenant_id));
create policy ad_accounts_insert on public.ad_accounts
    for insert to authenticated with check (public.has_tenant_access(tenant_id));
create policy ad_accounts_update on public.ad_accounts
    for update to authenticated using (public.has_tenant_access(tenant_id))
    with check (public.has_tenant_access(tenant_id));
create policy ad_accounts_delete on public.ad_accounts
    for delete to authenticated using (public.has_tenant_access(tenant_id));

grant select, insert, update, delete on public.ad_accounts to authenticated, service_role;

-- Supabase's platform default privileges auto-grant new public tables to `anon`.
-- RLS already blocks anon, but strip the grant anyway (defense-in-depth). tpc is
-- corrected here too since the base kit only revoked anon on install-time tables.
revoke all on public.ad_accounts                 from anon;
revoke all on public.tenant_platform_connections from anon;
