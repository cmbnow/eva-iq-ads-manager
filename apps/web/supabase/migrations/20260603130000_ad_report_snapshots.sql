/*
 * Ad report snapshots — the Meta Advisor's "memory".
 * Each CSV upload is stored as a snapshot so we can compare period-over-period
 * and build a running history (no live Meta/MCP connection needed).
 */
create table if not exists public.ad_report_snapshots
(
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references public.tenants (id) on delete cascade,
    platform        public.ad_platform not null default 'meta',
    period_start    text,
    period_end      text,
    file_name       text,
    total_spend     numeric,
    total_revenue   numeric,
    total_purchases integer,
    blended_roas    numeric,
    blended_cpp     numeric,
    summary         jsonb not null default '{}'::jsonb,
    ads             jsonb not null default '[]'::jsonb,
    uploaded_at     timestamptz not null default now(),
    created_by      uuid references auth.users
);

comment on table public.ad_report_snapshots is 'Stored CSV upload snapshots per client — powers period-over-period comparison and history.';

create index ad_report_snapshots_tenant_idx
    on public.ad_report_snapshots (tenant_id, uploaded_at desc);

alter table public.ad_report_snapshots enable row level security;

create policy ars_read on public.ad_report_snapshots
    for select to authenticated using (public.has_tenant_access(tenant_id));
create policy ars_insert on public.ad_report_snapshots
    for insert to authenticated with check (public.has_tenant_access(tenant_id));
create policy ars_delete on public.ad_report_snapshots
    for delete to authenticated using (public.has_tenant_access(tenant_id));

grant select, insert, delete on public.ad_report_snapshots
    to authenticated, service_role;
