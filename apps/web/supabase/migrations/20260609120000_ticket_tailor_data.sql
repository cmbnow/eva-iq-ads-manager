/*
 * ===========================================================================
 * TicketTailor data pull — per-tenant events + orders (the PULL + STORAGE).
 * Mirrors the connection migration (20260608130000):
 *  - both tables tenant-scoped, RLS SELECT via has_tenant_access, NO anon grant.
 *  - service_role does the writes (the sync runs server-side with the admin client).
 * Consumes nothing; later specs read total_issued (attendance), ordered_at
 * (sales pace), and the buyer list (audience seed / gender inference).
 * ===========================================================================
 */

begin;

create table if not exists public.ticket_tailor_events (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references public.tenants (id) on delete cascade,
    tt_event_id         text not null,
    name                text,
    event_date          date,
    total_issued        integer not null default 0,
    total_checked_in    integer not null default 0,
    gross_revenue_cents bigint  not null default 0,
    last_synced_at      timestamptz,
    unique (tenant_id, tt_event_id)
);
alter table public.ticket_tailor_events enable row level security;
drop policy if exists tt_events_tenant on public.ticket_tailor_events;
create policy tt_events_tenant on public.ticket_tailor_events
    for select to authenticated using (public.has_tenant_access(tenant_id));
revoke all on public.ticket_tailor_events from anon;
grant select on public.ticket_tailor_events to authenticated;
grant all on public.ticket_tailor_events to service_role;

create table if not exists public.ticket_tailor_orders (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants (id) on delete cascade,
    tt_event_id     text not null,
    tt_order_id     text not null,
    buyer_name      text,
    buyer_email     text,
    ticket_qty      integer not null default 0,
    amount_cents    bigint  not null default 0,
    ordered_at      timestamptz,
    inferred_gender text,
    unique (tenant_id, tt_order_id)
);
alter table public.ticket_tailor_orders enable row level security;
drop policy if exists tt_orders_tenant on public.ticket_tailor_orders;
create policy tt_orders_tenant on public.ticket_tailor_orders
    for select to authenticated using (public.has_tenant_access(tenant_id));
revoke all on public.ticket_tailor_orders from anon;
grant select on public.ticket_tailor_orders to authenticated;
grant all on public.ticket_tailor_orders to service_role;
create index if not exists tt_orders_event on public.ticket_tailor_orders (tenant_id, tt_event_id, ordered_at);

commit;

-- VERIFY: neither table grants anything to anon
select table_name, grantee from information_schema.role_table_grants
where table_name in ('ticket_tailor_events','ticket_tailor_orders') and grantee = 'anon';
-- expect 0 rows
