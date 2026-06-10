/*
 * ===========================================================================
 * Show <-> TicketTailor event data model (drop-in spec).
 * Foundation for onboarding + the B1.5 DOS-projection layer. A show = the SUM
 * of its TicketTailor events (advance + day-of-sale). No consuming code here —
 * just the data shape: classification, recurring series, event<->show links,
 * poisoned-show flag, a sum-over-events view, and an attendance source.
 *
 * NOTE: the June 5 exclusion is seeded BY HAND (the row id is not guessed) —
 * see the companion UPDATE provided with this change, run after migrating.
 * ===========================================================================
 */

begin;

-- Fix 0 — classify the bookable entity (format + monetization). Independent axes.
alter table public.show_analyses
    add column if not exists format       text not null default 'music_show',
    add column if not exists monetization text not null default 'paid';
comment on column public.show_analyses.format is
    'Descriptive label only (music_show | dance_class | trivia | social | other; free-text). Drives ad creative/targeting + reporting. Does NOT route the engine — offer_structure does.';
comment on column public.show_analyses.monetization is
    'paid | free. Routes ads (free => separate $0-value campaign, never the paid IC pixel) and tells the engine ticket revenue may be $0 (value from F&B + attendance).';

-- Fix 0b — recurring programming: a series template that emits dated occurrences.
create table if not exists public.event_series
(
    id           uuid primary key default gen_random_uuid(),
    tenant_id    uuid not null references public.tenants (id) on delete cascade,
    name         text not null,
    format       text not null default 'other',
    monetization text not null default 'paid',
    cadence      text,
    is_active    boolean not null default true,
    created_at   timestamptz not null default now()
);
alter table public.event_series enable row level security;
drop policy if exists event_series_tenant on public.event_series;
create policy event_series_tenant on public.event_series
    for all to authenticated
    using (public.has_tenant_access(tenant_id))
    with check (public.has_tenant_access(tenant_id));
revoke all on public.event_series from anon;
grant select, insert, update, delete on public.event_series to authenticated, service_role;

alter table public.show_analyses
    add column if not exists series_id uuid references public.event_series (id) on delete set null;
create index if not exists show_analyses_series_idx on public.show_analyses (series_id);

-- Fix 1 — link events to a show + tag the role.
do $$
begin
    if not exists (select 1 from pg_type where typname = 'tt_event_role') then
        create type public.tt_event_role as enum
            ('advance', 'day_of_sale', 'general', 'unmapped');
    end if;
end $$;

alter table public.ticket_tailor_events
    add column if not exists show_id    uuid references public.show_analyses (id) on delete set null,
    add column if not exists event_role public.tt_event_role not null default 'unmapped';
create index if not exists ticket_tailor_events_show_idx on public.ticket_tailor_events (show_id);

-- Fix 2 — mark poisoned shows out of learning (June 5 seeded by hand, post-migrate).
alter table public.show_analyses
    add column if not exists exclude_from_learning boolean not null default false,
    add column if not exists exclude_reason        text;

-- Fix 5 — manual attendance source for non-ticketed nights.
alter table public.show_analyses
    add column if not exists door_count integer;
comment on column public.show_analyses.door_count is
    'Manual headcount for non-ticketed nights. effective_attendance = coalesce(nullif(checked_in,0), door_count). Neither present => attendance UNKNOWN (not 0).';

-- Fix 3 — show actuals = SUM over linked events. security_invoker so the view
-- runs with the caller's RLS (without it the view runs as owner and LEAKS across
-- tenants — the acceptance requires a cross-tenant select to return 0 rows).
create or replace view public.show_ticket_actuals
    with (security_invoker = true) as
select
    s.id                                                                         as show_id,
    s.tenant_id,
    coalesce(sum(e.total_issued), 0)                                             as total_issued,
    coalesce(sum(e.total_checked_in), 0)                                         as total_checked_in,
    coalesce(sum(e.gross_revenue_cents), 0)                                      as gross_revenue_cents,
    coalesce(sum(e.total_issued) filter (where e.event_role = 'advance'), 0)     as advance_issued,
    coalesce(sum(e.total_issued) filter (where e.event_role = 'day_of_sale'), 0) as dos_issued,
    count(e.id)                                                                  as event_count
from public.show_analyses s
left join public.ticket_tailor_events e on e.show_id = s.id
group by s.id, s.tenant_id;

revoke all on public.show_ticket_actuals from anon;
grant select on public.show_ticket_actuals to authenticated, service_role;

commit;

-- VERIFY 1: new columns present on show_analyses.
-- select column_name from information_schema.columns
--  where table_name='show_analyses'
--    and column_name in ('format','monetization','series_id','door_count','exclude_from_learning','exclude_reason');  -- expect 6 rows

-- VERIFY 2: enum has 'general'.
-- select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='tt_event_role';  -- expect advance, day_of_sale, general, unmapped

-- VERIFY 3: neither new object grants anything to anon.
-- select table_name, grantee from information_schema.role_table_grants
--  where table_name in ('event_series','show_ticket_actuals') and grantee='anon';  -- expect 0 rows
