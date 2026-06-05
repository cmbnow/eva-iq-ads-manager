/*
 * ===========================================================================
 * Meta onboarding Step 3 — Vault token storage (server-only functions)
 * ---------------------------------------------------------------------------
 * The scoped Meta OAuth token is stored in Supabase Vault (encrypted at rest,
 * decryptable only by privileged DB roles). Vault lives in the `vault` schema,
 * which is NOT reachable by the PostgREST client. So we expose two thin
 * public wrappers, SECURITY DEFINER (run as owner), with EXECUTE granted ONLY
 * to service_role (revoked from public/anon/authenticated). The token therefore
 * never touches a browser role: server code (service_role) calls these; the
 * meta_tokens row holds only the Vault secret id.
 * ===========================================================================
 */

-- Vault is preinstalled on hosted Supabase; ensure it's enabled (guarded).
create extension if not exists supabase_vault with schema vault;

/* ---------------------------------------------------------------------------
 * store_meta_token — create or ROTATE the tenant's Vault secret, then upsert
 * meta_tokens with only the secret id + granted scopes. Returns nothing.
 * ------------------------------------------------------------------------- */
create or replace function public.store_meta_token(
    p_tenant     uuid,
    p_connection uuid,
    p_token      text,
    p_scopes     text[]
)
    returns void
    language plpgsql
    security definer
    set search_path = ''
as $$
declare
    v_existing  uuid;
    v_secret_id uuid;
    v_name      text := 'meta_token::' || p_tenant::text;
begin
    select meta_token_secret_id into v_existing
    from public.meta_tokens
    where tenant_id = p_tenant;

    if v_existing is null then
        v_secret_id := vault.create_secret(p_token, v_name, 'Meta OAuth long-lived token');
    else
        perform vault.update_secret(v_existing, p_token, v_name, 'Meta OAuth long-lived token');
        v_secret_id := v_existing;
    end if;

    insert into public.meta_tokens (tenant_id, connection_id, meta_token_secret_id, scopes, updated_at)
    values (p_tenant, p_connection, v_secret_id, coalesce(p_scopes, '{}'), now())
    on conflict (tenant_id) do update
        set connection_id        = excluded.connection_id,
            meta_token_secret_id  = excluded.meta_token_secret_id,
            scopes                = excluded.scopes,
            updated_at            = now();
end;
$$;

revoke all on function public.store_meta_token(uuid, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.store_meta_token(uuid, uuid, text, text[]) to service_role;

/* ---------------------------------------------------------------------------
 * get_meta_token — return the decrypted token for server-side Graph API calls.
 * service_role only; never exposed to the browser.
 * ------------------------------------------------------------------------- */
create or replace function public.get_meta_token(p_tenant uuid)
    returns text
    language plpgsql
    security definer
    set search_path = ''
as $$
declare
    v_secret_id uuid;
    v_token     text;
begin
    select meta_token_secret_id into v_secret_id
    from public.meta_tokens
    where tenant_id = p_tenant;

    if v_secret_id is null then
        return null;
    end if;

    select decrypted_secret into v_token
    from vault.decrypted_secrets
    where id = v_secret_id;

    return v_token;
end;
$$;

revoke all on function public.get_meta_token(uuid) from public, anon, authenticated;
grant execute on function public.get_meta_token(uuid) to service_role;
