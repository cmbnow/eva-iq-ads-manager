/*
 * Pre-onboarding Fix 2 — normalized ticket-tier structure for cross-show
 * reporting under multi-tenant. The app already reproduces a saved show's blend
 * exactly from show_analyses.inputs (JSONB: ticket_tiers + ticket_pricing_globals),
 * which remains the runtime source of truth. THIS table de-normalizes the same
 * tiers into rows so future reporting can query across shows without parsing JSON.
 *
 * Roll-forward plan (with the multi-tenant data-model / onboarding spec): dual-write
 * these rows on save alongside the JSONB. Until then the table can stay empty —
 * the app does not read from it yet.
 */

-- Pricing globals used for the blend, denormalized onto the show record so a
-- reloaded show reproduces the exact blend even from SQL (the app reads JSONB).
alter table public.show_analyses
    add column if not exists processor_pct        numeric,
    add column if not exists processor_flat       numeric,
    add column if not exists avg_tickets_per_order numeric;

create table if not exists public.show_ticket_tiers
(
    id                uuid primary key default gen_random_uuid(),
    show_id           uuid not null references public.show_analyses (id) on delete cascade,
    tenant_id         uuid not null references public.tenants (id) on delete cascade,
    name              varchar(255) not null default 'Tier',
    face_price        numeric not null default 0,
    fee               numeric not null default 0,
    -- fee_recipient is ONLY ever 'venue' or 'pass_through'. The artist NEVER
    -- receives any of the booking fee under either option.
    fee_recipient     varchar(16) not null default 'venue'
                        check (fee_recipient in ('venue', 'pass_through')),
    capacity          integer not null default 0,
    expected_mix_pct  numeric,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);
create index show_ticket_tiers_show_idx on public.show_ticket_tiers (show_id);
create index show_ticket_tiers_tenant_idx on public.show_ticket_tiers (tenant_id);

alter table public.show_ticket_tiers enable row level security;
create policy show_ticket_tiers_all on public.show_ticket_tiers for all to authenticated
    using (public.has_tenant_access(tenant_id)) with check (public.has_tenant_access(tenant_id));
grant select, insert, update, delete on public.show_ticket_tiers to authenticated, service_role;
