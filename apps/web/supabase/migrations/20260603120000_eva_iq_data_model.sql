/*
 * ===========================================================================
 * EVA IQ Ads Manager — Core data model (Step 6)
 * ---------------------------------------------------------------------------
 * Adds the multi-tenant foundation the spec requires (and the lite kit lacks):
 *   1. tenants                      -> the clients (Foundry = client #1)
 *   2. tenant_members              -> which login can manage which client
 *   3. tenant_platform_connections -> per-client, per-platform (Meta first)
 *                                     connection + enablement + capability tier
 *   4. tenant_data_records         -> first-party data records with MANDATORY
 *                                     consent status + provenance (spec §4/§12)
 * Plus a bug fix: deleting a login now auto-removes its leftover profile.
 *
 * Isolation is enforced by Row Level Security: a user only ever sees clients
 * they are a member of.
 * ===========================================================================
 */

/* ---------------------------------------------------------------------------
 * Section 0: Bug fix — orphaned account profiles on user delete
 * The kit creates a public.accounts row per login but never links it to
 * auth.users with a cascade, so deleting a login leaves the profile behind
 * (which blocked re-signup with the same email). Add the cascade link.
 * ------------------------------------------------------------------------- */
alter table public.accounts
    add constraint accounts_id_user_fkey
        foreign key (id) references auth.users (id) on delete cascade;

/* ---------------------------------------------------------------------------
 * Section 1: Enumerated types (the fixed sets of allowed values)
 * ------------------------------------------------------------------------- */

-- Special Ad Category. 'none' = a normal (non-restricted) client.
-- 'financial' covers the expanded financial products & services incl. insurance.
create type public.special_ad_category as enum (
    'none', 'housing', 'employment', 'credit', 'financial'
);

-- Ad platforms. Meta first; the others are placeholders for future modules.
create type public.ad_platform as enum (
    'meta', 'google', 'youtube', 'tiktok'
);

-- Whether/how a client's platform account is connected to our system.
create type public.platform_connection_status as enum (
    'not_connected', 'connected', 'disconnected', 'error'
);

-- What the system is allowed to DO for this client on this platform.
-- 'advisor'    = analyze + write, human publishes (no API needed)
-- 'managed'    = system publishes/manages (needs Meta Advanced Access + enablement)
-- 'autonomous' = ongoing optimization (the long-term differentiated mode)
create type public.capability_tier as enum (
    'advisor', 'managed', 'autonomous'
);

-- Consent state on a data record (Meta 2026 Data Source Declaration).
create type public.consent_status as enum (
    'granted', 'denied', 'unknown'
);

-- Role of a login within a client.
create type public.tenant_member_role as enum (
    'owner', 'admin', 'member'
);

/* ---------------------------------------------------------------------------
 * Shared helper: keep updated_at fresh on row updates
 * ------------------------------------------------------------------------- */
create or replace function kit.set_updated_at()
    returns trigger
    language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

/* ---------------------------------------------------------------------------
 * Section 2: tenants (the clients)
 * ------------------------------------------------------------------------- */
create table if not exists public.tenants
(
    id                   uuid primary key                  default gen_random_uuid(),
    name                 varchar(255)             not null,
    slug                 varchar(255) unique     not null,
    vertical             varchar(100),
    -- Tenant-level SAC default. Overridable per campaign later. Drives the
    -- compliant-mode container (lookalikes off, geo/age rules, creative-led).
    special_ad_category  public.special_ad_category not null default 'none',
    is_active            boolean                 not null default true,
    notes                text,
    public_data          jsonb                   not null default '{}'::jsonb,
    created_at           timestamptz             not null default now(),
    updated_at           timestamptz             not null default now(),
    created_by           uuid references auth.users,
    updated_by           uuid references auth.users
);

