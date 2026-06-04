/*
 * Show Profitability Engine — saved offer analyses, tenant-scoped.
 */
create table if not exists public.show_analyses
(
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references public.tenants (id) on delete cascade,
    show_name   varchar(255) not null default 'Untitled show',
    show_date   date,
    inputs      jsonb not null default '{}'::jsonb,
    result      jsonb not null default '{}'::jsonb,
    deal_score  varchar(2),
    created_by  uuid references auth.users (id) on delete set null,
    created_at  timestamptz not null default now()
);
create index show_analyses_tenant_idx on public.show_analyses (tenant_id, created_at desc);

alter table public.show_analyses enable row level security;
create policy show_analyses_all on public.show_analyses for all to authenticated
    using (public.has_tenant_access(tenant_id)) with check (public.has_tenant_access(tenant_id));
grant select, insert, update, delete on public.show_analyses to authenticated, service_role;
