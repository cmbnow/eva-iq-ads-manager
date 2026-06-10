-- Vault token helpers created by hand during the connection-spine work.
-- Captured verbatim from the live prod schema (schema-drift guard, run #2 on
-- commit 96585c1) so the committed migrations match prod. CREATE OR REPLACE
-- makes this idempotent against the already-applied functions.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_meta_token(p_tenant uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_secret_id uuid; v_token text;
begin
    select meta_token_secret_id into v_secret_id from public.meta_tokens where tenant_id = p_tenant;
    if v_secret_id is null then return null; end if;
    select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret_id;
    return v_token;
end; $function$
;

CREATE OR REPLACE FUNCTION public.get_ticket_tailor_key(p_tenant uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_secret_id uuid; v_key text;
begin
    select tt_key_secret_id into v_secret_id from public.ticket_tailor_tokens where tenant_id = p_tenant;
    if v_secret_id is null then return null; end if;
    select decrypted_secret into v_key from vault.decrypted_secrets where id = v_secret_id;
    return v_key;
end; $function$
;

CREATE OR REPLACE FUNCTION public.store_meta_token(p_tenant uuid, p_connection uuid, p_token text, p_scopes text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_existing uuid; v_secret_id uuid;
    v_name text := 'meta_token::' || p_tenant::text;
begin
    select meta_token_secret_id into v_existing from public.meta_tokens where tenant_id = p_tenant;
    if v_existing is null then
        v_secret_id := vault.create_secret(p_token, v_name, 'Meta OAuth long-lived token');
    else
        perform vault.update_secret(v_existing, p_token, v_name, 'Meta OAuth long-lived token');
        v_secret_id := v_existing;
    end if;
    insert into public.meta_tokens (tenant_id, connection_id, meta_token_secret_id, scopes, updated_at)
    values (p_tenant, p_connection, v_secret_id, coalesce(p_scopes,'{}'), now())
    on conflict (tenant_id) do update
        set connection_id = excluded.connection_id,
            meta_token_secret_id = excluded.meta_token_secret_id,
            scopes = excluded.scopes, updated_at = now();
end; $function$
;

CREATE OR REPLACE FUNCTION public.store_ticket_tailor_key(p_tenant uuid, p_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_existing uuid; v_secret_id uuid; v_name text := 'tt_key::' || p_tenant::text;
begin
    select tt_key_secret_id into v_existing from public.ticket_tailor_tokens where tenant_id = p_tenant;
    if v_existing is null then
        v_secret_id := vault.create_secret(p_key, v_name, 'TicketTailor API key');
    else
        perform vault.update_secret(v_existing, p_key, v_name, 'TicketTailor API key');
        v_secret_id := v_existing;
    end if;
    insert into public.ticket_tailor_tokens (tenant_id, tt_key_secret_id, webhook_secret, updated_at)
    values (p_tenant, v_secret_id, gen_random_uuid()::text, now())
    on conflict (tenant_id) do update set tt_key_secret_id = excluded.tt_key_secret_id, updated_at = now();
end; $function$
;