comment on table public.tenants is 'Clients (tenants). The Foundry is client #1. One ad-account house per client.';
comment on column public.tenants.special_ad_category is 'Tenant-level Special Ad Category default; campaign-overridable. Non-none routes into compliant SAC mode.';
comment on column public.tenants.vertical is 'Business vertical (e.g. venue, hospitality, real_estate) — drives non-SAC vs SAC strategy.';

create trigger set_tenants_updated_at
    before update on public.tenants
    for each row execute function kit.set_updated_at();

/* ---------------------------------------------------------------------------
 * Section 3: tenant_members (which login manages which client)
 * ------------------------------------------------------------------------- */
create table if not exists public.tenant_members
(
    id         uuid primary key default gen_random_uuid(),
    tenant_id  uuid not null references public.tenants (id) on delete cascade,
    user_id    uuid not null references auth.users (id) on delete cascade,
    role       public.tenant_member_role not null default 'member',
    created_at timestamptz not null default now(),
    unique (tenant_id, user_id)
);

comment on table public.tenant_members is 'Links a login (auth.users) to a client (tenant) and its role. Enforces data isolation.';

create index tenant_members_user_id_idx on public.tenant_members (user_id);
create index tenant_members_tenant_id_idx on public.tenant_members (tenant_id);

/* ---------------------------------------------------------------------------
 * Access helper: is the current user a member of this tenant?
 * SECURITY DEFINER so it can read tenant_members without tripping RLS
 * (prevents recursive policy evaluation).
 * ------------------------------------------------------------------------- */
create or replace function public.has_tenant_access(p_tenant_id uuid)
    returns boolean
    language sql
    security definer
    set search_path = ''
as $$
    select exists (
        select 1
        from public.tenant_members tm
        where tm.tenant_id = p_tenant_id
          and tm.user_id = (select auth.uid())
    );
$$;

grant execute on function public.has_tenant_access(uuid) to authenticated, service_role;

-- When a client is created, make the creator its owner automatically.
create or replace function kit.add_tenant_owner()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
as $$
declare
    owner_id uuid;
begin
    owner_id := coalesce((select auth.uid()), new.created_by);
    if owner_id is not null then
        insert into public.tenant_members (tenant_id, user_id, role)
        values (new.id, owner_id, 'owner')
        on conflict (tenant_id, user_id) do nothing;
    end if;
    return new;
end;
$$;

create trigger on_tenant_created
    after insert on public.tenants
    for each row execute function kit.add_tenant_owner();

/* ---------------------------------------------------------------------------
 * Section 4: tenant_platform_connections (Meta first)
 * The per-client switch that decides advisor vs managed/autonomous mode.
 * ------------------------------------------------------------------------- */
create table if not exists public.tenant_platform_connections
(
    id                    uuid primary key default gen_random_uuid(),
    tenant_id             uuid not null references public.tenants (id) on delete cascade,
    platform              public.ad_platform not null default 'meta',
    connection_status     public.platform_connection_status not null default 'not_connected',
    -- Platform-side enablement: the Foundry's is_ads_mcp_enabled=false "gradual
    -- rollout" wall lives here. False => degrade to advisor mode regardless.
    is_enabled            boolean not null default false,
    capability_tier       public.capability_tier not null default 'advisor',
    external_account_id   varchar(255),  -- e.g. Meta ad account id 1621147768656226
    external_account_name varchar(255),
    config                jsonb not null default '{}'::jsonb,
    connected_at          timestamptz,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    unique (tenant_id, platform)
);

comment on table public.tenant_platform_connections is 'Per-client, per-platform connection + platform enablement + capability tier. Drives graceful fallback to advisor mode.';
comment on column public.tenant_platform_connections.is_enabled is 'Platform has API/MCP-enabled this account. False => advisor mode only (e.g. Meta gradual rollout).';

create index tenant_platform_connections_tenant_id_idx on public.tenant_platform_connections (tenant_id);

create trigger set_tenant_platform_connections_updated_at
    before update on public.tenant_platform_connections
    for each row execute function kit.set_updated_at();

