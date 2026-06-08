/*
 * ===========================================================================
 * TicketTailor connection — per-tenant API key (Vault) + status + webhook.
 * Mirrors the Meta token pattern (20260605140000 + 20260605160000):
 *  - ticket_tailor_tokens: SERVER-ONLY secret pointer, no anon/authenticated grants.
 *  - ticket_tailor_connections: non-secret status the UI may read under RLS.
 *  - store/get RPCs put the key in Vault and return only a secret-id pointer.
 * The API key is NEVER stored in plaintext or in any client-readable column.
 * ===========================================================================
 */

-- Server-only pointer to the tenant's TicketTailor API key (key lives in Vault).
create table if not exists public.ticket_tailor_tokens
(
    id               uuid primary key default gen_random_uuid(),
    tenant_id        uuid not null unique references public.tenants (id) on delete cascade,
    tt_key_secret_id uuid not null,        -- Supabase Vault secret id, NOT the key
    webhook_secret   text,                 -- per-tenant secret for inbound webhook auth
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);
alter table public.ticket_tailor_tokens enable row level security;
revoke all on public.ticket_tailor_tokens from anon, authenticated;
grant all on public.ticket_tailor_tokens to service_role;
create trigger set_ticket_tailor_tokens_updated_at
    before update on public.ticket_tailor_tokens
    for each row execute function kit.set_updated_at();

-- Non-secret connection status the UI may read under RLS.
create table if not exists public.ticket_tailor_connections
(
    tenant_id      uuid primary key references public.tenants (id) on delete cascade,
    is_connected   boolean not null default false,
    last_synced_at timestamptz,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
alter table public.ticket_tailor_connections enable row level security;
create policy ticket_tailor_conn_tenant on public.ticket_tailor_connections
    for select to authenticated
    using (public.has_tenant_access(tenant_id));
revoke all on public.ticket_tailor_connections from anon;
grant select on public.ticket_tailor_connections to authenticated;
grant all on public.ticket_tailor_connections to service_role;
create trigger set_ticket_tailor_connections_updated_at
    before update on public.ticket_tailor_connections
    for each row execute function kit.set_updated_at();

/* ---------------------------------------------------------------------------
 * Vault store/get — service_role only, security definer (copy the meta shape).
 * ------------------------------------------------------------------------- */
create or replace function public.store_ticket_tailor_key(p_tenant uuid, p_key text)
    returns void
    language plpgsql
    security definer
    set search_path = ''
as $$
declare
    v_existing  uuid;
    v_secret_id uuid;
    v_name      text := 'tt_key::' || p_tenant::text;
begin
    select tt_key_secret_id into v_existing
    from public.ticket_tailor_tokens
    where tenant_id = p_tenant;

    if v_existing is null then
        v_secret_id := vault.create_secret(p_key, v_name, 'TicketTailor API key');
    else
        perform vault.update_secret(v_existing, p_key, v_name, 'TicketTailor API key');
        v_secret_id := v_existing;
    end if;

    insert into public.ticket_tailor_tokens (tenant_id, tt_key_secret_id, webhook_secret, updated_at)
    values (p_tenant, v_secret_id, gen_random_uuid()::text, now())
    on conflict (tenant_id) do update
        set tt_key_secret_id = excluded.tt_key_secret_id,
            updated_at = now(); -- keep the existing webhook_secret on reconnect
end;
$$;
revoke all on function public.store_ticket_tailor_key(uuid, text) from public, anon, authenticated;
grant execute on function public.store_ticket_tailor_key(uuid, text) to service_role;

create or replace function public.get_ticket_tailor_key(p_tenant uuid)
    returns text
    language plpgsql
    security definer
    set search_path = ''
as $$
declare
    v_secret_id uuid;
    v_key       text;
begin
    select tt_key_secret_id into v_secret_id
    from public.ticket_tailor_tokens
    where tenant_id = p_tenant;
    if v_secret_id is null then
        return null;
    end if;
    select decrypted_secret into v_key
    from vault.decrypted_secrets
    where id = v_secret_id;
    return v_key;
end;
$$;
revoke all on function public.get_ticket_tailor_key(uuid) from public, anon, authenticated;
grant execute on function public.get_ticket_tailor_key(uuid) to service_role;