/* ---------------------------------------------------------------------------
 * Section 5: tenant_data_records (first-party data with mandatory consent)
 * Mostly empty until the audience engine is built, but the consent guardrail
 * exists from the first migration, per spec §4 and §12.
 * ------------------------------------------------------------------------- */
create table if not exists public.tenant_data_records
(
    id             uuid primary key default gen_random_uuid(),
    tenant_id      uuid not null references public.tenants (id) on delete cascade,
    record_type    varchar(100) not null,            -- buyer, lead, visitor, ticket_purchase, idx_signup...
    external_ref   varchar(500),                     -- hashed email / source id (avoid raw PII)
    -- Provenance + consent are MANDATORY (Meta 2026 Data Source Declaration).
    source         varchar(255) not null,            -- seetickets, toast, site_pixel, idx...
    is_first_party boolean not null default true,    -- spec §12: first-party only feeds Meta
    consent_status public.consent_status not null default 'unknown',
    consent_source varchar(500),                     -- where/how consent was captured
    collected_at   timestamptz,
    metadata       jsonb not null default '{}'::jsonb,
    created_at     timestamptz not null default now()
);

comment on table public.tenant_data_records is 'First-party data records (audience seeds/signals). Consent status + provenance required from day one.';
comment on column public.tenant_data_records.is_first_party is 'Spec §12: only first-party records may feed Meta audiences. Third-party data is legal-gated.';

create index tenant_data_records_tenant_id_idx on public.tenant_data_records (tenant_id);

/* ---------------------------------------------------------------------------
 * Section 6: Row Level Security — the data-isolation wall
 * ------------------------------------------------------------------------- */

-- tenants
alter table public.tenants enable row level security;

create policy tenants_read on public.tenants
    for select to authenticated
    using (public.has_tenant_access(id));

create policy tenants_insert on public.tenants
    for insert to authenticated
    with check ((select auth.uid()) is not null);

create policy tenants_update on public.tenants
    for update to authenticated
    using (public.has_tenant_access(id))
    with check (public.has_tenant_access(id));

create policy tenants_delete on public.tenants
    for delete to authenticated
    using (public.has_tenant_access(id));

grant select, insert, update, delete on public.tenants to authenticated, service_role;

-- tenant_members (read your memberships / co-members; changes via service_role or owner trigger)
alter table public.tenant_members enable row level security;

create policy tenant_members_read on public.tenant_members
    for select to authenticated
    using (user_id = (select auth.uid()) or public.has_tenant_access(tenant_id));

grant select on public.tenant_members to authenticated;
grant select, insert, update, delete on public.tenant_members to service_role;

-- tenant_platform_connections
alter table public.tenant_platform_connections enable row level security;

create policy tpc_read on public.tenant_platform_connections
    for select to authenticated using (public.has_tenant_access(tenant_id));
create policy tpc_insert on public.tenant_platform_connections
    for insert to authenticated with check (public.has_tenant_access(tenant_id));
create policy tpc_update on public.tenant_platform_connections
    for update to authenticated using (public.has_tenant_access(tenant_id))
    with check (public.has_tenant_access(tenant_id));
create policy tpc_delete on public.tenant_platform_connections
    for delete to authenticated using (public.has_tenant_access(tenant_id));

grant select, insert, update, delete on public.tenant_platform_connections to authenticated, service_role;

-- tenant_data_records
alter table public.tenant_data_records enable row level security;

create policy tdr_read on public.tenant_data_records
    for select to authenticated using (public.has_tenant_access(tenant_id));
create policy tdr_insert on public.tenant_data_records
    for insert to authenticated with check (public.has_tenant_access(tenant_id));
create policy tdr_update on public.tenant_data_records
    for update to authenticated using (public.has_tenant_access(tenant_id))
    with check (public.has_tenant_access(tenant_id));
create policy tdr_delete on public.tenant_data_records
    for delete to authenticated using (public.has_tenant_access(tenant_id));

grant select, insert, update, delete on public.tenant_data_records to authenticated, service_role;
